import type { DeploymentMode } from '#shared/contract'
import type { TrustStore } from './apps/trust'
import type { OutboundProxy } from './network/proxy'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { appsHostOf, installationPlaceholder } from './apps/origins'
import { emptyTrustStore, parseTrustStore, TrustStoreError } from './apps/trust'
import { parseOutboundProxy, ProxyConfigurationError } from './network/proxy'

const csv = z
  .string()
  .transform(value => value.split(/[\s,]+/).filter(Boolean))

const hexColor = z.string().regex(/^#[0-9A-F]{6}$/i, 'use #RRGGBB')
const flag = z.enum(['true', 'false']).optional()
const httpsUrl = z.url({ protocol: /^https?$/ })

/** `*`, or an http(s) origin without path, e.g. `https://downloads.example.com`. */
function isOriginOrAny (value: string): boolean {
  const url = URL.parse(value)
  return value === '*' || (url !== null && /^https?:$/.test(url.protocol) && url.origin === value.replace(/\/$/, ''))
}

const envSchema = z.object({
  STUDIO_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
  STUDIO_DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//).optional(),
  STUDIO_DATA_DIR: z.string().min(1).default('.data/studio'),
  STUDIO_DATA_KEY: z.string().optional(),
  STUDIO_DATA_KEY_FILE: z.string().optional(),
  STUDIO_AUTH_MODE: z.enum(['oidc', 'none']).default('oidc'),
  STUDIO_ANONYMOUS_ROLES: csv.default([]),
  STUDIO_OIDC_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
  STUDIO_OIDC_CLIENT_ID: z.string().min(1).optional(),
  STUDIO_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  STUDIO_OIDC_CLIENT_SECRET_FILE: z.string().optional(),
  STUDIO_OIDC_SCOPES: csv.default(['openid', 'profile', 'email']),
  STUDIO_OIDC_ROLES_CLAIM: z.string().min(1).default('roles'),
  STUDIO_ADMIN_ROLE: z.string().min(1).default('studio-admin'),
  STUDIO_SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  STUDIO_PRIVATE_NETWORK_TARGETS: z.enum(['allow', 'deny']).optional(),
  STUDIO_EXTERNAL_FILE_ORIGINS: csv.pipe(z.array(z.string().refine(isOriginOrAny, 'use * or origins such as https://downloads.example.com'))).optional(),
  STUDIO_LAUNCH_SECRET: z.string().optional(),
  STUDIO_APPS_URL: z.url({ protocol: /^https?$/ }).optional(),
  STUDIO_APPS_ALLOW_UNSIGNED: z.enum(['true', 'false']).optional(),
  STUDIO_APPS_TRUSTED_PUBLISHERS: z.string().min(1).optional(),
  STUDIO_APP_PACKAGES: csv.optional(),
  STUDIO_DENO_PATH: z.string().min(1).optional(),
  STUDIO_INFRASTRUCTURES_FILE: z.string().min(1).optional(),
  STUDIO_INFRASTRUCTURES: z.string().optional(),
  STUDIO_INFRASTRUCTURES_EDITABLE: z.enum(['true', 'false']).optional(),
  STUDIO_PRODUCT_NAME: z.string().trim().min(1).max(80).optional(),
  STUDIO_LOGO: z.string().min(1).optional(),
  STUDIO_LOGO_LIGHT: z.string().min(1).optional(),
  STUDIO_LOGO_DARK: z.string().min(1).optional(),
  STUDIO_PRIMARY_COLOR: hexColor.optional(),
  STUDIO_PRIMARY_COLOR_LIGHT: hexColor.optional(),
  STUDIO_PRIMARY_COLOR_DARK: hexColor.optional(),
  STUDIO_COPYRIGHT_NAME: z.string().trim().min(1).max(200).optional(),
  STUDIO_LEGAL_NOTICE_URL: httpsUrl.optional(),
  STUDIO_PRIVACY_POLICY_URL: httpsUrl.optional(),
  STUDIO_READ_ONLY: flag,
  STUDIO_ALLOW_UPLOADS: flag,
  STUDIO_APPS_ALLOW_INSTALL: flag,
  STUDIO_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(2 * 1024 * 1024 * 1024).default(100 * 1024 * 1024),
  NITRO_HOST: z.string().optional(),
  NITRO_PORT: z.coerce.number().int().optional(),
  PORT: z.coerce.number().int().optional(),
})

export interface StudioOidcConfig {
  issuer: string
  clientId: string
  clientSecret: string | undefined
  scopes: string[]
}

export interface StudioAppsConfig {
  /**
   * Base URL that app files are served under, ending in `/`: the separate
   * apps origin when hosted, the `studio-app:` protocol on desktop. Its host
   * may start with `{installation}.` for one origin per installation
   * (ADR 0045; see `apps/origins.ts`). `null` when no apps origin is
   * configured, which disables apps.
   */
  baseUrl: string | null
  /** Whether unsigned (developer-mode) packages may be installed. */
  allowUnsigned: boolean
  /** Publishers whose keys may sign packages (STUDIO_APPS_TRUSTED_PUBLISHERS, ADR 0044). */
  trustStore: TrustStore
  /** Package files and directories the deployment installs at startup (STUDIO_APP_PACKAGES). */
  packages: string[]
  /** The Deno executable for backend apps; resolved from node_modules when unset. */
  denoPath: string | null
  /** Loopback URL of this service, the only address backend apps may reach. */
  capabilityUrl: string
  /** Where backends are extracted and run. */
  workDir: string
}

/** A logo: an image on the web, or a mounted file that Studio serves at `<base>/branding/logo-<mode>`. */
export type LogoSource = { url: string } | { file: string, contentType: string }

/** Branding, legal links and feature toggles of a deployment (ADR 0035). */
export interface DeploymentSettings {
  productName: string
  logo: { light: LogoSource | null, dark: LogoSource | null }
  /** The default accent instead of the BaSyx one, for users who keep the default. */
  accent: { light: string, dark: string } | null
  legal: { copyrightName: string | null, legalNoticeUrl: string | null, privacyPolicyUrl: string | null }
  /** No writes or uploads to any target (STUDIO_READ_ONLY). */
  readOnly: boolean
  /** File uploads to targets (STUDIO_ALLOW_UPLOADS). */
  uploads: boolean
  /** Administrators may install apps at runtime (STUDIO_APPS_ALLOW_INSTALL); bundled apps stay. */
  appInstalls: boolean
}

export interface StudioConfig {
  deploymentMode: DeploymentMode
  /** Origin under which users reach this Studio Service; used for redirects and Origin checks. */
  publicUrl: string
  /** Path Studio is served under on that origin, `/` or `/a/b/` (Nuxt's app.baseURL). */
  basePath: string
  database: { kind: 'postgres', url: string } | { kind: 'pglite', dataDir: string }
  /** 32-byte key for encrypting token material and stored secrets at rest. */
  dataKey: Buffer
  login: StudioOidcConfig | null
  /**
   * Hosted without login (STUDIO_AUTH_MODE=none, ADR 0036): every browser
   * gets its own session as the shared `anonymous` user with these roles.
   */
  anonymous: { roles: string[] } | null
  rolesClaim: string
  adminRole: string
  sessionTtlMs: number
  allowPrivateNetworkTargets: boolean
  /**
   * Origins whose files, named by AAS content, Studio's server fetches when
   * the browser may not read them (ADR 0042); `*` for any.
   */
  externalFileOrigins: '*' | string[]
  /**
   * The HTTP proxy for outbound requests (HTTP_PROXY, HTTPS_PROXY, NO_PROXY;
   * ADR 0052); `null` when every request goes direct.
   */
  outboundProxy: OutboundProxy | null
  secureCookies: boolean
  apps: StudioAppsConfig
  /**
   * The deployment's infrastructure declarations as YAML text, each with
   * where it came from (ADR 0037); parsed and applied at startup.
   */
  managedInfrastructures: Array<{ source: string, text: string }>
  /** Whether administrators may add, change and remove infrastructures in Studio. */
  infrastructuresEditable: boolean
  deployment: DeploymentSettings
  /** Largest AASX, JSON or XML file users may upload to a target (D16). */
  uploadMaxBytes: number
  /** Local BaSyx instances on Docker or Podman (ADR 0033); desktop only. */
  containers: { dataDir: string } | null
  /** The App Builder's coding agents (ADR 0054); desktop only. */
  appBuilder: { dataDir: string } | null
}

export class ConfigurationError extends Error {}

function readSecret (value: string | undefined, file: string | undefined, name: string): string | undefined {
  if (value && file) {
    throw new ConfigurationError(`Set either ${name} or ${name}_FILE, not both.`)
  }
  return file ? readFileSync(file, 'utf8').trim() : value
}

function readInfrastructureSources (file: string | undefined, inline: string | undefined): StudioConfig['managedInfrastructures'] {
  const sources: StudioConfig['managedInfrastructures'] = []
  if (file) {
    try {
      sources.push({ source: file, text: readFileSync(file, 'utf8') })
    } catch {
      throw new ConfigurationError(`STUDIO_INFRASTRUCTURES_FILE: ${file} could not be read.`)
    }
  }
  if (inline?.trim()) {
    sources.push({ source: 'STUDIO_INFRASTRUCTURES', text: inline })
  }
  return sources
}

function readTrustStore (file: string | undefined): TrustStore {
  if (!file) {
    return emptyTrustStore
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new ConfigurationError(`STUDIO_APPS_TRUSTED_PUBLISHERS: ${file} could not be read.`)
  }
  try {
    return parseTrustStore(text, dirname(resolve(file)))
  } catch (error) {
    if (error instanceof TrustStoreError) {
      throw new ConfigurationError(`STUDIO_APPS_TRUSTED_PUBLISHERS: ${file}: ${error.message}`)
    }
    throw error
  }
}

const logoTypes: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

function logoSource (value: string | undefined, name: string): LogoSource | null {
  if (!value) {
    return null
  }
  if (/^https?:\/\//.test(value)) {
    return { url: new URL(value).href }
  }
  const contentType = logoTypes[extname(value).toLowerCase()]
  if (!isAbsolute(value) || !contentType) {
    throw new ConfigurationError(`${name} must be an http(s) URL or an absolute path to an SVG, PNG, WebP or JPEG file.`)
  }
  if (!existsSync(value)) {
    throw new ConfigurationError(`${name}: ${value} does not exist.`)
  }
  return { file: value, contentType }
}

function decodeDataKey (encoded: string | undefined): Buffer {
  if (!encoded) {
    throw new ConfigurationError(
      'STUDIO_DATA_KEY (or STUDIO_DATA_KEY_FILE) is required: 32 random bytes, base64url-encoded. '
      + 'Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"',
    )
  }
  const key = Buffer.from(encoded, 'base64url')
  if (key.length !== 32) {
    throw new ConfigurationError('STUDIO_DATA_KEY must decode to exactly 32 bytes.')
  }
  return key
}

const basePathPattern = /^\/(?:[\w.~-]+\/)*$/

/** The base path with exactly one leading and one trailing slash. */
function normalizeBasePath (value: string): string {
  const normalized = `/${value.split('/').filter(Boolean).join('/')}/`.replace(/^\/\/$/, '/')
  if (!basePathPattern.test(normalized) || normalized.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new ConfigurationError(`The base path must be a plain URL path such as /studio/, got "${value}".`)
  }
  return normalized
}

function deploymentSettings (values: z.infer<typeof envSchema>): DeploymentSettings {
  return {
    productName: values.STUDIO_PRODUCT_NAME ?? 'BaSyx Studio',
    logo: {
      light: logoSource(values.STUDIO_LOGO_LIGHT ?? values.STUDIO_LOGO, values.STUDIO_LOGO_LIGHT ? 'STUDIO_LOGO_LIGHT' : 'STUDIO_LOGO'),
      dark: logoSource(values.STUDIO_LOGO_DARK ?? values.STUDIO_LOGO, values.STUDIO_LOGO_DARK ? 'STUDIO_LOGO_DARK' : 'STUDIO_LOGO'),
    },
    accent: values.STUDIO_PRIMARY_COLOR || values.STUDIO_PRIMARY_COLOR_LIGHT || values.STUDIO_PRIMARY_COLOR_DARK
      ? {
          light: (values.STUDIO_PRIMARY_COLOR_LIGHT ?? values.STUDIO_PRIMARY_COLOR ?? values.STUDIO_PRIMARY_COLOR_DARK)!.toUpperCase(),
          dark: (values.STUDIO_PRIMARY_COLOR_DARK ?? values.STUDIO_PRIMARY_COLOR ?? values.STUDIO_PRIMARY_COLOR_LIGHT)!.toUpperCase(),
        }
      : null,
    legal: {
      copyrightName: values.STUDIO_COPYRIGHT_NAME ?? null,
      legalNoticeUrl: values.STUDIO_LEGAL_NOTICE_URL ?? null,
      privacyPolicyUrl: values.STUDIO_PRIVACY_POLICY_URL ?? null,
    },
    readOnly: values.STUDIO_READ_ONLY === 'true',
    uploads: values.STUDIO_ALLOW_UPLOADS !== 'false',
    appInstalls: values.STUDIO_APPS_ALLOW_INSTALL !== 'false',
  }
}

/**
 * Builds the validated Studio configuration from environment variables. The
 * deployment mode and the base path come from Nuxt runtime config: the mode
 * is a build-time default (hosted vs. Electron build) that can be overridden
 * at runtime, and Nuxt serves everything under the base path
 * (NUXT_APP_BASE_URL, set from STUDIO_BASE_PATH by the container image).
 */
export function loadStudioConfig (env: NodeJS.ProcessEnv, deploymentMode: DeploymentMode, basePath = '/'): StudioConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new ConfigurationError(`Invalid Studio configuration: ${issues}`)
  }
  const values = parsed.data

  const port = values.NITRO_PORT ?? values.PORT ?? 3000
  const base = normalizeBasePath(basePath)
  if (deploymentMode === 'desktop' && base !== '/') {
    throw new ConfigurationError('The desktop Studio Service is always served under /.')
  }
  let publicUrl: string
  if (deploymentMode === 'desktop') {
    publicUrl = `http://${values.NITRO_HOST ?? '127.0.0.1'}:${port}`
  } else if (values.STUDIO_PUBLIC_URL) {
    const url = new URL(values.STUDIO_PUBLIC_URL)
    // The public URL may name the base path too, but must not contradict it.
    if (url.pathname !== '/' && normalizeBasePath(url.pathname) !== base) {
      throw new ConfigurationError(`STUDIO_PUBLIC_URL has the path ${url.pathname}, but Studio is served under ${base} (STUDIO_BASE_PATH).`)
    }
    publicUrl = url.origin
  } else {
    throw new ConfigurationError('STUDIO_PUBLIC_URL is required for hosted deployments.')
  }

  const dataKey = decodeDataKey(readSecret(values.STUDIO_DATA_KEY, values.STUDIO_DATA_KEY_FILE, 'STUDIO_DATA_KEY'))

  let login: StudioOidcConfig | null = null
  const anonymous = deploymentMode === 'hosted' && values.STUDIO_AUTH_MODE === 'none' ? { roles: values.STUDIO_ANONYMOUS_ROLES } : null
  if (deploymentMode === 'hosted' && !anonymous) {
    if (!values.STUDIO_OIDC_ISSUER || !values.STUDIO_OIDC_CLIENT_ID) {
      throw new ConfigurationError('STUDIO_OIDC_ISSUER and STUDIO_OIDC_CLIENT_ID are required for hosted deployments.')
    }
    login = {
      issuer: values.STUDIO_OIDC_ISSUER,
      clientId: values.STUDIO_OIDC_CLIENT_ID,
      clientSecret: readSecret(values.STUDIO_OIDC_CLIENT_SECRET, values.STUDIO_OIDC_CLIENT_SECRET_FILE, 'STUDIO_OIDC_CLIENT_SECRET'),
      scopes: values.STUDIO_OIDC_SCOPES.includes('openid') ? values.STUDIO_OIDC_SCOPES : ['openid', ...values.STUDIO_OIDC_SCOPES],
    }
  }

  let appsBaseUrl: string | null = null
  if (deploymentMode === 'desktop') {
    appsBaseUrl = 'studio-app://'
  } else if (values.STUDIO_APPS_URL) {
    // The apps origin is routed to this same service, so it shares the base path.
    appsBaseUrl = `${appsOriginOf(values.STUDIO_APPS_URL, publicUrl)}${base}app/`
  }

  return {
    deploymentMode,
    publicUrl,
    basePath: base,
    // Desktop always embeds PGlite (ADR 0011); hosted uses PostgreSQL when configured.
    database: values.STUDIO_DATABASE_URL && deploymentMode === 'hosted'
      ? { kind: 'postgres', url: values.STUDIO_DATABASE_URL }
      : { kind: 'pglite', dataDir: resolve(values.STUDIO_DATA_DIR, 'db') },
    dataKey,
    login,
    anonymous,
    rolesClaim: values.STUDIO_OIDC_ROLES_CLAIM,
    adminRole: values.STUDIO_ADMIN_ROLE,
    sessionTtlMs: values.STUDIO_SESSION_TTL_HOURS * 60 * 60 * 1000,
    allowPrivateNetworkTargets: (values.STUDIO_PRIVATE_NETWORK_TARGETS ?? (deploymentMode === 'desktop' ? 'allow' : 'deny')) === 'allow',
    externalFileOrigins: externalFileOrigins(values.STUDIO_EXTERNAL_FILE_ORIGINS, deploymentMode),
    outboundProxy: outboundProxyOf(env),
    secureCookies: publicUrl.startsWith('https://'),
    apps: {
      baseUrl: appsBaseUrl,
      // Off by default for hosted deployments; the desktop user installs for themselves.
      allowUnsigned: (values.STUDIO_APPS_ALLOW_UNSIGNED ?? (deploymentMode === 'desktop' ? 'true' : 'false')) === 'true',
      trustStore: readTrustStore(values.STUDIO_APPS_TRUSTED_PUBLISHERS),
      packages: (values.STUDIO_APP_PACKAGES ?? []).map(path => resolve(path)),
      denoPath: values.STUDIO_DENO_PATH ?? null,
      // The runner falls back to [::1] when the server listens on IPv6 only.
      capabilityUrl: `http://127.0.0.1:${port}`,
      workDir: resolve(values.STUDIO_DATA_DIR, 'app-backends'),
    },
    managedInfrastructures: readInfrastructureSources(values.STUDIO_INFRASTRUCTURES_FILE, values.STUDIO_INFRASTRUCTURES),
    infrastructuresEditable: (values.STUDIO_INFRASTRUCTURES_EDITABLE ?? 'true') === 'true',
    deployment: deploymentSettings(values),
    uploadMaxBytes: values.STUDIO_UPLOAD_MAX_BYTES,
    containers: deploymentMode === 'desktop' ? { dataDir: resolve(values.STUDIO_DATA_DIR, 'containers') } : null,
    appBuilder: deploymentMode === 'desktop' ? { dataDir: resolve(values.STUDIO_DATA_DIR, 'app-builder') } : null,
  }
}

/**
 * The apps origin of STUDIO_APPS_URL: one shared origin (ADR 0017), or one
 * per installation when the host starts with `{installation}.` (ADR 0045).
 */
function appsOriginOf (value: string, publicUrl: string): string {
  const url = new URL(value)
  const placeholders = value.split(installationPlaceholder).length - 1
  if (placeholders === 0) {
    if (url.origin === publicUrl) {
      throw new ConfigurationError('STUDIO_APPS_URL must be a different origin than STUDIO_PUBLIC_URL (ADR 0017).')
    }
    return url.origin
  }
  if (placeholders > 1 || !url.host.startsWith(`${installationPlaceholder}.`) || url.host.split('.').length < 2) {
    throw new ConfigurationError('STUDIO_APPS_URL may name {installation} only as the first label of its host, e.g. https://{installation}.apps.example.org (ADR 0045).')
  }
  const origin = `${url.protocol}//${url.host}`
  if (appsHostOf(`${origin}/`, new URL(publicUrl).host)) {
    throw new ConfigurationError('STUDIO_APPS_URL must not match the host of STUDIO_PUBLIC_URL (ADR 0045).')
  }
  return origin
}

/** The listed origins; by default any on desktop, where the user's own machine fetches, and none when hosted. */
function externalFileOrigins (entries: string[] | undefined, mode: DeploymentMode): '*' | string[] {
  const listed = entries ?? (mode === 'desktop' ? ['*'] : [])
  return listed.includes('*') ? '*' : listed.map(entry => new URL(entry).origin)
}

function outboundProxyOf (env: NodeJS.ProcessEnv): OutboundProxy | null {
  try {
    return parseOutboundProxy(env)
  } catch (error) {
    if (error instanceof ProxyConfigurationError) {
      throw new ConfigurationError(error.message)
    }
    throw error
  }
}

/** Settings that work but deserve a line in the log at startup. */
export function configurationWarnings (config: StudioConfig, env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = []
  if (!config.apps.baseUrl && (env.STUDIO_APPS_TRUSTED_PUBLISHERS || env.STUDIO_APP_PACKAGES)) {
    warnings.push('STUDIO_APPS_TRUSTED_PUBLISHERS and STUDIO_APP_PACKAGES have no effect: apps are off without STUDIO_APPS_URL.')
  }
  if (config.anonymous) {
    if (env.STUDIO_OIDC_ISSUER || env.STUDIO_OIDC_CLIENT_ID) {
      warnings.push('STUDIO_AUTH_MODE=none: the STUDIO_OIDC_* settings are ignored.')
    }
    const host = new URL(config.publicUrl).hostname
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost')
    warnings.push(`STUDIO_AUTH_MODE=none: everyone who reaches ${config.publicUrl}${config.basePath} uses Studio without signing in.`)
    if (!loopback && config.anonymous.roles.includes(config.adminRole)) {
      warnings.push(`STUDIO_ANONYMOUS_ROLES includes ${config.adminRole}: every visitor may change infrastructures and apps. Restrict access to this deployment.`)
    }
  }
  return warnings
}
