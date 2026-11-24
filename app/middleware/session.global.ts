/** Pages anyone may open: the start page with the sign-in prompt, About and the legal pages (ADR 0055). */
const publicPage = /^\/(?:about|legal\/[a-z]+)?\/?$/

export default defineNuxtRouteMiddleware(async to => {
  const session = useSessionStore()
  await session.ensureLoaded()

  // Everything else needs a session.
  if (session.needsLogin && !publicPage.test(to.path)) {
    return navigateTo({ path: '/', query: { returnTo: to.fullPath } })
  }
  if (to.path.startsWith('/admin') && !session.isAdmin) {
    return navigateTo('/')
  }
})
