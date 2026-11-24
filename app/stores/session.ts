import type { AuthorizationStart, LogoutResult, StudioContext, StudioSession } from '#shared/contract'
import { defineStore } from 'pinia'
import { apiBasePath } from '#shared/contract'

/** Studio-level context and the signed-in user. Never holds target data. */
export const useSessionStore = defineStore('session', () => {
  const context = ref<StudioContext | null>(null)
  const session = ref<StudioSession | null>(null)
  const loaded = ref(false)
  const studioUrl = useStudioUrl()
  const invalidate = useInvalidate()
  let contextRequest = 0

  const csrfToken = computed(() => session.value?.csrfToken ?? null)
  const isAdmin = computed(() => session.value?.isAdmin ?? false)
  /** Administrators may change infrastructures unless the deployment fixes them. */
  const canEditInfrastructures = computed(() => isAdmin.value && (context.value?.infrastructuresEditable ?? true))
  const isDesktop = computed(() => context.value?.deploymentMode === 'desktop')
  const needsLogin = computed(() => (context.value?.loginRequired ?? false) && session.value === null)

  async function ensureLoaded (): Promise<void> {
    if (loaded.value) {
      return
    }
    const requestFetch = useStudioFetch()
    context.value = await requestFetch<StudioContext>(`${apiBasePath}/context`)
    session.value = await requestFetch<StudioSession>(`${apiBasePath}/session`).catch(() => null)
    loaded.value = true
  }

  /** Reads the context again and updates queries that depend on the branding. */
  async function reloadContext (): Promise<void> {
    const request = ++contextRequest
    const updated = await $fetch<StudioContext>(`${apiBasePath}/context`)
    if (request !== contextRequest) {
      return
    }
    const changed = context.value?.branding.revision !== updated.branding.revision
    context.value = updated
    if (changed) {
      await invalidate(['me', 'preferences'], ['legal'])
    }
  }

  async function login (returnTo: string): Promise<void> {
    const start = await $fetch<AuthorizationStart>(`${apiBasePath}/auth/login`, { method: 'POST', body: { returnTo } })
    window.location.assign(start.authorizationUrl)
  }

  async function logout (): Promise<void> {
    const result = await $fetch<LogoutResult>(`${apiBasePath}/auth/logout`, {
      method: 'POST',
      headers: csrfToken.value ? { 'X-CSRF-Token': csrfToken.value } : {},
    })
    // A full navigation discards every cached target response of this session.
    window.location.assign(result.logoutUrl ?? studioUrl.page('/'))
  }

  return { context, session, loaded, csrfToken, isAdmin, canEditInfrastructures, isDesktop, needsLogin, ensureLoaded, reloadContext, login, logout }
})
