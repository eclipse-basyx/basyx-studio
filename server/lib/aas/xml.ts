import type { JsonObject } from './outline'
import { jsonization, xmlization } from '@aas-core-works/aas-core3.1-typescript'
import { StudioProblem } from '../problem'

/**
 * The AAS XML serialization (aas-core) of a submodel or submodel element
 * from its JSON form, for the details drawer's XML mode (MVP-4 plan, T2).
 * Data that does not deserialize is reported as an invalid target response.
 */
export function toAasXml (value: JsonObject, kind: 'submodel' | 'element' | 'concept description'): string {
  const parsed = kind === 'submodel'
    ? jsonization.submodelFromJsonable(value as jsonization.JsonValue)
    : (kind === 'element'
        ? jsonization.submodelElementFromJsonable(value as jsonization.JsonValue)
        : jsonization.conceptDescriptionFromJsonable(value as jsonization.JsonValue))
  if (parsed.error !== null) {
    throw new StudioProblem('target_invalid_response', `The ${kind} cannot be serialized as XML: ${parsed.error.path.toString()}: ${parsed.error.message}`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${indentXml(xmlization.toXmlString(parsed.mustValue()))}`
}

/**
 * Puts each element of aas-core's single-line XML on its own line, indented
 * by depth. An element with text (or nothing) stays on one line, so values,
 * whitespace and line breaks inside them are unchanged.
 */
export function indentXml (xml: string): string {
  const tokens = xml.match(/<[^>]+>|[^<]+/g) ?? []
  const lines: string[] = []
  let depth = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    const pad = '  '.repeat(depth)
    if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      lines.push(`${'  '.repeat(depth)}${token}`)
    } else if (!token.startsWith('<') || token.endsWith('/>') || token.startsWith('<?')) {
      lines.push(`${pad}${token}`)
    } else {
      // `<a>text</a>` and `<a></a>` stay together.
      const text = tokens[index + 1]?.startsWith('<') ? '' : (tokens[index + 1] ?? '')
      const close = tokens[index + 1 + (text ? 1 : 0)]
      if (close?.startsWith('</')) {
        lines.push(`${pad}${token}${text}${close}`)
        index += text ? 2 : 1
      } else {
        lines.push(`${pad}${token}`)
        depth++
      }
    }
  }
  return lines.join('\n')
}
