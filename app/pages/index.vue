<template>
  <v-container>
    <v-empty-state
      v-if="session.needsLogin"
      :image="basyxLogo"
      size="96"
      :text="t('home.signInText')"
      :title="t('home.signInTitle')"
    >
      <template #actions>
        <v-btn-primary :loading="signingIn" prepend-icon="mdi-login" :text="t('app.signIn')" @click="signIn" />
      </template>
    </v-empty-state>

    <template v-else>
      <PageHeader :subtitle="items.length > 3 ? t('home.subtitleCount', items.length) : t('home.subtitle')" :title="t('home.title')">
        <template #actions>
          <v-btn-secondary
            v-if="session.isAdmin"
            prepend-icon="mdi-plus"
            :text="t('home.addInfrastructure')"
            @click="addOpen = true"
          />

          <v-btn-secondary
            v-if="bridge"
            :loading="opening"
            prepend-icon="mdi-package-variant-plus"
            :text="t('workspace.new')"
            @click="newPackage"
          />

          <v-btn-primary
            v-if="bridge"
            :loading="opening"
            prepend-icon="mdi-folder-open-outline"
            :text="t('workspace.open')"
            @click="openPackage"
          />
        </template>
      </PageHeader>

      <ProblemAlert v-if="authError" class="mb-4" :error="authErrorProblem" />
      <ProblemAlert v-if="openError" class="mb-4" :error="openError" />

      <ProblemAlert
        v-if="targets.error.value"
        class="mb-4"
        :error="targets.error.value"
        retry
        @retry="targets.refetch()"
      />

      <v-card v-if="targets.isPending.value">
        <v-skeleton-loader type="list-item-avatar-two-line@3" />
      </v-card>

      <!-- One card, as the other record lists: the search across its full
           width beside the view, the filters in the search field's menu. -->
      <v-card v-else-if="items.length > 0">
        <ListFilterBar
          v-model:search="search"
          v-model:selected="selected"
          :groups="filterGroups"
          :placeholder="t('home.search')"
        >
          <template #append>
            <v-btn-toggle v-model="view" :aria-label="t('home.view.label')" mandatory>
              <v-btn-toggle-icon v-tooltip="t('home.view.grid')" :aria-label="t('home.view.grid')" icon="mdi-view-grid-outline" value="grid" />
              <v-btn-toggle-icon v-tooltip="t('home.view.list')" :aria-label="t('home.view.list')" icon="mdi-view-list-outline" value="list" />
            </v-btn-toggle>
          </template>
        </ListFilterBar>

        <v-divider />

        <template v-if="filtered.length > 0">
          <v-card-text v-if="view === 'grid'">
            <v-row density="compact">
              <v-col
                v-for="target in filtered"
                :key="target.id"
                cols="12"
                lg="4"
                sm="6"
              >
                <TargetCard :target="target" />
              </v-col>
            </v-row>
          </v-card-text>

          <!-- Many targets at a glance: one row each, the action on hover. -->
          <v-list-records v-else>
            <template v-for="(target, index) in filtered" :key="target.id">
              <v-divider v-if="index > 0" />

              <RecordListItem
                :icon="targetIcon(target)"
                :subtitle="targetSubtitle(target, t('landing.subtitle'))"
                :title="target.name"
                :to="`/targets/${target.id}`"
              >
                <template #meta>
                  <TargetChips :target="target" />
                </template>

                <template #actions>
                  <v-btn-primary
                    v-if="target.authenticationState === 'required'"
                    prepend-icon="mdi-key-outline"
                    size="small"
                    :text="t('target.authorize')"
                    @click.stop.prevent="navigateTo(`/targets/${target.id}/shells`)"
                  />

                  <v-btn-primary
                    v-else
                    append-icon="mdi-arrow-right"
                    size="small"
                    :text="t('landing.openViewer')"
                    @click.stop.prevent="navigateTo(`/targets/${target.id}/shells`)"
                  />
                </template>
              </RecordListItem>
            </template>
          </v-list-records>
        </template>

        <v-empty-state
          v-else
          icon="mdi-magnify"
          :text="t('lists.noMatches')"
        >
          <template #actions>
            <v-btn-secondary :text="t('home.resetFilters')" @click="resetFilters" />
          </template>
        </v-empty-state>
      </v-card>

      <v-empty-state
        v-else-if="targets.data.value"
        icon="mdi-server-network-off"
        :text="session.isAdmin ? t('home.noTargetsAdmin') : t('home.noTargetsUser')"
        :title="t('home.noTargets')"
      >
        <template v-if="session.isAdmin" #actions>
          <v-btn-primary :text="t('home.addInfrastructure')" @click="addOpen = true" />
        </template>
      </v-empty-state>

      <InfrastructureDialog v-if="session.isAdmin" v-model="addOpen" :existing="null" @saved="added" />
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import type { DesktopBridge } from '~/composables/useDesktopBridge'
  import type { FilterGroup } from '~/utils/records'
  import { useQuery } from '@pinia/colada'
  import basyxLogo from '~/assets/basyx-logo.svg'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { securityModeIcons, targetIcon, targetSubtitle } from '~/utils/aas'
  import { filterRecords } from '~/utils/records'

  const { t } = useI18n()
  const route = useRoute()
  const session = useSessionStore()
  const api = useStudioApi()

  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
    enabled: () => !session.needsLogin,
  })

  const items = computed(() => targets.data.value?.items ?? [])

  /** Whether a target is ready to browse, waits for authorization, or is a local package. */
  type TargetState = 'ready' | 'required' | 'workspace'
  function stateOf (target: Target): TargetState {
    if (target.workspace) {
      return 'workspace'
    }
    return target.authenticationState === 'required' ? 'required' : 'ready'
  }

  /** Security mode, or `workspace` for a local package. */
  function kindOf (target: Target): string {
    return target.securityMode ?? 'workspace'
  }

  // Kept while the user visits other pages (usePageState).
  const search = usePageState<string | null>('targets:search', () => null)
  const selected = usePageState<string[]>('targets:filters', () => [])

  // Filters for the states and kinds of access that occur; a group with a
  // single option would not filter anything. Local packages are an access kind.
  const filterGroups = computed<FilterGroup[]>(() => [
    {
      title: t('home.filters.state'),
      options: (['ready', 'required'] as const)
        .filter(state => items.value.some(target => stateOf(target) === state))
        .map(state => ({ value: `state:${state}`, title: t(`home.filters.${state}`) })),
    },
    {
      title: t('home.filters.access'),
      options: [...new Set(items.value.map(target => kindOf(target)))].map(kind => ({
        value: `security:${kind}`,
        title: kind === 'workspace' ? t('workspace.localFile') : t(`security.${kind}`),
        icon: kind === 'workspace' ? 'mdi-package-variant-closed' : securityModeIcons[kind],
      })),
    },
  ].filter(group => group.options.length > 1))

  // Cards for a few targets, rows for many, until the user picks a view;
  // the choice is a user preference, saved in the background.
  const preferences = usePreferences()
  const view = computed({
    get: () => preferences.preferences.value.targetsView ?? (items.value.length > 6 ? 'list' : 'grid'),
    set: value => void preferences.update(current => ({ ...current, targetsView: value })),
  })

  const filtered = computed(() => filterRecords(items.value, search.value, selected.value, target => ({
    text: [target.name, target.description, target.workspace?.fileName],
    facets: [`state:${stateOf(target)}`, `security:${kindOf(target)}`],
  })))

  function resetFilters () {
    search.value = null
    selected.value = []
  }

  // An infrastructure added here becomes a target in this list.
  const addOpen = ref(false)
  const invalidate = useInvalidate()
  async function added () {
    await invalidate(['targets'], ['admin', 'infrastructures'])
  }

  const authError = computed(() => typeof route.query.authError === 'string' ? route.query.authError : null)
  const authErrorProblem = computed(() => new StudioApiError({
    type: 'about:blank',
    title: 'Authorization failed',
    status: 400,
    code: authError.value === 'access_denied' ? 'forbidden' : 'target_auth_required',
    requestId: '-',
    retryable: false,
  }))

  // Desktop only: open a local AASX package as a workspace target.
  const bridge = ref<DesktopBridge | null>(null)
  onMounted(() => (bridge.value = useDesktopBridge()))
  const opening = ref(false)
  const openError = ref<unknown>(null)

  /** A new, empty package (MVP-5 plan, P4); *Save as* gives it a file. */
  const ui = useUiStore()

  async function newPackage () {
    opening.value = true
    openError.value = null
    try {
      const target = await api<Target>('/workspaces', { method: 'POST', body: { empty: true } })
      ui.mode = 'edit'
      await navigateTo(`/targets/${target.id}/shells`)
    } catch (error) {
      openError.value = error
    } finally {
      opening.value = false
    }
  }

  async function openPackage () {
    opening.value = true
    openError.value = null
    try {
      const grant = await bridge.value?.chooseAasxFile()
      if (grant) {
        const target = await api<Target>('/workspaces', { method: 'POST', body: { fileHandle: grant.handle } })
        await navigateTo(`/targets/${target.id}/shells`)
      }
    } catch (error) {
      openError.value = error
    } finally {
      opening.value = false
    }
  }

  const signingIn = ref(false)
  async function signIn () {
    signingIn.value = true
    const returnTo = typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') ? route.query.returnTo : '/'
    try {
      await session.login(returnTo)
    } finally {
      signingIn.value = false
    }
  }
</script>
