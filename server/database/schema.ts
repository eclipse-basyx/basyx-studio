import type { AgentId, AppProjectOrigin, AppSettingValues, ClientCertificateSummary, Connection, ConversationEvent, EndpointInput, InfrastructureAppSettings, InfrastructureTemplate, ListSource, Preferences, SecuritySummary, ServiceProfiles, StackComponentId, StackSpec, SyncSettings } from '#shared/contract'
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
  /** Connections to third-party services, with secret summaries only (ADR 0040). */
  connections: jsonb('connections').$type<Connection[]>().notNull().default([]),
  /** Encrypted map from connection key to its desktop `stored` secrets; never returned by the API. */
  connectionSecretsCiphertext: text('connection_secrets_ciphertext'),
  /** Values of apps' `infrastructure` settings, by app ID (ADR 0048). */
  appSettings: jsonb('app_settings').$type<InfrastructureAppSettings[]>().notNull().default([]),
  /** Key of the entry in the deployment's infrastructure file; `null` for infrastructures made in Studio. */
  managedKey: text('managed_key').unique(),
  /** HMAC of the declared entry, so an unchanged entry is not written again at startup. */
  managedDigest: text('managed_digest'),
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

/** How Studio trusts the files of an installation (ADR 0044). */
export const appTrustLevels = ['bundled', 'signed', 'managed', 'unsigned'] as const
export type AppTrustLevel = typeof appTrustLevels[number]

/**
 * Installed apps (MVP-3, ADR 0044). One version per app ID; an update keeps
 * the installation ID. Installing or uninstalling changes only these rows.
 */
export const appInstallations = pgTable('app_installations', {
  id: text('id').primaryKey(),
  appId: text('app_id').notNull(),
  version: text('version').notNull(),
  /** `sha256:<hex>` of the uploaded package. */
  digest: text('digest').notNull(),
  /** The validated manifest, as installed. */
  manifest: jsonb('manifest').$type<AppManifest>().notNull(),
  /** `bundled`, `signed` (verified against the trust store), `managed` (mounted unsigned by the operator) or `unsigned`. */
  trust: text('trust', { enum: appTrustLevels }).notNull(),
  /** The trust store's name of the publisher whose key signed the package; `null` unless signed. */
  publisher: text('publisher'),
  /** `sha256:<hex>` of the signing key; `null` unless signed. Revocation compares it with the trust store. */
  keyFingerprint: text('key_fingerprint'),
  /** Shipped with Studio and installed at startup (ADR 0023); not uninstallable by users. */
  bundled: boolean('bundled').notNull().default(false),
  /** Installed from STUDIO_APP_PACKAGES at startup; not changed or uninstalled in the UI. */
  managed: boolean('managed').notNull().default(false),
  /** The App Builder's preview of a project's app (ADR 0054): shown only in its preview pane, not in Studio's navigation or views. */
  preview: boolean('preview').notNull().default(false),
  /**
   * For a preview: the installed app of the project it previews, whose settings it starts
   * from and whose infrastructure settings and connection bindings it uses (ADR 0054).
   */
  previewOf: text('preview_of'),
  /** The values an administrator set for the installation's settings (ADR 0048); kept by updates where they still fit. */
  settings: jsonb('settings').$type<AppSettingValues>().notNull().default({}),
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

/**
 * Local BaSyx instances on the user's container engine (ADR 0033, desktop
 * only). The engine holds what runs; this row holds what the user chose, the
 * generated secrets and the infrastructure Studio created for it.
 */
export const containerStacks = pgTable('container_stacks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** The `basyx-stack/1` spec, with its base port. */
  spec: jsonb('spec').$type<StackSpec>().notNull(),
  /** Encrypted database, Keycloak and user passwords; never returned except through sign-in details. */
  secretsCiphertext: text('secrets_ciphertext').notNull(),
  /** The engine the stack runs on (`unix:///…`, `npipe:////./pipe/…`). */
  engineHost: text('engine_host').notNull(),
  /** The image each component was created from. */
  images: jsonb('images').$type<Partial<Record<StackComponentId, string>>>().notNull().default({}),
  infrastructureId: text('infrastructure_id').references(() => infrastructures.id, { onDelete: 'set null' }),
  createdBy: text('created_by').notNull(),
  ...timestamps,
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Container engine settings; one row (`default`). */
export const containerSettings = pgTable('container_settings', {
  id: text('id').primaryKey(),
  /** The chosen engine; `null` picks the first running one. */
  engineHost: text('engine_host'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * The App Builder's projects (ADR 0054, desktop only): an app's sources in a
 * folder on this computer, which coding agents change. The files stay in
 * the folder; this row says where it is and what it holds.
 */
export const appProjects = pgTable('app_projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** The app ID in its `studio-app.json`. */
  appId: text('app_id').notNull(),
  folder: text('folder').notNull().unique(),
  origin: text('origin').$type<AppProjectOrigin>().notNull(),
  /** The bundled app a copy started from. */
  source: text('source'),
  /** The default target used by the App Builder preview. */
  previewTargetId: text('preview_target_id'),
  ...timestamps,
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A chat with one coding agent in a project's folder. */
export const appBuilderConversations = pgTable('app_builder_conversations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => appProjects.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').$type<AgentId>().notNull(),
  title: text('title').notNull().default(''),
  /** The agent's ACP session, for `session/load`. */
  sessionId: text('session_id'),
  /** The model the user chose, set again after a load. */
  model: text('model'),
  ...timestamps,
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('app_builder_conversations_project').on(table.projectId)])

/** What happened in a chat, to show it again (ADR 0054). */
export const appBuilderEvents = pgTable('app_builder_events', {
  conversationId: text('conversation_id').notNull().references(() => appBuilderConversations.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  event: jsonb('event').$type<ConversationEvent>().notNull(),
}, table => [primaryKey({ columns: [table.conversationId, table.seq] })])

/**
 * The App Builder's signing key of this computer (ADR 0054, plan B7): it
 * signs the apps this computer builds, and Studio trusts it for `local.*`.
 * The private key is encrypted with Studio's data key.
 */
export const machineSigningKeys = pgTable('machine_signing_keys', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKeyCiphertext: text('private_key_ciphertext').notNull(),
  fingerprint: text('fingerprint').notNull(),
  ...timestamps,
})
