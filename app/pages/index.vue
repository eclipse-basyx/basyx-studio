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

      <v-row v-if="targets.isPending.value" dense>
        <v-col
          v-for="index in 3"
          :key="index"
          cols="12"
          lg="4"
          sm="6"
        >
          <v-card>
            <v-skeleton-loader type="list-item-avatar-two-line, text, actions" />
          </v-card>
        </v-col>
      </v-row>

      <template v-else-if="items.length > 0">
        <!-- Search and view are always there; the state filter only where several states occur. -->
        <div class="d-flex flex-wrap align-center ga-2 mb-3">
          <v-text-field
            v-model="search"
            :aria-label="t('home.search')"
            class="flex-grow-1"
            clearable
            density="compact"
            max-width="420"
            min-width="220"
            :placeholder="t('home.search')"
            prepend-inner-icon="mdi-magnify"
          />

          <v-btn-toggle v-if="stateOptions.length > 2" v-model="state" :aria-label="t('home.filters.state')" mandatory>
            <v-btn v-for="option in stateOptions" :key="option.value" :value="option.value">
              {{ option.title }}
              <span class="ms-2 text-medium-emphasis">{{ option.count }}</span>
            </v-btn>
          </v-btn-toggle>

          <v-spacer />

          <v-btn-toggle v-model="view" :aria-label="t('home.view.label')" mandatory>
            <v-btn v-tooltip="t('home.view.grid')" :aria-label="t('home.view.grid')" icon="mdi-view-grid-outline" value="grid" />
            <v-btn v-tooltip="t('home.view.list')" :aria-label="t('home.view.list')" icon="mdi-view-list-outline" value="list" />
          </v-btn-toggle>
        </div>

        <template v-if="filtered.length > 0">
          <v-row v-if="view === 'grid'" dense>
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

          <!-- Many targets at a glance: one row each, the action on hover. -->
          <v-card v-else>
            <v-list-records>
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
                      @click.stop.prevent="navigateTo(`/targets/${target.id}`)"
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
          </v-card>
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
      </template>

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
  import { useQuery } from '@pinia/colada'
  import basyxLogo from '~/assets/basyx-logo.svg'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { targetIcon, targetSubtitle } from '~/utils/aas'
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

  const search = ref<string | null>(null)
  const state = ref<'all' | TargetState>('all')

  // Cards for a few targets, rows for many, until the user picks a view;
  // the choice is kept in a cookie, so server rendering shows it too.
  const viewCookie = useCookie<'grid' | 'list' | null>('studio-targets-view', { default: () => null, maxAge: 60 * 60 * 24 * 365 })
  const view = computed({
    get: () => viewCookie.value ?? (items.value.length > 6 ? 'list' : 'grid'),
    set: value => (viewCookie.value = value),
  })

  // The states that occur, with their counts; `all` comes first.
  const stateOptions = computed(() => {
    const titles: Record<'all' | TargetState, string> = {
      all: t('home.filters.all'),
      ready: t('home.filters.ready'),
      required: t('home.filters.required'),
      workspace: t('workspace.localFile'),
    }
    return (Object.keys(titles) as Array<'all' | TargetState>)
      .map(value => ({ value, title: titles[value], count: value === 'all' ? items.value.length : items.value.filter(target => stateOf(target) === value).length }))
      .filter(option => option.count > 0)
  })

  const filtered = computed(() => filterRecords(items.value, search.value, state.value === 'all' ? [] : [`state:${state.value}`], target => ({
    text: [target.name, target.description, target.workspace?.fileName],
    facets: [`state:${stateOf(target)}`],
  })))

  function resetFilters () {
    search.value = null
    state.value = 'all'
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
