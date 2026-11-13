// A new App Builder project (ADR 0054, plan P2): the starter app
// (examples/apps/starter) with the project's name and app ID, the published
// packages at the running Studio's version, and the instructions the coding
// agents read (AGENTS.md; CLAUDE.md points to it).

export type TemplateFiles = Map<string, string>

export interface ProjectIdentity {
  name: string
  slug: string
  appId: string
  /** The running Studio's version; the `@basyx/*` packages follow its minor version. */
  studioVersion: string
}

/** A folder and package name from a project name: lower case, ASCII, hyphens. */
export function slugOf (name: string): string {
  const slug = name
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z\d]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return /^[a-z]/.test(slug) ? slug : `app-${slug || 'new'}`
}

/** The app ID of a project this computer created: `local.<slug>`, as the machine key may sign (plan P3). */
export function localAppId (slug: string): string {
  return `local.${slug}`
}

/** `^0.2.0` for Studio 0.2.x: the packages of the same minor version. */
export function packageRange (studioVersion: string): string {
  const match = /^(\d+)\.(\d+)\./.exec(studioVersion)
  return match ? `^${match[1]}.${match[2]}.0` : 'latest'
}

/** What a project's repository leaves out. */
export const gitignore = 'node_modules\ndist\n*.zip\n*.zip.sig\n'

/** Files of the starter that the template does not take. */
const skipped = new Set(['README.md'])

export function scaffoldFiles (template: TemplateFiles, identity: ProjectIdentity): TemplateFiles {
  const files: TemplateFiles = new Map()
  for (const [path, content] of template) {
    if (!skipped.has(path)) {
      files.set(path, content)
    }
  }
  const range = packageRange(identity.studioVersion)
  const pkg = JSON.parse(files.get('package.json') ?? '{}') as { name?: string, version?: string, dependencies?: Record<string, string> }
  pkg.name = identity.slug
  pkg.version = '0.1.0'
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (name.startsWith('@basyx/')) {
      pkg.dependencies![name] = range
    }
  }
  files.set('package.json', `${JSON.stringify(pkg, null, 2)}\n`)

  const manifest = JSON.parse(files.get('studio-app.json') ?? '{}') as Record<string, unknown> & { contributes?: { modules?: Record<string, unknown>[] } }
  manifest.id = identity.appId
  manifest.version = '0.1.0'
  manifest.publisher = { name: 'This computer' }
  manifest.title = { en: identity.name }
  manifest.description = { en: identity.name }
  for (const module of manifest.contributes?.modules ?? []) {
    module.title = { en: identity.name }
    module.route = identity.slug
  }
  files.set('studio-app.json', `${JSON.stringify(manifest, null, 2)}\n`)

  files.set('.gitignore', gitignore)
  files.set('AGENTS.md', agentInstructions(identity))
  files.set('CLAUDE.md', 'The instructions for coding agents are in AGENTS.md.\n\n@AGENTS.md\n')
  files.set('README.md', `# ${identity.name}\n\nA BaSyx Studio app, made with Studio's App Builder.\n\n\`\`\`bash\npnpm install\npnpm dev        # the app on the test Studio of ui/src/dev.ts\npnpm test\npnpm package    # studio-app pack: the package to install in Studio\n\`\`\`\n`)
  return files
}

/** The title and version of a bundled app, from its sources. */
export function bundledAppInfo (source: string, files: TemplateFiles): { source: string, appId: string, title: string, description: string | null, version: string } | null {
  try {
    const manifest = JSON.parse(files.get('studio-app.json') ?? '') as { id: string, version: string, title?: Record<string, string>, description?: Record<string, string> }
    return { source, appId: manifest.id, title: manifest.title?.en ?? manifest.id, description: manifest.description?.en ?? null, version: manifest.version }
  } catch {
    return null
  }
}

/**
 * A copy of a bundled app (plan P4): its sources with the project's name and
 * app ID, the published packages instead of Studio's workspace, and what the
 * starter has and a bundled app lacks outside Studio's repository (the
 * TypeScript and test tools, the release-age rule), plus the instructions.
 */
export function copyFiles (source: TemplateFiles, starter: TemplateFiles, identity: ProjectIdentity & { from: string }): TemplateFiles {
  const files: TemplateFiles = new Map(source)
  const range = packageRange(identity.studioVersion)
  const starterPkg = JSON.parse(starter.get('package.json') ?? '{}') as { scripts?: Record<string, string>, devDependencies?: Record<string, string> }

  const pkg = JSON.parse(files.get('package.json') ?? '{}') as { name?: string, version?: string, private?: boolean, scripts?: Record<string, string>, dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
  pkg.name = identity.slug
  pkg.version = '0.1.0'
  pkg.private = true
  for (const group of [pkg.dependencies, pkg.devDependencies]) {
    for (const [name, version] of Object.entries(group ?? {})) {
      if (version.startsWith('workspace:')) {
        group![name] = name.startsWith('@basyx/') ? range : 'latest'
      }
    }
  }
  pkg.devDependencies = { ...starterPkg.devDependencies, ...pkg.devDependencies }
  pkg.scripts = {
    typecheck: 'vue-tsc --noEmit -p tsconfig.json',
    test: 'vitest run --passWithNoTests',
    package: 'studio-app pack',
    ...pkg.scripts,
  }
  files.set('package.json', `${JSON.stringify(pkg, null, 2)}\n`)

  const manifest = JSON.parse(files.get('studio-app.json') ?? '{}') as Record<string, unknown> & { contributes?: { modules?: Record<string, unknown>[], submodelViews?: Record<string, unknown>[] } }
  manifest.$schema = './node_modules/@basyx/studio-sdk/app-manifest.schema.json'
  manifest.id = identity.appId
  manifest.version = '0.1.0'
  manifest.publisher = { name: 'This computer' }
  manifest.title = { en: identity.name }
  // A single view or module carries the project's name, so it is told apart from the bundled one.
  const parts = [...manifest.contributes?.modules ?? [], ...manifest.contributes?.submodelViews ?? []]
  if (parts.length === 1) {
    parts[0]!.title = { en: identity.name }
  }
  files.set('studio-app.json', `${JSON.stringify(manifest, null, 2)}\n`)

  for (const shared of ['tsconfig.json', 'pnpm-workspace.yaml']) {
    if (!files.has(shared) && starter.has(shared)) {
      files.set(shared, starter.get(shared)!)
    }
  }
  files.set('.gitignore', gitignore)
  files.set('AGENTS.md', agentInstructions(identity, `This app started as a copy of Studio's bundled app ${identity.from}. Studio keeps the bundled app; this one is the user's own. It may have no \`ui/src/dev.ts\` or tests yet: add them when you change its logic.`))
  files.set('CLAUDE.md', 'The instructions for coding agents are in AGENTS.md.\n\n@AGENTS.md\n')
  files.set('README.md', `# ${identity.name}\n\nA BaSyx Studio app, copied from the bundled app ${identity.from} with Studio's App Builder.\n`)
  return files
}

/** What every coding agent reads first in a project Studio created. */
export function agentInstructions (identity: Omit<ProjectIdentity, 'studioVersion' | 'slug'>, note?: string): string {
  return `# ${identity.name}: instructions for coding agents
${note ? `\n${note}\n` : ''}
This folder is a BaSyx Studio app: a web UI that Studio shows in a
sandboxed frame. It reads and changes Asset Administration Shell (AAS) data
only through the Studio SDK, which asks Studio to do it. BaSyx Studio's App
Builder runs you here; the user talks to you in Studio and sees each tool
call. After your turn, Studio commits your changes, builds the app and shows
it to the user.

## Rules

- Work only in this folder. Do not change files outside it, and do not
  install anything globally.
- Keep the app ID \`${identity.appId}\` in \`studio-app.json\`; Studio installs
  the app under it.
- Request only the permissions the app uses (\`permissions\` in
  \`studio-app.json\`). The test Studio (\`ui/src/dev.ts\`) refuses calls that
  the manifest does not declare, as Studio does.
- Build the UI from Vuetify components, their props and Vuetify utility
  classes. No custom CSS: no \`<style>\` blocks, no \`style\` attributes.
  \`mountApp\` from \`@basyx/studio-app-kit\` gives the app Studio's theme and
  look; register every Vuetify component the app uses in \`ui/src/main.ts\`.
- Put user-facing texts into \`ui/src/locales/en.json\` (and \`de.json\`); use
  \`useI18n()\` from \`ui/src/i18n.ts\`.
- Keep \`ui/src/dev.ts\` in step with the app: it is the app's data in
  \`pnpm dev\` and in the tests. Add fixtures for every SDK call the app makes.
- Add or update tests in \`test/\` for the app's logic. They run against the
  test Studio, without a browser.
- Use pnpm. Before you finish a turn, run \`pnpm install\` if you changed
  dependencies, then \`pnpm typecheck\`, \`pnpm test\` and \`pnpm build\`, and
  fix what fails.
- New dependencies must be at least a day old (\`minimumReleaseAge\`); prefer
  what Vue, Vuetify and the Studio packages already offer.

## Where things are

| Path | What |
| --- | --- |
| \`studio-app.json\` | The manifest: ID, version, permissions, modules and submodel views. Its JSON Schema is \`node_modules/@basyx/studio-sdk/app-manifest.schema.json\`. |
| \`ui/src/main.ts\` | Connects to Studio (\`connect()\`) or, in \`pnpm dev\`, to the test Studio; mounts \`App.vue\`. |
| \`ui/src/App.vue\` | The app. |
| \`ui/src/dev.ts\` | The test Studio with fixtures, for \`pnpm dev\` and the tests. |
| \`test/\` | Unit tests (Vitest). |

## Reference

- \`node_modules/@basyx/studio-sdk/README.md\`: the client API
  (\`client.aas.*\`, \`client.ui.*\`, \`client.context\`), the permissions each
  call needs, and the test Studio (\`@basyx/studio-sdk/testing\`).
- \`node_modules/@basyx/studio-app-kit/README.md\`: \`mountApp\`, the AAS and
  i18n helpers, the \`studioApp()\` Vite preset and the \`studio-app\` command.
- \`node_modules/@basyx/file-viewer/README.md\`: file previews and 3D models.

## Commands

\`\`\`bash
pnpm install
pnpm typecheck
pnpm test
pnpm build      # ui/ → dist/ui/
pnpm package    # studio-app pack: the package Studio installs
\`\`\`
`
}
