import type { ClientCertificateSummary, EndpointInput, InfrastructureTemplate, ListSource, Preferences, SecuritySummary, ServiceProfiles, SyncSettings } from '#shared/contract'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}

/** Stored security configuration: the summary plus the encrypted secret value, if any. */
export type StoredSecurity = SecuritySummary

export const infrastructures = pgTable('infrastructures', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  template: text('template').$type<InfrastructureTemplate>().notNull().default('full'),
  endpoints: jsonb('endpoints').$type<EndpointInput[]>().notNull(),
  listSource: text('list_source').$type<ListSource>().notNull().default('registry'),
  sync: jsonb('sync').$type<SyncSettings>().notNull().default({ serverSyncsRegistry: true, serverSyncsDiscovery: true, studioDefault: 'autoCreate', userOverride: false, idScheme: 'iri', idPrefix: 'https://example.com/ids/' }),
  /** `/description` profiles per endpoint at the last probe (MVP-4 plan, I6). */
  serviceProfiles: jsonb('service_profiles').$type<ServiceProfiles>().notNull().default({}),
  probedAt: timestamp('probed_at', { withTimezone: true }),
  security: jsonb('security').$type<StoredSecurity>().notNull(),
  /** Encrypted client secret for desktop `stored` secrets; never returned by the API. */
  secretCiphertext: text('secret_ciphertext'),
  /** TLS client certificate (mutual TLS) without its material; `null` without one. */
  clientCertificate: jsonb('client_certificate').$type<ClientCertificateSummary>(),
  /** Encrypted PKCS#12 bundle and passphrase of desktop `stored` certificates; never returned by the API. */
  clientCertificateCiphertext: text('client_certificate_ciphertext'),
  allowPrivateNetwork: boolean('allow_private_network').notNull().default(false),
  revision: integer('revision').notNull().default(1),
  createdBy: text('created_by').notNull(),
  ...timestamps,
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const studioSessions = pgTable('studio_sessions', {
  /** SHA-256 of the session cookie value; the raw value is never stored. */
  id: text('id').primaryKey(),
  subject: text('subject').notNull(),
  displayName: text('display_name').notNull(),
  roles: jsonb('roles').$type<string[]>().notNull(),
  csrfToken: text('csrf_token').notNull(),
  /** Encrypted ID token, kept only as `id_token_hint` for RP-initiated logout. */
  idTokenCiphertext: text('id_token_ciphertext'),
  ...timestamps,
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, table => [index('studio_sessions_expires_at_idx').on(table.expiresAt)])

export const oidcTransactions = pgTable('oidc_transactions', {
  state: text('state').primaryKey(),
  purpose: text('purpose', { enum: ['studio_login', 'target_authorization'] }).notNull(),
  sessionId: text('session_id').references(() => studioSessions.id, { onDelete: 'cascade' }),
  targetId: text('target_id').references(() => infrastructures.id, { onDelete: 'cascade' }),
  codeVerifierCiphertext: text('code_verifier_ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  returnTo: text('return_to').notNull(),
  ...timestamps,
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const targetCredentials = pgTable('target_credentials', {
  sessionId: text('session_id').notNull().references(() => studioSessions.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => infrastructures.id, { onDelete: 'cascade' }),
  accessTokenCiphertext: text('access_token_ciphertext').notNull(),
  refreshTokenCiphertext: text('refresh_token_ciphertext'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  subject: text('subject'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.sessionId, table.targetId] })])

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  requestId: text('request_id'),
  actorSubject: text('actor_subject'),
  action: text('action').notNull(),
  targetId: text('target_id'),
  downstreamIdentity: text('downstream_identity'),
  outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  /** The app installation that made the call, if any. No foreign key: audit outlives uninstalls. */
  appInstallationId: text('app_installation_id'),
}, table => [index('audit_events_occurred_at_idx').on(table.occurredAt)])

const bytea = customType<{ data: Uint8Array, driverData: Uint8Array }>({
  dataType: () => 'bytea',
  // node-postgres returns a Buffer, PGlite a Uint8Array.
  fromDriver: value => new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
})

/**
 * Installed apps (developer mode, MVP-3). One version per app ID; updates come
 * with the marketplace. Installing or uninstalling changes only these rows.
 */
export const appInstallations = pgTable('app_installations', {
  id: text('id').primaryKey(),
  appId: text('app_id').notNull(),
  version: text('version').notNull(),
  /** `sha256:<hex>` of the uploaded package. */
  digest: text('digest').notNull(),
  /** The validated manifest, as installed. */
  manifest: jsonb('manifest').$type<AppManifest>().notNull(),
  unsigned: boolean('unsigned').notNull(),
  /** Shipped with Studio and installed at startup (ADR 0023); not uninstallable by users. */
  bundled: boolean('bundled').notNull().default(false),
  installedBy: text('installed_by').notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('app_installations_app_id_idx').on(table.appId)])

/** App file contents, addressed by their SHA-256 digest and shared between installations. */
export const appBlobs = pgTable('app_blobs', {
  digest: text('digest').primaryKey(),
  size: integer('size').notNull(),
  content: bytea('content').notNull(),
})

export const appFiles = pgTable('app_files', {
  installationId: text('installation_id').notNull().references(() => appInstallations.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  digest: text('digest').notNull().references(() => appBlobs.digest),
  contentType: text('content_type').notNull(),
}, table => [primaryKey({ columns: [table.installationId, table.path] }), index('app_files_digest_idx').on(table.digest)])

/** Per-user preferences (recent shells, display settings), keyed by the user's subject. */
export const userPreferences = pgTable('user_preferences', {
  subject: text('subject').primaryKey(),
  preferences: jsonb('preferences').$type<Preferences>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
