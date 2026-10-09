import type { DeploymentMode } from '#shared/contract'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const csv = z
  .string()
  .transform(value => value.split(/[\s,]+/).filter(Boolean))

const envSchema = z.object({
  STUDIO_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
  STUDIO_DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//).optional(),
  STUDIO_DATA_DIR: z.string().min(1).default('.data/studio'),
  STUDIO_DATA_KEY: z.string().optional(),
  STUDIO_DATA_KEY_FILE: z.string().optional(),
  STUDIO_OIDC_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
  STUDIO_OIDC_CLIENT_ID: z.string().min(1).optional(),
  STUDIO_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  STUDIO_OIDC_CLIENT_SECRET_FILE: z.string().optional(),
  STUDIO_OIDC_SCOPES: csv.default(['openid', 'profile', 'email']),
  STUDIO_OIDC_ROLES_CLAIM: z.string().min(1).default('roles'),
  STUDIO_ADMIN_ROLE: z.string().min(1).default('studio-admin'),
  STUDIO_SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  STUDIO_PRIVATE_NETWORK_TARGETS: z.enum(['allow', 'deny']).optional(),
  STUDIO_LAUNCH_SECRET: z.string().optional(),
  STUDIO_APPS_URL: z.url({ protocol: /^https?$/ }).optional(),
  STUDIO_APPS_ALLOW_UNSIGNED: z.enum(['true', 'false']).optional(),
  STUDIO_DENO_PATH: z.string().min(1).optional(),
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
   * apps origin when hosted, the `studio-app:` protocol on desktop. `null`
   * when no apps origin is configured, which disables apps.
   */
  baseUrl: string | null
  /** Whether unsigned (developer-mode) packages may be installed. */
  allowUnsigned: boolean
  /** The Deno executable for backend apps; resolved from node_modules when unset. */
  denoPath: string | null
  /** Loopback URL of this service, the only address backend apps may reach. */
  capabilityUrl: string
  /** Where backends are extracted and run. */
  workDir: string
}

export interface StudioConfig {
  deploymentMode: DeploymentMode
  /** Origin under which users reach this Studio Service; used for redirects and Origin checks. */
  publicUrl: string
  database: { kind: 'postgres', url: string } | { kind: 'pglite', dataDir: string }
  /** 32-byte key for encrypting token material and stored secrets at rest. */
  dataKey: Buffer
  login: StudioOidcConfig | null
  rolesClaim: string
  adminRole: string
  sessionTtlMs: number
  allowPrivateNetworkTargets: boolean
  secureCookies: boolean
  apps: StudioAppsConfig
}

export class ConfigurationError extends Error {}

function readSecret (value: string | undefined, file: string | undefined, name: string): string | undefined {
  if (value && file) {
    throw new ConfigurationError(`Set either ${name} or ${name}_FILE, not both.`)
  }
  return file ? readFileSync(file, 'utf8').trim() : value
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

/**
 * Builds the validated Studio configuration from environment variables. The
 * deployment mode comes from Nuxt runtime config because it is a build-time
 * default (hosted vs. Electron build) that can be overridden at runtime.
 */
export function loadStudioConfig (env: NodeJS.ProcessEnv, deploymentMode: DeploymentMode): StudioConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new ConfigurationError(`Invalid Studio configuration: ${issues}`)
  }
  const values = parsed.data

  const port = values.NITRO_PORT ?? values.PORT ?? 3000
  let publicUrl: string
  if (deploymentMode === 'desktop') {
    publicUrl = `http://${values.NITRO_HOST ?? '127.0.0.1'}:${port}`
  } else if (values.STUDIO_PUBLIC_URL) {
    publicUrl = new URL(values.STUDIO_PUBLIC_URL).origin
  } else {
    throw new ConfigurationError('STUDIO_PUBLIC_URL is required for hosted deployments.')
  }

  const dataKey = decodeDataKey(readSecret(values.STUDIO_DATA_KEY, values.STUDIO_DATA_KEY_FILE, 'STUDIO_DATA_KEY'))

  let login: StudioOidcConfig | null = null
  if (deploymentMode === 'hosted') {
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
    const appsOrigin = new URL(values.STUDIO_APPS_URL).origin
    if (appsOrigin === publicUrl) {
      throw new ConfigurationError('STUDIO_APPS_URL must be a different origin than STUDIO_PUBLIC_URL (ADR 0017).')
    }
    appsBaseUrl = `${appsOrigin}/app/`
  }

  return {
    deploymentMode,
    publicUrl,
    // Desktop always embeds PGlite (ADR 0011); hosted uses PostgreSQL when configured.
    database: values.STUDIO_DATABASE_URL && deploymentMode === 'hosted'
      ? { kind: 'postgres', url: values.STUDIO_DATABASE_URL }
      : { kind: 'pglite', dataDir: resolve(values.STUDIO_DATA_DIR, 'db') },
    dataKey,
    login,
    rolesClaim: values.STUDIO_OIDC_ROLES_CLAIM,
    adminRole: values.STUDIO_ADMIN_ROLE,
    sessionTtlMs: values.STUDIO_SESSION_TTL_HOURS * 60 * 60 * 1000,
    allowPrivateNetworkTargets: (values.STUDIO_PRIVATE_NETWORK_TARGETS ?? (deploymentMode === 'desktop' ? 'allow' : 'deny')) === 'allow',
    secureCookies: publicUrl.startsWith('https://'),
    apps: {
      baseUrl: appsBaseUrl,
      // Off by default for hosted deployments; the desktop user installs for themselves.
      allowUnsigned: (values.STUDIO_APPS_ALLOW_UNSIGNED ?? (deploymentMode === 'desktop' ? 'true' : 'false')) === 'true',
      denoPath: values.STUDIO_DENO_PATH ?? null,
      capabilityUrl: `http://127.0.0.1:${port}`,
      workDir: resolve(values.STUDIO_DATA_DIR, 'app-backends'),
    },
  }
}
