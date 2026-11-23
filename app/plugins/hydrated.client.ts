// Marks the document once the app has hydrated (`<html data-hydrated>`).
// A server-rendered page shows its buttons before Vue listens to them, so a
// click in that moment does nothing; the end-to-end tests wait for the mark
// before they act on a freshly loaded page (test/e2e/web/support.ts).
export default defineNuxtPlugin({
  name: 'studio:hydrated',
  setup (nuxtApp) {
    nuxtApp.hooks.hookOnce('app:suspense:resolve', () => {
      document.documentElement.dataset.hydrated = ''
    })
  },
})
