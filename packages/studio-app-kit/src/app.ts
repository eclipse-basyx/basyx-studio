import type { JsonObject, StudioClient, ThemeTokens } from '@basyx/studio-sdk'
import type { App, Component } from 'vue'
import { connect, fitHeight } from '@basyx/studio-sdk'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { VBtn } from 'vuetify/components/VBtn'
import { VBtnGroup } from 'vuetify/components/VBtnGroup'
import { VBtnToggle } from 'vuetify/components/VBtnToggle'
import { VCard, VCardItem } from 'vuetify/components/VCard'
import { VTable } from 'vuetify/components/VTable'
import { VTextField } from 'vuetify/components/VTextField'
import { Tooltip } from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import { appDefaults } from './defaults.ts'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

// The setup of Studio's apps (ADR 0023, ADR 0043). They follow Studio's
// theme and look; the defaults are in ./defaults.ts.

export interface MountOptions {
  /**
   * The client to use instead of `connect()`, e.g. the one of
   * `createTestStudio()` (`@basyx/studio-sdk/testing`) in a dev server.
   */
  client?: StudioClient | Promise<StudioClient>
  /**
   * Installs plugins before the app mounts, e.g. the router of a module
   * with pages: `setup: (app, client) => app.use(createAppRouter(client))`.
   */
  setup?: (app: App, client: StudioClient) => void | Promise<void>
}

/**
 * Connects to Studio, follows its theme, mounts the app into `#app` and
 * sizes the frame to it. The app's root component gets the client as its
 * `client` prop.
 */
export async function mountApp (app: Component, components: Record<string, Component>, options: MountOptions = {}): Promise<StudioClient> {
  const client = await (options.client ?? connect())
  const vuetify = createVuetify({
    components: { ...components, VBtn, VBtnGroup, VBtnToggle, VCard, VCardItem, VTable },
    // `v-tooltip` as Studio uses it, e.g. on icon-only buttons.
    directives: { Tooltip },
    aliases: { VBtnPrimary: VBtn, VBtnSecondary: VBtn, VBtnToggleIcon: VBtn, VBtnLink: VBtn, VCardFullscreen: VCard, VCardHeader: VCardItem, VCardSection: VCard, VViewCard: VCard, VTableDetails: VTable, VTableSheet: VTable, VTextFieldSearch: VTextField },
    defaults: appDefaults,
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  })
  const apply = (theme: ThemeTokens) => {
    const name = theme.dark ? 'dark' : 'light'
    Object.assign(vuetify.theme.themes.value[name]!.colors, theme.colors)
    vuetify.theme.change(name)
  }
  apply(client.context.theme)
  client.onContext(context => apply(context.theme))
  const root = document.querySelector<HTMLElement>('#app')!
  const instance = createApp(app, { client }).use(vuetify)
  await options.setup?.(instance, client)
  instance.mount(root)
  // The content, not the root: v-app is at least as tall as the frame, so a
  // frame sized to it could grow but never shrink to shorter content.
  fitHeight(client, root.querySelector<HTMLElement>('.v-application__wrap > *') ?? root)
  return client
}

/** Loads the context's submodel; the view is only shown for a submodel. */
export async function loadSubmodel (client: StudioClient): Promise<JsonObject> {
  return client.aas.getSubmodel(client.context.submodel!.id)
}
