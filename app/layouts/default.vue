<template>
  <v-app :theme="ui.arcade ? 'arcade' : undefined">
    <!-- Framed (useWindowPanel), the bar is the frame's top: compact, in the
         frame's colour, without a border. In the desktop app's window it is
         also the title bar, with the window controls inside it and the
         window dragged by it (title-bar.css). Three parts: start, the
         centred search, end. -->
    <v-app-bar
      :border="framed ? 0 : undefined"
      :class="{ 'title-bar': inDesktopWindow }"
      :color="framed ? 'frame' : undefined"
      :density="framed ? 'compact' : undefined"
    >
      <!-- The first control is an icon like the rail's and stands right over
           them (56 px rail, 48 px button: 4 px either side); in the desktop
           app the traffic lights come first. Between the controls of the
           bar, 8 px each (`me-2`). -->
      <div class="title-bar-start d-flex align-center flex-1-1-0 ps-1">
        <v-app-bar-nav-icon
          v-if="listToggleShown && !inDesktopWindow"
          :aria-label="inSubmodelBrowser ? t('app.toggleSubmodelList') : t('app.toggleShellList')"
          class="me-2"
          @click="ui.listDrawer = !(ui.listDrawer ?? mdAndUp)"
        />

        <!-- The browser has its own; the desktop window has these, a pair
             with no gap between them, then the list toggle. -->
        <template v-if="inDesktopWindow && !session.needsLogin">
          <v-btn-history
            v-tooltip="t('nav.back')"
            :aria-label="t('nav.back')"
            :disabled="!canGoBack"
            icon="mdi-arrow-left"
            @click="router.back()"
          />

          <v-btn-history
            v-tooltip="t('nav.forward')"
            :aria-label="t('nav.forward')"
            class="me-2"
            :disabled="!canGoForward"
            icon="mdi-arrow-right"
            @click="router.forward()"
          />

          <v-btn-history
            v-if="listToggleShown"
            :aria-label="inSubmodelBrowser ? t('app.toggleSubmodelList') : t('app.toggleShellList')"
            class="me-2"
            :icon="listDrawerOpen ? '$sidebarOpen' : '$sidebar'"
            @click="ui.listDrawer = !(ui.listDrawer ?? mdAndUp)"
          />
        </template>

        <!-- The desktop window and the dock carry the logo and name. -->
        <template v-if="!inDesktopWindow">
          <v-btn
            :active="false"
            :aria-label="branding.name.value"
            class="me-2"
            icon
            to="/"
          >
            <v-img alt="" height="24" :src="branding.mark.value" width="24" />
          </v-btn>

          <span v-if="lgAndUp" class="text-title-medium font-weight-bold me-2">{{ branding.name.value }}</span>
        </template>
      </div>

      <!-- The search takes a third of the bar, as the start and the end
           do, up to 560 px; when they need more room (narrow windows, the
           window controls of Windows), it gives way down to 320 px. -->
      <div class="d-flex align-center justify-center flex-1-1-0">
        <v-btn
          v-if="!session.needsLogin && mdAndUp"
          class="text-medium-emphasis"
          max-width="560"
          min-width="320"
          prepend-icon="mdi-magnify"
          spaced="end"
          variant="tonal"
          width="100%"
          @click="ui.commandOpen = true"
        >
          <span class="text-truncate">{{ targetId ? t('palette.searchTarget') : t('palette.search') }}</span>

          <template #append>
            <v-hotkey keys="cmd+k" />
          </template>
        </v-btn>
      </div>

      <div class="title-bar-end d-flex align-center justify-end flex-1-1-0 ms-2">

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
                :active="panel.current.value === 'settings'"
                prepend-icon="mdi-cog-outline"
                :title="t('settings.title')"
                @click="togglePanel('settings')"
              />

              <!-- The deployment's help and support, About and the legal pages (ADR 0055). -->
              <v-divider class="my-1" />

              <v-list-item
                v-if="branding.helpUrl.value"
                :href="branding.helpUrl.value"
                prepend-icon="mdi-help-circle-outline"
                rel="noopener noreferrer"
                target="_blank"
                :title="t('about.help')"
              />

              <v-list-item
                v-if="branding.supportUrl.value"
                :href="branding.supportUrl.value"
                prepend-icon="mdi-lifebuoy"
                rel="noopener noreferrer"
                target="_blank"
                :title="t('about.support')"
              />

              <v-list-item
                v-for="link in branding.legalLinks.value"
                :key="link.page"
                :href="link.href"
                :prepend-icon="link.icon"
                :rel="link.href ? 'noopener noreferrer' : undefined"
                :target="link.href ? '_blank' : undefined"
                :title="link.title"
                :to="link.to"
              />

              <v-list-item prepend-icon="mdi-information-outline" :title="t('about.link')" to="/about" />

              <v-list-item
                v-if="session.context?.loginRequired"
                prepend-icon="mdi-logout"
                :title="t('app.signOut')"
                @click="session.logout()"
              />
            </v-list>

            <v-divider />

            <div class="d-flex justify-center pa-1">
              <PoweredByBasyx />
            </div>
          </v-card>
        </v-menu>
      </div>
    </v-app-bar>

    <!-- Framed, the frame's bottom edge, under the panel and the side list,
         and its end edge: registered right after the bar, so the other
         drawers end above and before them. Decoration, hidden from screen
         readers, which would otherwise announce an empty navigation. -->
    <v-navigation-drawer
      v-if="framed"
      aria-hidden="true"
      border="0"
      color="frame"
      location="end"
      name="frame-end"
      permanent
      width="4"
    />

    <v-footer
      v-if="framed"
      app
      class="pa-0"
      color="frame"
      height="4"
    />

    <!-- Vuetify's rail width (56 px): the icons line up with the app bar's menu icon. -->
    <v-navigation-drawer
      v-if="mdAndUp && !session.needsLogin"
      :border="framed ? 0 : undefined"
      :color="framed ? 'frame' : undefined"
      name="rail"
      permanent
      rail
    >
      <!-- Studio Home sits above the groups, outside the list measured for overflow.
           The list's padding aligns the icon with the rail's edge. -->
      <template #prepend>
        <v-list class="pb-0" nav>
          <v-list-item
            v-tooltip:end="t('nav.home')"
            :active="homeActive"
            :aria-current="homeActive ? 'page' : undefined"
            :aria-label="t('nav.home')"
            prepend-icon="mdi-home-outline"
            to="/"
          />

          <!-- As the groups' divider, 4 px either side with the rail
               list's own top padding. -->
          <v-divider class="mx-auto mt-1" length="24" />
        </v-list>
      </template>

      <!-- The whole list takes the drag, so its gaps and divider do too. -->
      <v-list
        ref="railList"
        class="pt-1"
        nav
        @dragover="dragOver"
        @drop.prevent="drop"
      >
        <!-- The infrastructure's group, then the global one, divided; each
             reorders within itself (drag, or Alt+Up and Alt+Down).
             An open panel covers the page, so no page item is active then;
             clicking one leaves the panel for that page.
             An infrastructure's items slide in when it is opened and out when
             it is left; the items below make room. Reordering slides on its
             own (animateReorder), so the transition stays out of it. -->
        <v-slide-y-transition :disabled="reordering" group leave-absolute>
          <template v-for="(group, index) in rail" :key="group.name">
            <!-- 4 px either side, the items' own spacing; shorter than the
                 items, centred under their icons. -->
            <v-divider
              v-if="index > 0"
              :key="`${group.name}-divider`"
              class="mx-auto my-1"
              length="24"
            />

            <v-list-item
              v-for="item in group.items"
              :key="item.key"
              v-tooltip:end="{ text: item.title, disabled: dragging !== null }"
              :active="item.key === activeRailKey"
              :aria-current="item.key === activeRailKey ? 'page' : undefined"
              :aria-label="item.title"
              :class="{ 'opacity-40': dragging?.lifted && dragging.key === item.key }"
              :data-rail-group="group.name"
              :data-rail-key="item.key"
              draggable="true"
              :prepend-icon="item.icon"
              :to="item.to"
              @contextmenu="openItemMenu(item.key, $event)"
              @dragend="dragEnd"
              @dragstart="dragStart(group.name, item.key, $event)"
              @keydown.alt.down.prevent.stop="moveBy(group.name, item.key, 1, $event)"
              @keydown.alt.up.prevent.stop="moveBy(group.name, item.key, -1, $event)"
            />

            <!-- The group's hidden items, and the ones the rail has no room
                 for: the rail never scrolls. An item of the group dropped
                 here is hidden. Its menu is below, outside the transition. -->
            <v-list-item
              v-if="group.more.length > 0"
              :key="`${group.name}-more`"
              :ref="moreActivators[group.name]"
              v-tooltip:end="{ text: moreTitle(group.name), disabled: dragging !== null }"
              :active="group.more.some(({ item }) => item.key === activeRailKey) || overMore === group.name"
              :aria-label="moreTitle(group.name)"
              :data-rail-more="group.name"
              prepend-icon="mdi-dots-horizontal"
              @dragleave="overMore = null"
              @dragover.stop="dragOverMore(group.name, $event)"
              @drop.prevent.stop="dropOnMore"
            />
          </template>
        </v-slide-y-transition>
      </v-list>

      <v-menu
        v-for="group in rail.filter(entry => entry.more.length > 0)"
        :key="group.name"
        :activator="moreElements[group.name] ?? undefined"
        location="end"
      >
        <v-list>
          <v-list-subheader>{{ moreTitle(group.name) }}</v-list-subheader>

          <v-list-item
            v-for="{ item, hidden } in group.more"
            :key="item.key"
            :active="item.key === activeRailKey"
            :prepend-icon="item.icon"
            :title="item.title"
            @click="router.push(item.to)"
          >
            <template v-if="hidden" #append>
              <v-btn
                v-tooltip="t('nav.showInRail')"
                :aria-label="t('nav.showInRail')"
                icon="mdi-pin-outline"
                @click.stop="showInRail(item.key)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-menu>

      <!-- A rail item's own menu (right click, or the context menu key). -->
      <v-menu v-model="itemMenu.open" location="end" :target="itemMenu.target ?? undefined">
        <v-list>
          <v-list-item prepend-icon="mdi-eye-off-outline" :title="t('nav.hideFromRail')" @click="hideFromRail(itemMenu.key)" />
        </v-list>
      </v-menu>

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
    <!-- Framed, the side list is the start of the page's panel
         (useWindowPanel): the panel's start corners and its border, with the
         line towards the page. -->
    <v-navigation-drawer
      v-if="inShellBrowser && targetId && !panel.current.value && !session.needsLogin"
      v-model="listDrawerOpen"
      :border="sideList?.border"
      :rounded="sideList?.rounded"
      width="340"
    >
      <ShellListDrawer :active-key="shellKey" :target-id="targetId" />
    </v-navigation-drawer>

    <!-- The submodel list of the submodel view, the layout's for the same reason;
         none for a target that reaches submodels only through shells. -->
    <v-navigation-drawer
      v-else-if="inSubmodelBrowser && targetId && !panel.current.value && !session.needsLogin && routeTarget.data.value?.capabilities.submodelListSource !== null"
      v-model="listDrawerOpen"
      :border="sideList?.border"
      :rounded="sideList?.rounded"
      width="340"
    >
      <SubmodelListDrawer :active-key="selectedSubmodelKey" :target-id="targetId" />
    </v-navigation-drawer>

    <!-- Settings and administration open in place of the page, without
         leaving its route (usePanel), so the rail stays as it is. -->
    <!-- Framed, the bar and the rail are the frame, without borders, and
         the page is a panel inset in it on every side with rounded corners
         (WindowContent). -->
    <v-main :class="{ 'bg-frame': framed }">
      <WindowContent>
        <SettingsPanel v-if="panel.current.value === 'settings'" />
        <InfrastructuresPanel v-else-if="panel.current.value === 'infrastructures'" />
        <AppsPanel v-else-if="panel.current.value === 'apps'" />
        <BrandingPanel v-else-if="panel.current.value === 'branding'" />
        <slot v-else />
      </WindowContent>
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
  import type { RailGroupSettings, Target } from '#shared/contract'
  import type { ComponentPublicInstance } from 'vue'
  import type { PanelName } from '~/composables/usePanel'
  import type { RailMetrics } from '~/utils/navigation'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay, useHotkey, useTheme } from 'vuetify'
  import { sectionOf } from '~/stores/navigation'
  import { mergeOrder, moveKey, orderByKeys, phoneNavLayout, phoneNavSlots, railLayout, reorderShown } from '~/utils/navigation'

  type RailGroup = 'infrastructure' | 'global'

  const { t } = useI18n()
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
  /**
   * Studio runs in the desktop app's own window (its native bridge is
   * there), not in a browser tab opened on the desktop server: the app bar
   * is the window's title bar and the page an inset panel.
   */
  const desktop = useDesktopBridge()
  const inDesktopWindow = desktop !== null
  /** The side list's part of the panel: at the rail, and divided from the page. */
  const { framed, look } = useWindowPanel()
  const sideList = computed(() => look({ start: true, end: false }, { end: true }))
  const theme = useTheme()
  // The window controls in the title bar (Windows, Linux) take the frame's
  // colours, now and whenever the theme changes.
  watch(() => [theme.current.value.colors.frame, theme.current.value.colors['on-frame']] as const, ([color, symbolColor]) => {
    if (typeof color === 'string' && typeof symbolColor === 'string') {
      desktop?.setTitleBarColors?.({ color, symbolColor }).catch(() => {})
    }
  }, { immediate: true })
  /** The window's history around this page (Vue Router keeps it in the history state), for back and forward. */
  const historyState = computed(() => route.fullPath && import.meta.client ? window.history.state as { back?: string | null, forward?: string | null } | null : null)
  const canGoBack = computed(() => Boolean(historyState.value?.back))
  const canGoForward = computed(() => Boolean(historyState.value?.forward))

  const navigation = useNavigationStore()
  const targetId = computed(() => typeof route.params.targetId === 'string' ? route.params.targetId : null)
  // Outside any target (the targets list, global modules) the last opened
  // target stays current, so its navigation and controls do not disappear.
  const rememberedTargetId = computed(() => targetId.value ?? navigation.currentTarget)
  const routeTarget = useTarget(() => targetId.value ?? '')
  const inShellBrowser = computed(() => targetId.value !== null && route.path.startsWith(`/targets/${targetId.value}/shells`))
  const inSubmodelBrowser = computed(() => targetId.value !== null && route.path.startsWith(`/targets/${targetId.value}/submodels`))
  /** The app bar's toggle of the shell or submodel list, first in the bar. */
  const listToggleShown = computed(() => (inShellBrowser.value || inSubmodelBrowser.value) && !panel.current.value)
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
  const moduleItems = computed<Array<NavItem & { group: RailGroup }>>(() => {
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
      const group: RailGroup = module.context === 'global' ? 'global' : 'infrastructure'
      return [{ key: `${module.installationId}:${module.id}`, title, short: title, icon: module.icon ?? 'mdi-puzzle-outline', to, group }]
    })
  })

  /**
   * The rail's two groups: the current infrastructure's pages and apps, then
   * the global ones. Studio Home sits above both groups. Each group keeps
   * the user's order.
   */
  const railGroups = computed<Array<{ name: RailGroup, items: NavItem[] }>>(() => {
    const infrastructure: NavItem[] = []
    if (activeTargetId.value) {
      const base = `/targets/${activeTargetId.value}`
      infrastructure.push(
        { key: 'dashboard', title: t('nav.dashboard'), short: t('nav.dashboardShort'), icon: 'mdi-view-dashboard-outline', to: base, exact: true },
        { key: 'shells', title: t('nav.shells'), short: t('nav.shellsShort'), icon: '$aas', to: `${base}/shells` },
      )
      if (target.value?.capabilities.submodelListSource) {
        infrastructure.push({ key: 'submodels', title: t('nav.submodels'), short: t('nav.submodelsShort'), icon: 'mdi-file-tree-outline', to: `${base}/submodels` })
      }
      if (target.value?.capabilities.conceptDescriptions) {
        infrastructure.push({ key: 'concepts', title: t('nav.concepts'), short: t('nav.conceptsShort'), icon: 'mdi-book-open-page-variant-outline', to: `${base}/concepts` })
      }
    }
    const global: NavItem[] = []
    if (session.isDesktop) {
      global.push(
        { key: 'docker', title: t('nav.docker'), short: t('nav.dockerShort'), icon: 'mdi-docker', to: '/docker' },
        { key: 'app-builder', title: t('nav.appBuilder'), short: t('nav.appBuilderShort'), icon: 'mdi-creation-outline', to: '/app-builder' },
      )
    }
    for (const { group, ...item } of moduleItems.value) {
      (group === 'global' ? global : infrastructure).push(item)
    }
    // Returning to another section continues where the user left it (an
    // open panel covers the current section too); inside the section, the
    // item leads to its start.
    const currentSection = panel.current.value ? null : sectionOf(route.path)
    const resume = (item: NavItem) => typeof item.to === 'string' && !item.exact && sectionOf(item.to) !== currentSection
      ? { ...item, to: navigation.resume(item.to) }
      : item
    // While an item is dragged, its group shows the order it would get.
    const order = (name: RailGroup) => dragging.value?.group === name ? dragging.value.order : railSettings(name).order
    return ([['infrastructure', infrastructure], ['global', global]] as const)
      .map(([name, items]) => ({ name, items: orderByKeys(items, order(name)).map(item => resume(item)) }))
      .filter(group => group.items.length > 0)
  })

  // The global group is arranged once; the infrastructure's group per
  // infrastructure, as each may offer other apps.
  const emptyRailGroup: RailGroupSettings = { order: [], hidden: [] }
  function railSettings (name: RailGroup): RailGroupSettings {
    const { rail } = preferences.preferences.value
    if (name === 'global') {
      return rail.global
    }
    return (activeTargetId.value ? rail.infrastructures[activeTargetId.value] : undefined) ?? emptyRailGroup
  }
  function updateRail (name: RailGroup, change: (settings: RailGroupSettings) => RailGroupSettings) {
    // The infrastructure of now, not of when the preferences are saved.
    const id = activeTargetId.value
    void preferences.update(current => {
      if (name === 'global') {
        return { ...current, rail: { ...current.rail, global: change(current.rail.global) } }
      }
      if (!id) {
        return current
      }
      const infrastructures = { ...current.rail.infrastructures, [id]: change(current.rail.infrastructures[id] ?? emptyRailGroup) }
      return { ...current, rail: { ...current.rail, infrastructures } }
    })
  }
  function railGroupOf (key: string): RailGroup {
    return railGroups.value.find(group => group.items.some(item => item.key === key))?.name ?? 'infrastructure'
  }

  /** Items the user can not hide: an infrastructure's Home and Shells. */
  const fixedRailKeys = new Set(['dashboard', 'shells'])
  const hiddenRailKeys = computed(() => new Set([...railSettings('global').hidden, ...railSettings('infrastructure').hidden]))

  /** The rail item of the current page, by the longest path the page is in. */
  const activeRailKey = computed(() => {
    if (panel.current.value) {
      return null
    }
    const currentPath = route.path.replace(/\/$/, '')
    let active: { key: string, length: number } | null = null
    for (const item of railGroups.value.flatMap(group => group.items)) {
      const path = (typeof item.to === 'string' ? item.to : item.to.path).split(/[?#]/, 1)[0]!
      const matches = currentPath === path || (!item.exact && currentPath.startsWith(`${path}/`))
      if (matches && path.length > (active?.length ?? -1)) {
        active = { key: item.key, length: path.length }
      }
    }
    return active?.key ?? null
  })

  const railList = useTemplateRef<ComponentPublicInstance>('railList')

  // The rail's room, measured in the browser: as many items as fit, the
  // rest behind More. Until it is measured (on the server), all items show.
  const railMetrics = ref<RailMetrics | null>(null)
  const rail = computed(() => railLayout(railGroups.value, hiddenRailKeys.value, railMetrics.value, activeRailKey.value))

  /** Each group's More button, which opens the group's menu. */
  const moreElements = shallowReactive<Partial<Record<RailGroup, ComponentPublicInstance | null>>>({})
  // One function per group, so a render does not set the ref anew.
  const moreActivators = Object.fromEntries((['infrastructure', 'global'] as const).map(name => [
    name,
    (element: Element | ComponentPublicInstance | null) => {
      moreElements[name] = element as ComponentPublicInstance | null
    },
  ])) as Record<RailGroup, (element: Element | ComponentPublicInstance | null) => void>
  function moreTitle (name: RailGroup) {
    return name === 'global' ? t('nav.moreGlobalApps') : t('nav.moreInfrastructureApps')
  }

  function measureRail () {
    const list = railList.value?.$el as HTMLElement | undefined
    const content = list?.parentElement
    if (!list || !content) {
      railMetrics.value = null
      return
    }
    const pixels = (value: string) => Number.parseFloat(value) || 0
    const style = getComputedStyle(list)
    const items = [...list.querySelectorAll<HTMLElement>('[data-rail-key], [data-rail-more]')]
    // Every item but the first has the nav list's gap above it (4 px).
    const gap = items[1] ? pixels(getComputedStyle(items[1]).marginTop) : 4
    // The divider's margins take in the gap of the item after it.
    const divider = list.querySelector<HTMLElement>(':scope > hr')
    const dividerStyle = divider ? getComputedStyle(divider) : null
    railMetrics.value = {
      room: content.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom),
      item: (items[0]?.offsetHeight ?? 40) + gap,
      divider: divider && dividerStyle ? divider.offsetHeight + pixels(dividerStyle.marginTop) + pixels(dividerStyle.marginBottom) - gap : 5,
    }
  }
  // The rail's list fills the drawer above its bottom items, whatever it
  // holds, so its size changes only with the window's.
  let railObserver: ResizeObserver | undefined
  onMounted(() => watch(() => (railList.value?.$el as HTMLElement | undefined)?.parentElement, content => {
    railObserver?.disconnect()
    if (content) {
      railObserver = new ResizeObserver(() => measureRail())
      railObserver.observe(content)
      measureRail()
    } else {
      railMetrics.value = null
    }
  }, { flush: 'post', immediate: true }))
  onBeforeUnmount(() => railObserver?.disconnect())

  function hideFromRail (key: string | null) {
    if (key && !fixedRailKeys.has(key)) {
      updateRail(railGroupOf(key), settings => ({ ...settings, hidden: [...new Set([...settings.hidden, key])] }))
    }
  }
  function showInRail (key: string) {
    updateRail(railGroupOf(key), settings => ({ ...settings, hidden: settings.hidden.filter(entry => entry !== key) }))
  }

  /** A rail item's own menu, at the item. Items that can not be hidden have none. */
  const itemMenu = reactive<{ open: boolean, key: string | null, target: HTMLElement | null }>({ open: false, key: null, target: null })
  function openItemMenu (key: string, event: MouseEvent) {
    if (fixedRailKeys.has(key)) {
      return
    }
    event.preventDefault()
    Object.assign(itemMenu, { open: true, key, target: event.currentTarget as HTMLElement })
  }

  /** The rail's items that are not hidden, in one list, for the phones' bottom bar. */
  const navItems = computed(() => railGroups.value.flatMap(group => group.items).filter(item => !hiddenRailKeys.value.has(item.key)))
  const hiddenNavItems = computed(() => railGroups.value.flatMap(group => group.items).filter(item => hiddenRailKeys.value.has(item.key)))

  // Rail items are reordered by dragging, or with Alt+Up and Alt+Down, but
  // only within their own group. While dragging, the item takes the place
  // the pointer is at among the other items of its group (by their middles),
  // anywhere over the rail, gaps and divider included; outside its group it
  // stays at the group's edge. Dropped outside the rail, it goes back.
  // `lifted` dims the item's place once the browser has its drag image.
  const dragging = ref<{ group: RailGroup, key: string, order: string[], initial: string[], lifted: boolean } | null>(null)
  /** The group whose More an item is dragged over, to be hidden. */
  const overMore = ref<RailGroup | null>(null)
  /** While a reorder renders, so the rail's transition does not slide the items too. */
  const reordering = ref(false)

  /** A group's keys in their order, hidden items and the ones behind More included. */
  function groupKeys (name: RailGroup) {
    return railGroups.value.find(group => group.name === name)?.items.map(item => item.key) ?? []
  }
  /** A group's keys that the rail shows. */
  function shownKeys (name: RailGroup) {
    return rail.value.find(group => group.name === name)?.items.map(item => item.key) ?? []
  }
  function saveOrder (name: RailGroup, order: string[]) {
    updateRail(name, settings => ({ ...settings, order: mergeOrder(settings.order, order) }))
  }
  /** The rail's item elements in their order, of one group or of both. */
  function railElements (name?: RailGroup): HTMLElement[] {
    const root = railList.value?.$el as HTMLElement | undefined
    return root ? [...root.querySelectorAll<HTMLElement>(name ? `[data-rail-group="${name}"]` : '[data-rail-key]')] : []
  }

  /** An item's place in the layout, without the offset of its running slide. */
  function layoutBox (element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    const offset = new DOMMatrixReadOnly(getComputedStyle(element).transform).m42
    return { top: rect.top - offset, middle: rect.top - offset + rect.height / 2 }
  }

  /**
   * Lets the items slide from where they are seen to their new places
   * instead of jumping; a slide still running is taken over from where it is.
   */
  async function animateReorder (change: () => void) {
    const elements = railElements()
    const seen = new Map(elements.map(element => [element, element.getBoundingClientRect().top]))
    for (const element of elements) {
      for (const animation of element.getAnimations()) {
        animation.cancel()
      }
    }
    reordering.value = true
    change()
    await nextTick()
    reordering.value = false
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    for (const element of railElements()) {
      const from = seen.get(element)
      const offset = from === undefined ? 0 : from - layoutBox(element).top
      if (offset !== 0) {
        element.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], { duration: 150, easing: 'ease-out' })
      }
    }
  }

  function dragStart (name: RailGroup, key: string, event: DragEvent) {
    const order = groupKeys(name)
    dragging.value = { group: name, key, order, initial: order, lifted: false }
    const element = event.currentTarget as HTMLElement
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      // The item itself, held where it was grabbed, not the link's address.
      const rect = element.getBoundingClientRect()
      event.dataTransfer.setDragImage(element, event.clientX - rect.left, event.clientY - rect.top)
    }
    // After the browser took the drag image, so the image is not dimmed.
    setTimeout(() => {
      if (dragging.value?.key === key) {
        dragging.value.lifted = true
      }
    })
  }
  function dragOver (event: DragEvent) {
    const drag = dragging.value
    if (!drag) {
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    overMore.value = null
    const others = railElements(drag.group).filter(element => element.dataset.railKey !== drag.key)
    // By the items' places in the layout, not where they are seen while they
    // slide: so an item that just moved past the pointer stays where it is.
    const index = others.filter(element => layoutBox(element).middle < event.clientY).length
    const shown = others.map(element => element.dataset.railKey!)
    shown.splice(index, 0, drag.key)
    // Items the rail does not show keep their places in the group's order.
    const order = reorderShown(drag.order, shown)
    if (order.join('\n') !== drag.order.join('\n')) {
      void animateReorder(() => {
        drag.order = order
      })
    }
  }
  function drop () {
    if (dragging.value) {
      saveOrder(dragging.value.group, dragging.value.order)
    }
    dragging.value = null
  }
  /** Over More, the item goes back to its place, and a drop hides it there. */
  function dragOverMore (name: RailGroup, event: DragEvent) {
    const drag = dragging.value
    // Only the item's own group's More takes it.
    if (!drag || drag.group !== name || fixedRailKeys.has(drag.key)) {
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    if (overMore.value !== name) {
      overMore.value = name
      void animateReorder(() => {
        drag.order = drag.initial
      })
    }
  }
  function dropOnMore () {
    const key = dragging.value?.key ?? null
    overMore.value = null
    dragging.value = null
    hideFromRail(key)
  }
  /** Without a drop (released outside the rail, or Escape), the item slides back. */
  function dragEnd () {
    overMore.value = null
    if (dragging.value) {
      void animateReorder(() => {
        dragging.value = null
      })
    }
  }
  function moveBy (name: RailGroup, key: string, step: -1 | 1, event: KeyboardEvent) {
    const keys = shownKeys(name)
    const target = keys[keys.indexOf(key) + step]
    if (target) {
      // Moving the element drops its focus; it gets it back, for the next step.
      const element = event.currentTarget as HTMLElement | null
      void animateReorder(() => saveOrder(name, reorderShown(groupKeys(name), moveKey(keys, key, target)))).then(() => element?.focus())
    }
  }

  /** The phones' bottom bar; Shells sits in the middle, raised. */
  const phoneNav = computed(() => phoneNavLayout(navItems.value, item => item.key === 'shells', phoneNavSlots, hiddenNavItems.value))
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
  const homeActive = computed(() => !panel.current.value && route.path === '/')
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
