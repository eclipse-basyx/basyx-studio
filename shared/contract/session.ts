import { z } from 'zod'
import { backgroundNames, shapes } from '../appearance'
import { legalPages, lockableSettings } from '../branding'
import { localeCodes } from '../i18n/locales'

export const deploymentModeSchema = z.enum(['hosted', 'desktop'])
export type DeploymentMode = z.infer<typeof deploymentModeSchema>

export const studioContextSchema = z.object({
  apiVersion: z.literal('1'),
  deploymentMode: deploymentModeSchema,
  /** Whether users must sign in to Studio (hosted) or are the local OS user (desktop). */
  loginRequired: z.boolean(),
  /** Hosted without login: everyone is the shared anonymous user (STUDIO_AUTH_MODE=none). */
  anonymous: z.boolean(),
  /** Whether administrators may add, change and remove infrastructures (STUDIO_INFRASTRUCTURES_EDITABLE). */
  infrastructuresEditable: z.boolean(),
  /** Whether the deployment enables branding administration (STUDIO_BRANDING_EDITABLE). */
  brandingEditable: z.boolean(),
  product: z.object({ name: z.string(), version: z.string(), commit: z.string().nullable(), buildDate: z.string().nullable() }),
  /**
   * The deployment's corporate design (ADR 0055): logos, favicon and font
   * (an absolute URL, or a Studio path under the base path), colours,
   * defaults and locks of the users' appearance. `null` keeps BaSyx's.
   */
  branding: z.object({
    /** Changes when the effective branding, including legal text, changes. */
    revision: z.string(),
    /** Whether anything differs from BaSyx Studio's own look. */
    customized: z.boolean(),
    organisation: z.string().nullable(),
    supportUrl: z.string().nullable(),
    helpUrl: z.string().nullable(),
    logoLight: z.string().nullable(),
    logoDark: z.string().nullable(),
    logoCompact: z.string().nullable(),
    favicon: z.string().nullable(),
    font: z.string().nullable(),
    accentLight: z.string().nullable(),
    accentDark: z.string().nullable(),
    secondaryLight: z.string().nullable(),
    secondaryDark: z.string().nullable(),
    theme: z.enum(['system', 'light', 'dark']).nullable(),
    background: z.enum(backgroundNames).nullable(),
    shape: z.enum(shapes).nullable(),
    uiLanguage: z.enum(localeCodes).nullable(),
    languages: z.array(z.enum(localeCodes)).nullable(),
    valueLanguage: z.string().nullable(),
    /** Shown on the sign-in page, per language. */
    signInMessage: z.record(z.string(), z.string()).nullable(),
    /** Appearance settings users cannot change. */
    locked: z.array(z.enum(lockableSettings)),
  }),
  /**
   * The legal pages per language: an external URL, or the Studio page
   * (`/legal/<page>`) that shows the Markdown the deployment gives.
   */
  legal: z.object({
    copyrightName: z.string().nullable(),
    /** v1 external links, retained for clients that predate localized pages. */
    legalNoticeUrl: z.string().nullable(),
    privacyPolicyUrl: z.string().nullable(),
    pages: z.record(z.enum(legalPages), z.record(z.string(), z.string()).nullable()),
  }),
  /** Deployment-wide switches; they only ever narrow what roles allow. */
  features: z.object({ readOnly: z.boolean(), uploads: z.boolean(), appInstalls: z.boolean() }),
})
export type StudioContext = z.infer<typeof studioContextSchema>

export const studioSessionSchema = z.object({
  user: z.object({
    subject: z.string(),
    name: z.string(),
    roles: z.array(z.string()),
  }),
  isAdmin: z.boolean(),
  csrfToken: z.string(),
  expiresAt: z.string().nullable(),
})
export type StudioSession = z.infer<typeof studioSessionSchema>

/** Relative in-app path only; prevents open redirects after login. */
export const returnToSchema = z
  .string()
  .max(2000)
  .regex(/^\/(?![/\\])/, 'must be an absolute path within Studio')

export const loginRequestSchema = z.object({
  returnTo: returnToSchema.optional(),
})

export const authorizationStartSchema = z.object({
  authorizationUrl: z.string(),
  /** `navigate`: redirect this window; `external`: open in the system browser and poll. */
  mode: z.enum(['navigate', 'external']),
})
export type AuthorizationStart = z.infer<typeof authorizationStartSchema>

export const logoutResultSchema = z.object({
  logoutUrl: z.string().nullable(),
})
export type LogoutResult = z.infer<typeof logoutResultSchema>
