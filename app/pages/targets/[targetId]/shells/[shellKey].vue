<template>
  <v-container fluid max-width="none">
    <TargetHeader :target="target.data.value" :trail="trail" />

    <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

    <TargetAuthorization
      v-else-if="target.data.value && (target.needsAuthorization.value || authRequired)"
      :target="target.data.value"
      @authorized="onAuthorized"
    />

    <ProblemAlert v-else-if="shell.error.value" :error="shell.error.value" retry @retry="shell.refetch()" />

    <v-row v-else-if="target.data.value" density="compact">
      <v-col cols="12" lg="3" md="4">
        <v-card-pane>
          <v-card-title class="text-title-medium">{{ t('shell.submodels') }}</v-card-title>
          <v-divider />

          <div class="flex-grow-1 overflow-auto">
            <v-progress-linear v-if="refs.isLoading.value" />

            <ProblemAlert
              v-else-if="refs.error.value"
              class="ma-2"
              :error="refs.error.value"
              retry
              @retry="refs.refetch()"
            />

            <div v-else-if="refs.data.value?.items.length === 0" class="pa-4 text-medium-emphasis">{{ t('shell.noSubmodels') }}</div>

            <v-list v-else density="compact" nav>
              <v-list-item
                v-for="ref in refs.data.value?.items"
                :key="ref.key"
                :active="ref.key === submodelKey"
                :disabled="ref.status !== 'available'"
                :prepend-icon="ref.status === 'available' ? 'mdi-file-tree-outline' : (ref.status === 'forbidden' ? 'mdi-lock-outline' : 'mdi-alert-circle-outline')"
                :subtitle="ref.status === 'available' ? (ref.semanticId ?? ref.submodelId) : t(`shell.refStatus.${ref.status}`)"
                :title="ref.idShort ?? ref.submodelId"
                @click="selectSubmodel(ref.key)"
              />
            </v-list>
          </div>
        </v-card-pane>
      </v-col>

      <v-col cols="12" :lg="activeView ? 9 : 4" md="8">
        <v-card-pane>
          <v-card-title class="text-title-medium">{{ t('shell.elements') }}</v-card-title>

          <v-tabs v-if="submodelKey && views.length > 0" v-model="viewKey" density="compact">
            <v-tab prepend-icon="mdi-file-tree-outline" :text="t('shell.tree')" value="tree" />

            <v-tab
              v-for="item in views"
              :key="viewIdOf(item)"
              prepend-icon="mdi-puzzle-outline"
              :text="label(item.title)"
              :value="viewIdOf(item)"
            />
          </v-tabs>

          <v-divider />

          <template v-if="activeView && selectedRef">
            <div class="text-body-small text-medium-emphasis px-4 py-1">
              {{ t('apps.matchReason', { semanticId: activeView.reason.semanticId }) }}
              <v-chip v-if="activeView.unsigned" class="ms-2" color="warning" :text="t('apps.unsigned')" />
            </div>

            <AppFrame
              :key="`${targetId}:${submodelKey}:${viewIdOf(activeView)}`"
              :contribution="activeView"
              :shell-id="shell.data.value ? String(shell.data.value.shell.id) : null"
              :submodel="{ id: selectedRef.submodelId, semanticId: selectedRef.semanticId }"
              :target="target.data.value ?? null"
            />
          </template>

          <div v-else class="flex-grow-1 overflow-auto">
            <ElementTree
              v-if="submodelKey"
              :key="`${targetId}:${submodelKey}`"
              ref="tree"
              v-model:selected="elementKey"
              :submodel-key="submodelKey"
              :target-id="targetId"
            />

            <div v-else class="pa-4 text-medium-emphasis">{{ t('shell.selectSubmodel') }}</div>
          </div>
        </v-card-pane>
      </v-col>

      <v-col v-if="!activeView" cols="12" lg="5">
        <v-card-pane>
          <v-card-title class="text-title-medium">{{ t('shell.details') }}</v-card-title>
          <v-divider />

          <div class="flex-grow-1 overflow-auto d-flex flex-column">
            <v-progress-linear v-if="details.isLoading.value" />
            <ProblemAlert v-else-if="details.error.value" class="ma-2" :error="details.error.value" />

            <template v-else-if="details.data.value">
              <template v-if="editable && details.data.value.element && submodelKey">
                <ElementValueEditor
                  :detail="details.data.value.element"
                  :explicit-save="target.data.value?.capabilities.persistence === 'explicit_save'"
                  :submodel-key="submodelKey"
                  :target-id="targetId"
                  @changed="onElementChanged"
                />

                <v-divider />
              </template>

              <JsonPanel class="flex-grow-1" :label="details.data.value.label" :value="details.data.value.value" />
            </template>
          </div>
        </v-card-pane>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
  import type { ElementDetail, ShellDetail, SubmodelDetail, SubmodelRef, SubmodelViewContributionInfo } from '#shared/contract'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { isEditableModelType } from '~/utils/aas'

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const invalidate = useInvalidate()

  const targetId = computed(() => String(route.params.targetId))
  const shellKey = computed(() => String(route.params.shellKey))
  const submodelKey = computed(() => typeof route.query.submodel === 'string' ? route.query.submodel : null)
  const elementKey = computed({
    get: () => typeof route.query.element === 'string' ? route.query.element : null,
    set: (key: string | null) => router.replace({ query: { ...route.query, element: key ?? undefined } }),
  })

  const target = useTarget(targetId)
  const ready = () => target.data.value !== undefined && !target.needsAuthorization.value

  const shell = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value],
    query: ({ signal }) => api<ShellDetail>(`/targets/${targetId.value}/shells/${shellKey.value}`, { signal }),
    enabled: ready,
  })

  const refs = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value, 'submodel-refs'],
    query: ({ signal }) => api<{ items: SubmodelRef[] }>(`/targets/${targetId.value}/shells/${shellKey.value}/submodel-refs`, { signal }),
    enabled: ready,
  })

  // The JSON pane shows the selected element, else the submodel, else the shell.
  const detailsKey = () => ['targets', targetId.value, 'details', shellKey.value, submodelKey.value ?? '', elementKey.value ?? '']
  const details = useQuery({
    key: detailsKey,
    query: async ({ signal }) => {
      if (submodelKey.value && elementKey.value) {
        const detail = await api<ElementDetail>(`/targets/${targetId.value}/submodels/${submodelKey.value}/elements/${elementKey.value}`, { signal })
        return { label: detail.path, value: detail.value, element: detail }
      }
      if (submodelKey.value) {
        const detail = await api<SubmodelDetail>(`/targets/${targetId.value}/submodels/${submodelKey.value}`, { signal })
        return { label: String(detail.submodel.idShort ?? detail.submodel.id), value: detail.submodel, element: null }
      }
      const detail = await api<ShellDetail>(`/targets/${targetId.value}/shells/${shellKey.value}`, { signal })
      return { label: String(detail.shell.idShort ?? detail.shell.id), value: detail.shell, element: null }
    },
    enabled: ready,
  })

  const tree = useTemplateRef('tree')
  const queryCache = useQueryCache()

  // Only values of properties can be edited, and only with a revision to base the write on.
  const editable = computed(() => {
    const element = details.data.value?.element
    return Boolean(target.data.value?.capabilities.write && element?.revision
      && isEditableModelType((element.value as Record<string, unknown>).modelType))
  })

  async function onElementChanged (detail: ElementDetail) {
    queryCache.setQueryData(detailsKey(), { label: detail.path, value: detail.value, element: detail })
    await Promise.all([
      tree.value?.refresh(detail.key),
      // A workspace now has unsaved changes.
      queryCache.invalidateQueries({ key: ['targets', targetId.value], exact: true }),
    ])
  }

  const authRequired = computed(() => [shell.error.value, refs.error.value]
    .some(error => error instanceof StudioApiError && error.code === 'target_auth_required'))

  const trail = computed(() => {
    const value = shell.data.value?.shell
    return value ? [{ title: String(value.idShort ?? value.id) }] : []
  })

  // Submodel views of installed apps for the selected submodel (MVP-3).
  const label = useLocalizedLabel()
  const selectedRef = computed(() => refs.data.value?.items.find(ref => ref.key === submodelKey.value) ?? null)
  const contributions = useAppContributions(() => selectedRef.value?.semanticId ?? null)
  const views = computed(() => selectedRef.value?.semanticId ? (contributions.data.value?.submodelViews ?? []) : [])
  const viewIdOf = (view: SubmodelViewContributionInfo) => `${view.installationId}:${view.id}`
  const viewKey = computed({
    get: () => typeof route.query.view === 'string' ? route.query.view : 'tree',
    set: (key: string) => router.replace({ query: { ...route.query, view: key === 'tree' ? undefined : key } }),
  })
  const activeView = computed(() => views.value.find(view => viewIdOf(view) === viewKey.value) ?? null)

  function selectSubmodel (key: string) {
    router.replace({ query: { submodel: key } })
  }

  async function onAuthorized () {
    await invalidate(['targets', targetId.value])
  }
</script>
