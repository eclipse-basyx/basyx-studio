<template>
  <v-app :theme="ui.arcade ? 'arcade' : undefined">
    <v-app-bar>
      <v-app-bar-nav-icon
        v-if="(inShellBrowser || inSubmodelBrowser) && !panel.current.value"
        :aria-label="inSubmodelBrowser ? t('app.toggleSubmodelList') : t('app.toggleShellList')"
        @click="ui.listDrawer = !(ui.listDrawer ?? mdAndUp)"
      />

      <v-btn
        :active="false"
        :aria-label="lgAndUp ? undefined : branding.name.value"
        class="ms-2 me-3"
        size="large"
        to="/"
      >
        <template #prepend>
          <!-- Decorative where the name stands next to it; the name otherwise. -->
          <v-img :alt="lgAndUp ? '' : branding.name.value" :src="branding.logo.value" width="28" />
        </template>

        <span v-if="lgAndUp" class="text-title-medium font-weight-bold">{{ branding.name.value }}</span>
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

      <template v-if="!session.needsLogin && activeTargetId">
        <!-- The active target stays visible at every width (design guidelines);
             a menu button like the other app bar controls, its name from sm up. -->
        <v-menu v-if="targetItems.length > 0">
          <template #activator="{ props }">
            <!-- Unsaved changes of a package show here where the package bar has no room for its chip. -->
            <v-badge
              class="me-2"
              color="warning"
              dot
              :model-value="Boolean(target?.workspace?.unsavedChanges) && !lgAndUp"
            >
              <v-btn
                v-if="smAndUp"
                v-bind="props"
                append-icon="mdi-chevron-down"
                :aria-label="t('app.targetNamed', { name: target?.name ?? '' })"
                border
                :max-width="mdAndUp ? 280 : 200"
                :prepend-icon="target?.workspace ? 'mdi-package-variant-closed' : 'mdi-server-network'"
              >
                <span class="text-truncate">{{ target?.name }}</span>
              </v-btn>

              <v-btn
                v-else
                v-bind="props"
                :aria-label="t('app.targetNamed', { name: target?.name ?? '' })"
                :icon="target?.workspace ? 'mdi-package-variant-closed' : 'mdi-server-network'"
              />
            </v-badge>
          </template>

          <v-card min-width="240">
            <v-list :selected="[activeTargetId]">
              <!-- Open packages first, each with its unsaved changes (package editing plan, M4). -->
              <template v-for="group in targetGroups" :key="group.title">
                <v-list-subheader>{{ group.title }}</v-list-subheader>

                <v-list-item
                  v-for="item in group.items"
                  :key="item.value"
                  :prepend-icon="item.icon"
                  :title="item.title"
                  :value="item.value"
                  @click="switchTarget(item.value)"
                >
                  <template v-if="item.unsaved" #append>
                    <v-icon v-tooltip="t('workspace.unsaved')" color="warning" icon="mdi-circle-medium" />
                  </template>
                </v-list-item>
              </template>
            </v-list>
          </v-card>
        </v-menu>

        <WorkspaceBar v-if="target?.workspace" :target="target" />

        <!-- Applied-but-unfinished work of this target stays visible (MVP-5 plan, W7). -->
        <v-chip
          v-if="ui.editing && draftCount > 0"
          class="me-2"
          color="warning"
          prepend-icon="mdi-circle-medium"
          :text="t('app.drafts', draftCount)"
        />

        <v-btn-toggle
          v-if="smAndUp && canEdit"
          v-model="ui.mode"
          class="me-2"
          mandatory
        >
          <v-btn prepend-icon="mdi-eye-outline" :text="t('app.view')" value="view" />
          <v-btn prepend-icon="mdi-pencil-outline" :text="t('app.edit')" value="edit" />
        </v-btn-toggle>

        <v-btn
          v-else-if="canEdit"
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
            :aria-label="`${initials} ${t('app.account')}`"
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
              :title="displayName"
            />

            <v-divider class="my-1" />
            <!-- Without the rail (phones), the administration panels are reached from here. -->
            <template v-if="!mdAndUp">
              <v-list-item
                v-for="item in adminItems"
                :key="item.key"
                :active="item.active"
                :prepend-icon="item.icon"
                :title="item.title"
                @click="togglePanel(item.key)"
              />
            </template>

            <v-list-item
              v-if="!smAndUp"
              :prepend-icon="theme.current.value.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
              :title="t('app.toggleTheme')"
              @click="toggleTheme"
            />

            <v-list-item
              :active="panel.current.value === 'settings'"
              prepend-icon="mdi-cog-outline"
              :title="t('settings.title')"
              @click="togglePanel('settings')"
            />

            <v-list-item
              v-if="session.context?.loginRequired"
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
        <!-- An open panel covers the page, so no page item is active then;
             clicking one leaves the panel for that page. -->
        <v-list-item
          v-for="item in navItems"
          :key="item.key"
          v-tooltip:end="item.title"
          :active="pageActive"
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
            :active="item.active"
            :aria-label="item.title"
            :prepend-icon="item.icon"
            @click="togglePanel(item.key)"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- The shell list of the shell pages. The drawer is the layout's and
         renders before v-main, so the server-rendered page already leaves its
         room; registered from a page, or from a component that loads data on
         the server, it came too late and the page moved on hydration. -->
    <v-navigation-drawer
      v-if="inShellBrowser && targetId && !panel.current.value && !session.needsLogin"
      v-model="listDrawerOpen"
      width="340"
    >
      <ShellListDrawer :active-key="shellKey" :target-id="targetId" />
    </v-navigation-drawer>

    <!-- The submodel list of the submodel view, the layout's for the same reason;
         none for a target that reaches submodels only through shells. -->
    <v-navigation-drawer
      v-else-if="inSubmodelBrowser && targetId && !panel.current.value && !session.needsLogin && routeTarget.data.value?.capabilities.submodelListSource !== null"
      v-model="listDrawerOpen"
      width="340"
    >
      <SubmodelListDrawer :active-key="selectedSubmodelKey" :target-id="targetId" />
    </v-navigation-drawer>

    <!-- Settings and administration open in place of the page, without
         leaving its route (usePanel), so the rail stays as it is. -->
    <v-main>
      <SettingsPanel v-if="panel.current.value === 'settings'" />
      <InfrastructuresPanel v-else-if="panel.current.value === 'infrastructures'" />
      <AppsPanel v-else-if="panel.current.value === 'apps'" />
      <slot v-else />
    </v-main>

    <!-- Phones: five equal slots. Shells, the heart of Studio, is the raised
         button in the middle with two slots on either side; when more items
         exist than fit, the last slot opens the rest. -->
    <v-footer
      v-if="!mdAndUp && !session.needsLogin"
      app
      :aria-label="t('app.mainNavigation')"
      border="t"
      class="pa-0 align-end"
      tag="nav"
    >
      <template v-for="(item, index) in phoneNav.start" :key="item?.key ?? `start-${index}`">
        <v-btn
          v-if="item"
          :active="pageActive"
          active-color="primary"
          class="flex-1-1-0 px-0"
          :exact="item.exact"
          height="56"
          min-width="0"
          :prepend-icon="item.icon"
          rounded="0"
          stacked
          :text="item.short"
          :to="item.to"
        />

        <!-- An empty slot keeps the grid, so no button grows. -->
        <div v-else class="flex-1-1-0" />
      </template>

      <div v-if="phoneNav.centre" class="d-flex justify-center flex-1-1-0">
        <v-sheet class="mt-n6 mb-2 pa-1" color="surface" rounded="circle">
          <v-btn-primary
            :aria-label="phoneNav.centre.title"
            :icon="phoneNav.centre.icon"
            rounded="circle"
            :to="phoneNav.centre.to"
          />
        </v-sheet>
      </div>

      <template v-for="(item, index) in phoneNav.end" :key="item?.key ?? `end-${index}`">
        <v-btn
          v-if="item"
          :active="pageActive"
          active-color="primary"
          class="flex-1-1-0 px-0"
          :exact="item.exact"
          height="56"
          min-width="0"
          :prepend-icon="item.icon"
          rounded="0"
          stacked
          :text="item.short"
          :to="item.to"
        />

        <!-- An empty slot keeps the grid, so no button grows. -->
        <div v-else class="flex-1-1-0" />
      </template>

      <v-btn
        v-if="phoneNav.more.length > 0"
        :active="moreActive"
        active-color="primary"
        class="flex-1-1-0 px-0"
        height="56"
        min-width="0"
        prepend-icon="mdi-dots-horizontal"
        rounded="0"
        stacked
        :text="t('nav.more')"
        @click="moreOpen = true"
      />
    </v-footer>

    <v-bottom-sheet v-model="moreOpen">
      <v-card>
        <v-list nav>
          <v-list-item
            v-for="item in phoneNav.more"
            :key="item.key"
            :active="pageActive"
            :exact="item.exact"
            :prepend-icon="item.icon"
            :title="item.title"
            :to="item.to"
            @click="moreOpen = false"
          />
        </v-list>
      </v-card>
    </v-bottom-sheet>

    <CommandPalette v-if="!session.needsLogin" :target-id="targetId" />

    <!-- The plan and report of a paste or an import (package editing plan, K4). -->
    <CopyPlanDialog />

    <!-- The one full-screen file viewer: from the details pane and from apps (ADR 0052). -->
    <FileViewerDialog />

    <!-- One import dialog for the current target: the dashboard, the shell list,
         drops and the command palette open it through the UI store. -->
    <UploadDialog
      v-if="routeTarget.data.value && canImportInto(routeTarget.data.value)"
      v-model="ui.uploadOpen"
      :initial-file="ui.uploadFile"
      :shell-key="ui.uploadShellKey"
      :target="routeTarget.data.value"
    />

    <v-snackbar-queue v-model="notifications.queue" location="bottom right" />
  </v-app>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import type { PanelName } from '~/composables/usePanel'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay, useHotkey, useTheme } from 'vuetify'
  import { sectionOf } from '~/stores/navigation'
  import { phoneNavLayout } from '~/utils/navigation'

  const { t } = useI18n()
  const theme = useTheme()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const session = useSessionStore()
  const branding = useBranding()
  const notifications = useNotificationsStore()
  const ui = useUiStore()
  const drafts = useDraftStore()
  const label = useLocalizedLabel()
  const { mdAndUp, smAndUp, lgAndUp } = useDisplay()

  const navigation = useNavigationStore()
  const targetId = computed(() => typeof route.params.targetId === 'string' ? route.params.targetId : null)
  // Outside any target (the targets list, global modules) the last opened
  // target stays current, so its navigation and controls do not disappear.
  const rememberedTargetId = computed(() => targetId.value ?? navigation.currentTarget)
  const routeTarget = useTarget(() => targetId.value ?? '')
  const inShellBrowser = computed(() => targetId.value !== null && route.path.startsWith(`/targets/${targetId.value}/shells`))
  const inSubmodelBrowser = computed(() => targetId.value !== null && route.path.startsWith(`/targets/${targetId.value}/submodels`))
  /** The selected submodel of the submodel view, for the list's highlight. */
  const selectedSubmodelKey = computed(() => typeof route.query.submodel === 'string' ? route.query.submodel : null)
  /** The shell list is open unless the user closed it; on phones it starts closed. */
  const listDrawerOpen = computed({
    get: () => ui.listDrawer ?? mdAndUp.value,
    set: (value: boolean) => (ui.listDrawer = value),
  })
  /** The open shell of the shell browser, for the list's highlight. */
  const shellKey = computed(() => typeof route.params.shellKey === 'string' ? route.params.shellKey : null)

  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
    enabled: () => !session.needsLogin && rememberedTargetId.value !== null,
  })
  const listedTarget = computed(() => targets.data.value?.items.find(item => item.id === rememberedTargetId.value) ?? null)
  // The route's own query is fresher than the list: an applied edit changes a
  // package's unsaved state there first (the package bar, H5).
  const target = computed(() => routeTarget.data.value?.id === listedTarget.value?.id ? (routeTarget.data.value ?? listedTarget.value) : listedTarget.value)
  // The list follows, so the target menu and the package groups mark it too (M1).
  const queryCache = useQueryCache()
  watch(() => JSON.stringify(routeTarget.data.value?.workspace ?? null), (state, previous) => {
    if (previous !== undefined && state !== previous) {
      void queryCache.invalidateQueries({ key: ['targets'], exact: true })
    }
  })
  // A remembered target that was removed or is no longer listed is not current.
  const activeTargetId = computed(() => targetId.value ?? target.value?.id ?? null)
  const fileDrafts = useFileDraftStore()
  const draftCount = computed(() => activeTargetId.value ? drafts.countFor(activeTargetId.value) + fileDrafts.countFor(activeTargetId.value) : 0)
  /** Edit mode only where the target allows some change (not in a read-only deployment). */
  const canEdit = computed(() => {
    const capabilities = target.value?.capabilities
    return !capabilities || capabilities.write || capabilities.writeStructure || capabilities.createResources || capabilities.deleteShells
  })
  watch(canEdit, allowed => {
    if (!allowed) {
      ui.mode = 'view'
    }
  }, { immediate: true })
  const targetItems = computed(() => (targets.data.value?.items ?? []).map(target => ({
    title: target.name,
    value: target.id,
    icon: target.workspace ? 'mdi-package-variant-closed' : 'mdi-server-network',
    unsaved: Boolean(target.workspace?.unsavedChanges),
    workspace: Boolean(target.workspace),
  })))
  const targetGroups = computed(() => [
    { title: t('app.packages'), items: targetItems.value.filter(item => item.workspace) },
    { title: targetItems.value.some(item => item.workspace) ? t('app.infrastructures') : t('app.target'), items: targetItems.value.filter(item => !item.workspace) },
  ].filter(group => group.items.length > 0))

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
      } else if (activeTargetId.value && (module.context === 'target' || shellKey)) {
        to = module.context === 'shell' ? { path: `/targets/${activeTargetId.value}/${path}`, query: { shell: shellKey! } } : `/targets/${activeTargetId.value}/${path}`
      } else {
        return []
      }
      const title = label(module.title)
      return [{ key: `${module.installationId}:${module.id}`, title, short: title, icon: module.icon ?? 'mdi-puzzle-outline', to }]
    })
  })

  const navItems = computed<NavItem[]>(() => {
    const items: NavItem[] = [{ key: 'targets', title: t('nav.targets'), short: t('nav.targetsShort'), icon: 'mdi-server-network', to: '/', exact: true }]
    if (session.isDesktop) {
      items.push(
        { key: 'docker', title: t('nav.docker'), short: t('nav.dockerShort'), icon: 'mdi-docker', to: '/docker' },
        { key: 'app-builder', title: t('nav.appBuilder'), short: t('nav.appBuilderShort'), icon: 'mdi-creation-outline', to: '/app-builder' },
      )
    }
    if (activeTargetId.value) {
      const base = `/targets/${activeTargetId.value}`
      items.push(
        { key: 'dashboard', title: t('nav.dashboard'), short: t('nav.dashboardShort'), icon: 'mdi-view-dashboard-outline', to: base, exact: true },
        { key: 'shells', title: t('nav.shells'), short: t('nav.shellsShort'), icon: '$aas', to: `${base}/shells` },
      )
      if (target.value?.capabilities.submodelListSource) {
        items.push({ key: 'submodels', title: t('nav.submodels'), short: t('nav.submodelsShort'), icon: 'mdi-file-tree-outline', to: `${base}/submodels` })
      }
      if (target.value?.capabilities.conceptDescriptions) {
        items.push({ key: 'concepts', title: t('nav.concepts'), short: t('nav.conceptsShort'), icon: 'mdi-book-open-page-variant-outline', to: `${base}/concepts` })
      }
    }
    // Returning to another section continues where the user left it (an
    // open panel covers the current section too); inside the section, the
    // item leads to its start.
    const currentSection = panel.current.value ? null : sectionOf(route.path)
    return [...items, ...moduleItems.value].map(item => typeof item.to === 'string' && !item.exact && sectionOf(item.to) !== currentSection
      ? { ...item, to: navigation.resume(item.to) }
      : item)
  })

  /** The phones' bottom bar; Shells sits in the middle, raised. */
  const phoneNav = computed(() => phoneNavLayout(navItems.value, item => item.key === 'shells'))
  const moreOpen = ref(false)
  /** The page is one of the items behind More. */
  const moreActive = computed(() => !panel.current.value && phoneNav.value.more.some(item => {
    const path = typeof item.to === 'string' ? item.to : item.to.path
    return sectionOf(path) !== null && sectionOf(path) === sectionOf(route.path)
  }))

  watch(() => route.fullPath, () => {
    const { panel: _, ...query } = route.query
    navigation.remember(route.path, router.resolve({ path: route.path, query, hash: route.hash }).fullPath)
  }, { immediate: true })

  // Settings and administration are panels over the current page: their
  // items open and close them instead of navigating.
  const panel = usePanel()
  // `false` overrides the router link's own active state; `undefined` keeps it.
  const pageActive = computed(() => panel.current.value ? false : undefined)
  function togglePanel (name: PanelName) {
    if (panel.current.value === name) {
      panel.close()
    } else {
      panel.open(name)
    }
  }

  interface PanelItem {
    key: PanelName
    title: string
    icon: string
    active: boolean
  }

  function panelItem (key: PanelName, title: string, icon: string): PanelItem {
    return { key, title, icon, active: panel.current.value === key }
  }

  const adminItems = computed<PanelItem[]>(() => session.isAdmin
    ? [
      panelItem('infrastructures', t('app.infrastructures'), 'mdi-server-plus-outline'),
      panelItem('apps', t('app.apps'), 'mdi-puzzle-outline'),
    ]
    : [])
  const footerItems = computed<PanelItem[]>(() => [
    ...adminItems.value,
    // While Settings is open, the item closes it again.
    { ...panelItem('settings', t('settings.title'), 'mdi-cog-outline'), ...(panel.current.value === 'settings' && { title: t('settings.close') }) },
  ])

  const preferences = usePreferences()
  function toggleTheme () {
    void preferences.update(current => ({ ...current, theme: theme.current.value.dark ? 'light' : 'dark' }))
  }

  /** The desktop's local user, the anonymous user without login, or the signed-in user. */
  const displayName = computed(() => {
    if (session.isDesktop) {
      return t('app.localUser')
    }
    return session.context?.anonymous ? t('app.anonymous') : (session.session?.user.name ?? '')
  })

  const initials = computed(() => {
    return displayName.value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('')
  })

  useHotkey('cmd+k', () => {
    ui.commandOpen = true
  }, { inputs: true })
  useHotkey('cmd+e', () => {
    if (activeTargetId.value && canEdit.value) {
      ui.toggleMode()
    }
  })
  // Easter egg: the Konami code toggles the arcade theme (vuetify.config.ts).
  useKeySequence(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'], () => {
    ui.arcade = !ui.arcade
    notifications.notify({ text: t(ui.arcade ? 'app.arcadeOn' : 'app.arcadeOff'), color: 'success' })
  })
</script>
