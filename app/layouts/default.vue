<template>
  <v-app :theme="ui.arcade ? 'arcade' : undefined">
    <v-app-bar>
      <v-app-bar-nav-icon
        v-if="inShellBrowser"
        :aria-label="t('app.toggleShellList')"
        @click="ui.listDrawer = !(ui.listDrawer ?? mdAndUp)"
      />

      <v-btn
        :active="false"
        :aria-label="lgAndUp ? undefined : t('app.name')"
        class="ms-2 me-3"
        size="large"
        to="/"
      >
        <template #prepend>
          <v-img :alt="t('app.name')" :src="basyxLogo" width="28" />
        </template>

        <span v-if="lgAndUp" class="text-title-medium font-weight-bold">{{ t('app.name') }}</span>
      </v-btn>

      <v-btn
        v-if="!session.needsLogin && mdAndUp"
        class="me-3 text-medium-emphasis"
        min-width="320"
        prepend-icon="mdi-magnify"
        spaced="end"
        variant="tonal"
        @click="ui.commandOpen = true"
      >
        {{ targetId ? t('palette.searchTarget') : t('palette.search') }}

        <template #append>
          <v-hotkey keys="cmd+k" />
        </template>
      </v-btn>

      <v-spacer />

      <template v-if="!session.needsLogin && targetId">
        <!-- The active target stays visible at every width (design guidelines);
             a menu button like the other app bar controls, its name from sm up. -->
        <v-menu v-if="targetItems.length > 0">
          <template #activator="{ props }">
            <v-btn
              v-if="smAndUp"
              v-bind="props"
              append-icon="mdi-chevron-down"
              :aria-label="t('app.targetNamed', { name: target?.name ?? '' })"
              border
              class="me-2"
              :max-width="mdAndUp ? 280 : 200"
              prepend-icon="mdi-server-network"
            >
              <span class="text-truncate">{{ target?.name }}</span>
            </v-btn>

            <v-btn v-else v-bind="props" :aria-label="t('app.targetNamed', { name: target?.name ?? '' })" icon="mdi-server-network" />
          </template>

          <v-card min-width="240">
            <v-list :selected="[targetId]">
              <v-list-subheader>{{ t('app.target') }}</v-list-subheader>

              <v-list-item
                v-for="item in targetItems"
                :key="item.value"
                :title="item.title"
                :value="item.value"
                @click="switchTarget(item.value)"
              />
            </v-list>
          </v-card>
        </v-menu>

        <!-- Applied-but-unfinished work of this target stays visible (MVP-5 plan, W7). -->
        <v-chip
          v-if="ui.editing && draftCount > 0"
          class="me-2"
          color="warning"
          prepend-icon="mdi-circle-medium"
          :text="t('app.drafts', draftCount)"
        />

        <v-btn-toggle
          v-if="smAndUp"
          v-model="ui.mode"
          class="me-2"
          mandatory
        >
          <v-btn prepend-icon="mdi-eye-outline" :text="t('app.view')" value="view" />
          <v-btn prepend-icon="mdi-pencil-outline" :text="t('app.edit')" value="edit" />
        </v-btn-toggle>

        <v-btn
          v-else
          :aria-label="ui.editing ? t('app.view') : t('app.edit')"
          :color="ui.editing ? 'primary' : undefined"
          :icon="ui.editing ? 'mdi-pencil' : 'mdi-eye-outline'"
          :variant="ui.editing ? 'tonal' : 'text'"
          @click="ui.toggleMode()"
        />
      </template>

      <v-btn
        v-if="!session.needsLogin && !mdAndUp"
        :aria-label="t('palette.search')"
        icon="mdi-magnify"
        @click="ui.commandOpen = true"
      />

      <v-btn
        v-if="smAndUp"
        v-tooltip="t('app.toggleTheme')"
        :aria-label="t('app.toggleTheme')"
        :icon="theme.current.value.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        @click="toggleTheme"
      />

      <v-menu v-if="session.session">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            :aria-label="t('app.account')"
            class="me-2"
            icon
            rounded="circle"
          >
            <v-avatar
              color="primary"
              rounded="circle"
              size="36"
              :text="initials"
              variant="tonal"
            />
          </v-btn>
        </template>

        <v-card min-width="240">
          <v-list>
            <v-list-item
              prepend-icon="mdi-account-circle"
              :subtitle="session.isAdmin ? t('app.administrator') : undefined"
              :title="session.isDesktop ? t('app.localUser') : session.session.user.name"
            />

            <v-divider class="my-1" />
            <!-- Without the rail (phones), the administration pages are reached from here. -->
            <template v-if="!mdAndUp">
              <v-list-item
                v-for="item in adminItems"
                :key="item.key"
                :prepend-icon="item.icon"
                :title="item.title"
                :to="item.to"
              />
            </template>

            <v-list-item
              v-if="!smAndUp"
              :prepend-icon="theme.current.value.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
              :title="t('app.toggleTheme')"
              @click="toggleTheme"
            />

            <v-list-item prepend-icon="mdi-cog-outline" :title="t('settings.title')" to="/settings" />

            <v-list-item
              v-if="!session.isDesktop"
              prepend-icon="mdi-logout"
              :title="t('app.signOut')"
              @click="session.logout()"
            />
          </v-list>
        </v-card>
      </v-menu>
    </v-app-bar>

    <!-- Vuetify's rail width (56 px): the icons line up with the app bar's menu icon. -->
    <v-navigation-drawer
      v-if="mdAndUp && !session.needsLogin"
      permanent
      rail
    >
      <v-list class="pt-3" nav>
        <v-list-item
          v-for="item in navItems"
          :key="item.key"
          v-tooltip:end="item.title"
          :aria-label="item.title"
          :exact="item.exact"
          :prepend-icon="item.icon"
          :to="item.to"
        />
      </v-list>

      <template #append>
        <v-list nav>
          <v-list-item
            v-for="item in footerItems"
            :key="item.key"
            v-tooltip:end="item.title"
            :aria-label="item.title"
            :prepend-icon="item.icon"
            :to="item.to"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <v-main>
      <slot />
    </v-main>

    <v-bottom-navigation v-if="!mdAndUp && !session.needsLogin" color="primary" grow>
      <v-btn
        v-for="item in navItems.slice(0, 4)"
        :key="item.key"
        :exact="item.exact"
        :prepend-icon="item.icon"
        stacked
        :text="item.short"
        :to="item.to"
      />
    </v-bottom-navigation>

    <CommandPalette v-if="!session.needsLogin" :target-id="targetId" />

    <v-snackbar-queue v-model="notifications.queue" location="bottom right" />
  </v-app>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { useQuery } from '@pinia/colada'
  import { useDisplay, useHotkey, useTheme } from 'vuetify'
  import basyxLogo from '~/assets/basyx-logo.svg'

  const { t } = useI18n()
  const theme = useTheme()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const session = useSessionStore()
  const notifications = useNotificationsStore()
  const ui = useUiStore()
  const drafts = useDraftStore()
  const label = useLocalizedLabel()
  const { mdAndUp, smAndUp, lgAndUp } = useDisplay()

  const targetId = computed(() => typeof route.params.targetId === 'string' ? route.params.targetId : null)
  const inShellBrowser = computed(() => targetId.value !== null && route.path.startsWith(`/targets/${targetId.value}/shells`))

  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
    enabled: () => !session.needsLogin && targetId.value !== null,
  })
  const draftCount = computed(() => targetId.value ? drafts.countFor(targetId.value) : 0)
  const targetItems = computed(() => (targets.data.value?.items ?? []).map(target => ({ title: target.name, value: target.id })))
  const target = computed(() => targets.data.value?.items.find(item => item.id === targetId.value) ?? null)

  function switchTarget (id: string) {
    // Another target never shows this target's shell or selection (UX-001).
    void router.push(`/targets/${id}`)
  }

  interface NavItem {
    key: string
    title: string
    short: string
    icon: string
    to: string | { path: string, query: Record<string, string> }
    exact?: boolean
  }

  // Modules of installed apps, for the current context (MVP-3): global ones
  // always, target ones inside a target, shell ones while a shell is open.
  const contributions = useAppContributions()
  const moduleItems = computed<NavItem[]>(() => {
    const shellKey = typeof route.params.shellKey === 'string'
      ? route.params.shellKey
      : (typeof route.query.shell === 'string' ? route.query.shell : null)
    return (contributions.data.value?.modules ?? []).flatMap(module => {
      const path = `apps/${module.installationId}/${module.route}`
      let to: NavItem['to']
      if (module.context === 'global') {
        to = `/${path}`
      } else if (targetId.value && (module.context === 'target' || shellKey)) {
        to = module.context === 'shell' ? { path: `/targets/${targetId.value}/${path}`, query: { shell: shellKey! } } : `/targets/${targetId.value}/${path}`
      } else {
        return []
      }
      const title = label(module.title)
      return [{ key: `${module.installationId}:${module.id}`, title, short: title, icon: module.icon ?? 'mdi-puzzle-outline', to }]
    })
  })

  const navItems = computed<NavItem[]>(() => {
    const items: NavItem[] = [{ key: 'targets', title: t('nav.targets'), short: t('nav.targetsShort'), icon: 'mdi-server-network', to: '/', exact: true }]
    if (targetId.value) {
      const base = `/targets/${targetId.value}`
      items.push(
        { key: 'dashboard', title: t('nav.dashboard'), short: t('nav.dashboardShort'), icon: 'mdi-view-dashboard-outline', to: base, exact: true },
        { key: 'shells', title: t('nav.shells'), short: t('nav.shellsShort'), icon: '$aas', to: `${base}/shells` },
      )
      if (target.value?.capabilities.conceptDescriptions) {
        items.push({ key: 'concepts', title: t('nav.concepts'), short: t('nav.conceptsShort'), icon: 'mdi-book-open-page-variant-outline', to: `${base}/concepts` })
      }
    }
    return [...items, ...moduleItems.value]
  })

  const adminItems = computed<NavItem[]>(() => session.isAdmin
    ? [
      { key: 'infrastructures', title: t('app.infrastructures'), short: t('app.infrastructures'), icon: 'mdi-server-plus-outline', to: '/admin/infrastructures' },
      { key: 'apps', title: t('app.apps'), short: t('app.apps'), icon: 'mdi-puzzle-outline', to: '/admin/apps' },
    ]
    : [])
  const footerItems = computed<NavItem[]>(() => [
    ...adminItems.value,
    { key: 'settings', title: t('settings.title'), short: t('settings.title'), icon: 'mdi-cog-outline', to: '/settings' },
  ])

  const preferences = usePreferences()
  function toggleTheme () {
    void preferences.update(current => ({ ...current, theme: theme.current.value.dark ? 'light' : 'dark' }))
  }

  const initials = computed(() => {
    const name = session.isDesktop ? t('app.localUser') : (session.session?.user.name ?? '')
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('')
  })

  useHotkey('cmd+k', () => {
    ui.commandOpen = true
  }, { inputs: true })
  useHotkey('cmd+e', () => {
    if (targetId.value) {
      ui.toggleMode()
    }
  })
  // Easter egg: the Konami code toggles the arcade theme (vuetify.config.ts).
  useKeySequence(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'], () => {
    ui.arcade = !ui.arcade
    notifications.notify({ text: t(ui.arcade ? 'app.arcadeOn' : 'app.arcadeOff'), color: 'success' })
  })
</script>
