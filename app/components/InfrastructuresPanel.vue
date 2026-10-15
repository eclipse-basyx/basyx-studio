<template>
  <v-container>
    <PageHeader :subtitle="t('admin.subtitle')" :title="t('admin.title')">
      <template #actions>
        <v-btn-primary prepend-icon="mdi-plus" :text="t('admin.add')" @click="edit(null)" />

        <v-btn
          v-tooltip="t('common.close')"
          :aria-label="t('common.close')"
          icon="mdi-close"
          @click="panel.close()"
        />
      </template>
    </PageHeader>

    <ProblemAlert
      v-if="list.error.value"
      class="mb-4"
      :error="list.error.value"
      retry
      @retry="list.refetch()"
    />

    <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

    <v-progress-linear v-if="list.isPending.value" />

    <v-card v-else>
      <template v-if="items.length > 0">
        <ListFilterBar
          v-model:search="search"
          v-model:selected="selected"
          :groups="filterGroups"
          :placeholder="t('admin.search')"
        />

        <v-divider />
      </template>

      <v-list-records v-if="filtered.length > 0">
        <template v-for="(item, index) in filtered" :key="item.id">
          <v-divider v-if="index > 0" />

          <RecordListItem
            :icon="securityModeIcons[item.security.mode]"
            :subtitle="`${t(`admin.templates.${item.template}.title`)} · ${t(`security.${item.security.mode}`)} · ${endpointUrls(item)}`"
            @click="edit(item)"
          >
            <!-- Features as small neutral chips on the title line, explained
                 by tooltips; rows stay two lines high. -->
            <template #title>
              <div class="d-flex flex-wrap align-center ga-1">
                <span class="me-1">{{ item.name }}</span>

                <v-chip
                  v-for="feature in features(item)"
                  :key="feature.key"
                  v-tooltip="feature.hint"
                  :prepend-icon="feature.icon"
                  size="x-small"
                  :text="feature.title"
                />

                <!-- The last check in this session, without moving the row. -->
                <v-icon
                  v-if="probes[item.id]"
                  v-tooltip="probeSummary(probes[item.id]!)"
                  :aria-label="probeSummary(probes[item.id]!)"
                  :color="probeFailed(probes[item.id]!) ? 'error' : 'success'"
                  :icon="probeFailed(probes[item.id]!) ? 'mdi-lan-disconnect' : 'mdi-lan-check'"
                  size="small"
                />
              </div>
            </template>

            <template #meta>
              <span v-if="item.probedAt" class="text-body-small text-medium-emphasis text-no-wrap">
                {{ t('admin.probedAt', { time: new Date(item.probedAt).toLocaleString(locale) }) }}
              </span>
            </template>

            <!-- Clicking the row edits it, so there is no edit button. -->
            <template #actions>
              <v-btn
                v-tooltip="t('admin.probe')"
                :aria-label="t('admin.probe')"
                icon="mdi-lan-connect"
                :loading="probing === item.id"
                @click.stop="probe(item)"
              />

              <v-btn
                v-tooltip="t('admin.delete')"
                :aria-label="t('admin.delete')"
                icon="mdi-delete-outline"
                @click.stop="confirmDelete = item"
              />
            </template>
          </RecordListItem>
        </template>
      </v-list-records>

      <v-card-text v-else-if="items.length > 0" class="text-medium-emphasis">{{ t('lists.noMatches') }}</v-card-text>

      <v-card-text v-else class="text-medium-emphasis">{{ t('admin.noInfrastructures') }}</v-card-text>
    </v-card>

    <InfrastructureDialog v-model="dialogOpen" :existing="editing" @saved="refresh" />

    <v-dialog max-width="480" :model-value="confirmDelete !== null" @update:model-value="confirmDelete = null">
      <DialogCard :title="t('admin.delete')">
        {{ t('admin.deleteConfirm', { name: confirmDelete?.name ?? '' }) }}

        <template #actions>
          <v-btn :text="t('admin.cancel')" @click="confirmDelete = null" />
          <v-btn-primary color="error" :text="t('admin.delete')" @click="remove" />
        </template>
      </DialogCard>
    </v-dialog>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Infrastructure, ProbeResult } from '#shared/contract'
  import type { FilterGroup } from '~/utils/records'
  import { useQuery } from '@pinia/colada'
  import { serviceUrl } from '#shared/contract'
  import { securityModeIcons } from '~/utils/aas'
  import { filterRecords } from '~/utils/records'

  const { t, locale } = useI18n()
  const api = useStudioApi()
  const invalidate = useInvalidate()
  const notifications = useNotificationsStore()
  const panel = usePanel()

  const featureIcons: Record<keyof Infrastructure['announced'], string> = {
    history: 'mdi-history',
    changeFeed: 'mdi-timeline-clock-outline',
    rebac: 'mdi-account-lock-outline',
  }

  /**
   * The row chips: where the shell list comes from, and the features the
   * services announce (the server also sends `query`, an object, which the
   * filter skips).
   */
  function features (item: Infrastructure): Array<{ key: string, title: string, hint: string, icon: string }> {
    const announced = (Object.keys(featureIcons) as Array<keyof Infrastructure['announced']>)
      .filter(feature => item.announced[feature] === true)
      .map(feature => ({ key: feature, title: t(`admin.announced.${feature}`), hint: t(`admin.announcedHints.${feature}`), icon: featureIcons[feature] }))
    const listSource = serviceUrl(item, 'aasRegistry') && serviceUrl(item, 'aasRepository')
      ? [{ key: 'listSource', title: t(`admin.listSources.${item.listSource}`), hint: t(`admin.listSourceHelp.${item.listSource}`), icon: 'mdi-format-list-bulleted' }]
      : []
    return [...listSource, ...announced]
  }

  function probeFailed (result: ProbeResult): boolean {
    return result.endpoints.some(endpoint => !endpoint.reachable)
  }

  /** One line per endpoint, for the tooltip and the snackbar. */
  function probeSummary (result: ProbeResult): string {
    return result.endpoints.map(endpoint => `${t(`admin.endpointTypes.${endpoint.type}`)}: ${endpoint.reachable ? `${endpoint.status} · ${endpoint.latencyMs} ms` : endpoint.error}`).join(' · ')
  }

  const list = useQuery({
    key: ['admin', 'infrastructures'],
    query: ({ signal }) => api<{ items: Infrastructure[] }>('/infrastructures', { signal }),
  })

  const items = computed(() => list.data.value?.items ?? [])
  const search = ref<string | null>(null)
  const selected = ref<string[]>([])

  function endpointUrls (item: Infrastructure): string {
    return [...new Set(item.endpoints.map(endpoint => endpoint.url))].join(', ')
  }

  // Filters for the security modes and deployments that occur.
  const filterGroups = computed<FilterGroup[]>(() => [
    {
      title: t('admin.securityMode'),
      options: [...new Set(items.value.map(item => item.security.mode))]
        .map(mode => ({ value: `security:${mode}`, title: t(`security.${mode}`), icon: securityModeIcons[mode] })),
    },
    {
      title: t('admin.deployment'),
      options: [...new Set(items.value.map(item => item.template))]
        .map(template => ({ value: `template:${template}`, title: t(`admin.templates.${template}.title`) })),
    },
  ])

  const filtered = computed(() => filterRecords(items.value, search.value, selected.value, item => ({
    text: [item.name, endpointUrls(item), t(`admin.templates.${item.template}.title`)],
    facets: [`security:${item.security.mode}`, `template:${item.template}`],
  })))

  const dialogOpen = ref(false)
  const editing = ref<Infrastructure | null>(null)
  const confirmDelete = ref<Infrastructure | null>(null)
  const probing = ref<string | null>(null)
  const probes = ref<Record<string, ProbeResult>>({})
  const actionError = ref<unknown>(null)

  function edit (item: Infrastructure | null) {
    editing.value = item
    dialogOpen.value = true
  }

  async function refresh () {
    // Target lists and per-target data depend on the infrastructure configuration.
    await invalidate(['admin', 'infrastructures'], ['targets'])
  }

  async function probe (item: Infrastructure) {
    probing.value = item.id
    actionError.value = null
    try {
      const result = await api<ProbeResult>(`/infrastructures/${item.id}/probe`, { method: 'POST' })
      probes.value = { ...probes.value, [item.id]: result }
      // A snackbar instead of chips in the row, which would move the list.
      const failed = result.endpoints.filter(endpoint => !endpoint.reachable)
      notifications.notify(failed.length === 0
        ? { text: t('admin.probeOkText', { name: item.name, count: result.endpoints.length }, result.endpoints.length), color: 'success' }
        : { text: t('admin.probeFailedText', { name: item.name, endpoints: failed.map(endpoint => `${t(`admin.endpointTypes.${endpoint.type}`)} (${endpoint.error})`).join(', ') }), color: 'error' })
      // The probe stored the profiles the services announce now.
      await refresh()
    } catch (error) {
      actionError.value = error
    } finally {
      probing.value = null
    }
  }

  async function remove () {
    const item = confirmDelete.value
    confirmDelete.value = null
    if (!item) {
      return
    }
    actionError.value = null
    try {
      await api(`/infrastructures/${item.id}`, { method: 'DELETE' })
      await refresh()
    } catch (error) {
      actionError.value = error
    }
  }
</script>
