// Checks locale files against English (ADR 0026): each directory's `en.json`
// is the source, every other `<code>.json` next to it a translation.
//
//   pnpm i18n:check            fail on errors, report missing keys
//   pnpm i18n:check --strict   also fail on missing keys in available locales
//                              (a dialect's keys may come from its base locale)
//   pnpm i18n:check <dir>…     check other directories
//
// Errors: duplicate keys, non-string values, invalid message syntax, keys that
// English does not have, placeholders or linked keys that differ from English,
// and a plural choice count that differs from English (one choice is always
// allowed, for languages such as Chinese and Japanese).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import process from 'node:process'
import { createParser } from '@intlify/message-compiler'
import { locales } from '../shared/i18n/locales.ts'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const strict = args.includes('--strict')
const dirs = args.filter(arg => !arg.startsWith('--'))
const available = new Set(locales.filter(locale => locale.available).map(locale => locale.code))
// Dialects override some messages of their base locale (shared/i18n/locales.ts).
const bases = new Map(locales.filter(locale => locale.base).map(locale => [locale.code, locale.base]))

function defaultDirs () {
  const apps = join(root, 'apps')
  const appDirs = readdirSync(apps, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(apps, entry.name, 'ui', 'src', 'locales'))
  return [join(root, 'i18n', 'locales'), ...appDirs].filter(dir => existsSync(dir))
}

/**
 * Parses JSON like `JSON.parse`, but reports duplicate keys, which
 * `JSON.parse` silently resolves to the last value.
 */
function parseJson (source, report) {
  let index = 0
  const line = () => source.slice(0, index).split('\n').length

  function skip () {
    while (/\s/.test(source[index] ?? '')) {
      index++
    }
  }

  function fail (message) {
    throw new SyntaxError(`${message} at line ${line()}`)
  }

  function string () {
    const start = index
    index++
    while (source[index] !== '"') {
      if (index >= source.length) {
        fail('Unterminated string')
      }
      index += source[index] === '\\' ? 2 : 1
    }
    index++
    return JSON.parse(source.slice(start, index))
  }

  function value (path) {
    skip()
    const char = source[index]
    if (char === '{') {
      index++
      const object = {}
      skip()
      if (source[index] === '}') {
        index++
        return object
      }
      for (;;) {
        skip()
        if (source[index] !== '"') {
          fail('Expected a key')
        }
        const keyLine = line()
        const key = string()
        const keyPath = path ? `${path}.${key}` : key
        if (Object.hasOwn(object, key)) {
          report(`duplicate key ${keyPath} (line ${keyLine})`)
        }
        skip()
        if (source[index++] !== ':') {
          fail('Expected ":"')
        }
        object[key] = value(keyPath)
        skip()
        const next = source[index++]
        if (next === '}') {
          return object
        }
        if (next !== ',') {
          fail('Expected "," or "}"')
        }
      }
    }
    if (char === '[') {
      index++
      const array = []
      skip()
      if (source[index] === ']') {
        index++
        return array
      }
      for (;;) {
        array.push(value(`${path}[${array.length}]`))
        skip()
        const next = source[index++]
        if (next === ']') {
          return array
        }
        if (next !== ',') {
          fail('Expected "," or "]"')
        }
      }
    }
    if (char === '"') {
      return string()
    }
    const literal = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(index))
    if (!literal) {
      fail('Unexpected token')
    }
    index += literal[0].length
    return JSON.parse(literal[0])
  }

  const result = value('')
  skip()
  if (index < source.length) {
    fail('Unexpected content after the end')
  }
  return result
}

/** Leaf messages by dotted key path; non-string leaves are reported. */
function flatten (object, report, prefix = '', messages = new Map()) {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      messages.set(path, value)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, report, path, messages)
    } else {
      report(`${path} is not a string or an object`)
    }
  }
  return messages
}

// AST node types of @intlify/message-compiler (NodeTypes is a const enum).
const PLURAL = 1
const NAMED = 4
const LIST = 5
const LINKED = 6

/** The choice count and the placeholders and linked keys of a message, or an error. */
function analyze (message) {
  const errors = []
  const parser = createParser({ onError: error => errors.push(error.message) })
  const ast = parser.parse(message)
  if (errors.length > 0) {
    return { error: errors.join('; ') }
  }
  const placeholders = new Set()
  const linked = new Set()
  const visit = node => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (node.type === NAMED) {
      placeholders.add(`{${node.key}}`)
    } else if (node.type === LIST) {
      placeholders.add(`{${node.index}}`)
    } else if (node.type === LINKED && node.key?.value) {
      linked.add(`@:${node.key.value}`)
    }
    for (const child of [node.body, ...(node.cases ?? []), ...(node.items ?? []), node.key]) {
      visit(child)
    }
  }
  visit(ast)
  return { choices: ast.body?.type === PLURAL ? ast.body.cases.length : 1, placeholders, linked }
}

function sameSet (a, b) {
  return a.size === b.size && [...a].every(item => b.has(item))
}

let failed = false
const coverage = []

function load (file, errors) {
  const report = message => errors.push(`${relative(root, file)}: ${message}`)
  try {
    return flatten(parseJson(readFileSync(file, 'utf8'), report), report)
  } catch (error) {
    report(error.message)
    return new Map()
  }
}

for (const dir of dirs.length > 0 ? dirs : defaultDirs()) {
  const errors = []
  const sourceFile = join(dir, 'en.json')
  if (!existsSync(sourceFile)) {
    console.error(`${relative(root, dir)}: no en.json`)
    failed = true
    continue
  }
  const source = load(sourceFile, errors)
  const sourceInfo = new Map()
  for (const [key, message] of source) {
    const info = analyze(message)
    if (info.error) {
      errors.push(`${relative(root, sourceFile)}: ${key}: ${info.error}`)
    } else {
      sourceInfo.set(key, info)
    }
  }
  for (const [key, info] of sourceInfo) {
    for (const link of info.linked) {
      if (!source.has(link.slice(2))) {
        errors.push(`${relative(root, sourceFile)}: ${key} links to the missing key ${link.slice(2)}`)
      }
    }
  }

  const files = readdirSync(dir).filter(name => name.endsWith('.json') && name !== 'en.json').toSorted()
  for (const name of files) {
    const file = join(dir, name)
    const code = basename(name, '.json')
    const translation = load(file, errors)
    const at = key => `${relative(root, file)}: ${key}`
    for (const [key, message] of translation) {
      const english = sourceInfo.get(key)
      if (!source.has(key)) {
        errors.push(`${at(key)} does not exist in en.json`)
        continue
      }
      if (!english) {
        continue
      }
      const info = analyze(message)
      if (info.error) {
        errors.push(`${at(key)}: ${info.error}`)
        continue
      }
      if (info.choices !== 1 && info.choices !== english.choices) {
        errors.push(`${at(key)} has ${info.choices} plural choices, English ${english.choices}`)
      }
      if (!sameSet(info.placeholders, english.placeholders)) {
        errors.push(`${at(key)} uses ${[...info.placeholders].join(' ') || 'no placeholders'}, English ${[...english.placeholders].join(' ') || 'none'}`)
      }
      if (!sameSet(info.linked, english.linked)) {
        errors.push(`${at(key)} links ${[...info.linked].join(' ') || 'nothing'}, English ${[...english.linked].join(' ') || 'nothing'}`)
      }
    }
    const baseFile = bases.has(code) ? join(dir, `${bases.get(code)}.json`) : null
    const base = baseFile && existsSync(baseFile) ? load(baseFile, []) : new Map()
    const missing = [...source.keys()].filter(key => !translation.has(key) && !base.has(key))
    coverage.push({ dir: relative(root, dir), locale: code, translated: source.size - missing.length, total: source.size, missing })
    if (strict && available.has(code) && missing.length > 0) {
      errors.push(...missing.map(key => `${at(key)} is missing`))
    }
  }

  for (const error of errors) {
    console.error(error)
  }
  failed ||= errors.length > 0
  if (errors.length === 0) {
    console.log(`${relative(root, dir)}: ${source.size} keys, ${files.length} translation(s), no errors`)
  }
}

if (coverage.length > 0) {
  console.table(coverage.map(({ dir, locale, translated, total }) => ({ dir, locale, translated, total, percent: Math.floor((translated / total) * 100) })))
}

process.exitCode = failed ? 1 : 0
