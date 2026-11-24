import { locales } from '#shared/i18n/locales'

/** Pages anyone may open: the start page with the sign-in prompt, About and the legal pages (ADR 0055). */
const publicPage = /^\/(?:about|legal\/[a-z]+)?\/?$/

export default defineNuxtRouteMiddleware(async to => {
  const session = useSessionStore()
  const { $i18n } = useNuxtApp()
  const languageCookie = useCookie<string>('i18n_redirected')
  await session.ensureLoaded()

  const brand = session.context?.branding
  if (brand) {
    const current = $i18n.locale.value
    const base = locales.find(entry => entry.code === current)?.base ?? current
    const offered: readonly string[] | null = brand.languages
    const missing = offered && !offered.includes(base)
    const configured = brand.uiLanguage && (!brand.languages || brand.languages.includes(brand.uiLanguage)) ? brand.uiLanguage : brand.languages?.[0]
    if (configured && configured !== current && (missing || brand.locked.includes('uiLanguage') || !languageCookie.value)) {
      await $i18n.setLocale(configured)
    }
  }

  // Everything else needs a session.
  if (session.needsLogin && !publicPage.test(to.path)) {
    return navigateTo({ path: '/', query: { returnTo: to.fullPath } })
  }
  if (to.path.startsWith('/admin') && !session.isAdmin) {
    return navigateTo('/')
  }
})
