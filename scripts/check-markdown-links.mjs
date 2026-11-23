// Checks the links of every Markdown file in the repository: relative links,
// anchors and external URLs, with the settings in .markdown-link-check.json.
//
//   pnpm lint:links             every tracked Markdown file
//   pnpm lint:links <file>…     only these files
//
// Files come from git, so build output and other untracked files are skipped.
// The release-notes template is skipped: its links hold placeholders.
// npmjs.com answers automated requests with 403, so its links are not checked.

import { execFileSync, spawnSync } from 'node:child_process'
import process from 'node:process'

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : execFileSync('git', ['ls-files', '-z', '*.md'], { encoding: 'utf8' }).split('\0').filter(file => file && file !== '.github/release-notes.md')

const result = spawnSync(
  'markdown-link-check',
  ['--quiet', '--retry', '--config', '.markdown-link-check.json', ...files],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)
process.exitCode = result.status ?? 1
