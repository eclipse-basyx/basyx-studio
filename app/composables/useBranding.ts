import type { LegalPage, LockableSetting } from '#shared/branding'
import { useTheme } from 'vuetify'
import { legalPages, pickLocalized } from '#shared/branding'
import basyxLogo from '~/assets/basyx-logo.svg'

/** A legal page's link in the UI language: an external page, or Studio's page for its Markdown. */
export interface LegalLink {
  page: LegalPage
  title: string
  icon: string
  /** An external page, opened in a new tab. */
  href?: string
  /** Studio's own page. */
  to?: string
}

const legalIcons: Record<LegalPage, string> = {
  imprint: 'mdi-scale-balance',
  privacy: 'mdi-shield-account-outline',
  accessibility: 'mdi-human',
  terms: 'mdi-file-document-outline',
}

/**
 * The deployment's corporate design (ADR 0055): product name, logos, the
 * organisation and its links, the legal pages in the UI language, and which
 * appearance settings it locks. BaSyx Studio's own where it sets none.
 */
export function useBranding () {
  const session = useSessionStore()
  const theme = useTheme()
  const studioUrl = useStudioUrl()
  const { t, locale } = useI18n()

  const branding = computed(() => session.context?.branding ?? null)
  /** Mounted and uploaded files are served by Studio, under its base path. */
  const url = (source: string | null | undefined) => source ? (source.startsWith('/') ? studioUrl.page(source) : source) : null

  const name = computed(() => session.context?.product.name ?? t('app.name'))
  const logo = computed(() => url(theme.current.value.dark ? branding.value?.logoDark : branding.value?.logoLight) ?? basyxLogo)
  /** A square mark for small places; the logo where there is none. */
  const mark = computed(() => url(branding.value?.logoCompact) ?? logo.value)
  const customized = computed(() => branding.value?.customized ?? false)
  const organisation = computed(() => branding.value?.organisation ?? null)
  const supportUrl = computed(() => branding.value?.supportUrl ?? null)
  const helpUrl = computed(() => branding.value?.helpUrl ?? null)
  const signInMessage = computed(() => pickLocalized(branding.value?.signInMessage, locale.value, branding.value?.uiLanguage))

  const legalLinks = computed<LegalLink[]>(() => {
    const pages = session.context?.legal.pages
    return legalPages.flatMap(page => {
      const target = pickLocalized(pages?.[page], locale.value, branding.value?.uiLanguage)
      if (!target) {
        return []
      }
      const link: LegalLink = { page, title: t(`legal.pages.${page}`), icon: legalIcons[page] }
      return [target.startsWith('/') ? { ...link, to: target } : { ...link, href: target }]
    })
  })

  /** Whether the deployment fixes an appearance setting for every user. */
  function locked (setting: LockableSetting): boolean {
    return branding.value?.locked.includes(setting) ?? false
  }

  return { branding, name, logo, mark, customized, organisation, supportUrl, helpUrl, signInMessage, legalLinks, locked, url }
}
