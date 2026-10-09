// Builds the example apps (examples/apps/*) and packages each as an
// installable app package: examples/apps/dist/<name>.zip.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = fileURLToPath(new URL('..', import.meta.url))
const examples = join(root, 'examples', 'apps')
const output = join(examples, 'dist')

async function filesBelow (directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))
}

await mkdir(output, { recursive: true })
for (const name of await readdir(examples)) {
  const directory = join(examples, name)
  if (!existsSync(join(directory, 'studio-app.json'))) {
    continue
  }
  execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], { cwd: directory, stdio: 'inherit', shell: process.platform === 'win32' })
  const entries = { 'studio-app.json': await readFile(join(directory, 'studio-app.json')) }
  for (const folder of ['dist', 'backend']) {
    const base = join(directory, folder)
    if (existsSync(base)) {
      for (const file of await filesBelow(base)) {
        entries[relative(base, file).split('\\').join('/')] = await readFile(file)
      }
    }
  }
  // Backend files keep their folder; the UI build lands in ui/.
  const packaged = Object.fromEntries(Object.entries(entries).map(([path, content]) => [
    path.startsWith('ui/') || path === 'studio-app.json' ? path : `backend/${path}`,
    new Uint8Array(content),
  ]))
  const target = join(output, `${name}.zip`)
  await writeFile(target, zipSync(packaged))
  console.info(`${relative(root, target)}: ${Object.keys(packaged).length} files`)
}
