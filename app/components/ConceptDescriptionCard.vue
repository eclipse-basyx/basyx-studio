<template>
  <v-skeleton-loader v-if="cd.isPending.value" type="list-item-two-line" />

  <!-- Found: what the semantic ID means, and a way to its own page. -->
  <div v-else-if="cd.data.value" class="d-flex flex-column ga-2">
    <div class="d-flex align-center ga-2">
      <span class="text-body-large font-weight-medium text-break">{{ name }}</span>
      <v-spacer />
      <v-btn append-icon="mdi-arrow-right" size="small" :text="t('cd.open')" :to="link" />
    </div>

    <div v-if="chips.length > 0" class="d-flex flex-wrap ga-2">
      <v-chip v-for="chip in chips" :key="chip.text" :prepend-icon="chip.icon" :text="chip.text" />
    </div>

    <div class="text-body-medium text-medium-emphasis">{{ definition ?? t('concepts.noDefinition') }}</div>
  </div>

  <div v-else-if="notFound" class="d-flex flex-column ga-3">
    <div class="text-body-medium text-medium-emphasis">{{ t('cd.notFound') }}</div>

    <v-btn
      v-if="canCreate && singleKey"
      class="align-self-start"
      prepend-icon="mdi-plus"
      :text="t('cd.createFromElement')"
      @click="adding = true"
    />
  </div>

  <ProblemAlert v-else-if="cd.error.value" :error="cd.error.value" retry @retry="cd.refetch()" />

  <ConceptDescriptionAddDialog
    v-if="canCreate"
    v-model="adding"
    :initial="initial"
    :target-id="targetId"
    @created="onCreated"
  />
</template>

<script lang="ts" setup>
  import type { ConceptDescriptionDetail } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { conceptDescriptionFromElement, isIec61360 } from '#shared/aas/iec61360'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { langText, resourceKey } from '~/utils/aas'

  // The concept description an element's or submodel's semantic ID names
  // (MVP-6 plan, E1, E2, E3): shown in the details drawer, opened on the
  // Concepts page, and created from the element where it is missing.
  const props = defineProps<{
    targetId: string
    /** The element or submodel whose semantic ID is resolved. */
    node: Json
    /** Edit mode on a target that accepts new concept descriptions. */
    canCreate: boolean
  }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const queryCache = useQueryCache()
  const preferences = usePreferences().preferences

  const keys = computed(() => ((props.node.semanticId as { keys?: Array<{ value?: string }> } | undefined)?.keys ?? []))
  const id = computed(() => keys.value[0]?.value ?? '')
  // Creating is offered only where the semantic ID is one global key: the concept description's ID.
  const singleKey = computed(() => keys.value.length === 1)
  const key = computed(() => resourceKey(id.value))

  // The same cache entry as the Concepts page's drawer, so an edit there shows here.
  const cd = useQuery({
    key: () => ['targets', props.targetId, 'concept-descriptions', key.value],
    query: ({ signal }) => api<ConceptDescriptionDetail>(`/targets/${props.targetId}/concept-descriptions/${key.value}`, { signal }),
    enabled: () => id.value !== '',
  })
  const notFound = computed(() => cd.error.value instanceof StudioApiError && cd.error.value.code === 'target_resource_not_found')

  type Content = Record<string, any>
  const stored = computed<Content>(() => (cd.data.value?.conceptDescription ?? {}) as Content)
  const content = computed<Content>(() => ((stored.value.embeddedDataSpecifications ?? []) as Content[]).find(entry => isIec61360(entry))?.dataSpecificationContent ?? {})
  const name = computed(() => langText(content.value.preferredName ?? [], preferences.value.valueLanguage) ?? String(stored.value.idShort ?? id.value))
  const definition = computed(() => langText(content.value.definition ?? [], preferences.value.valueLanguage))
  const chips = computed(() => [
    ...(content.value.dataType ? [{ text: String(content.value.dataType), icon: 'mdi-code-tags' }] : []),
    ...(content.value.unit ? [{ text: String(content.value.unit), icon: 'mdi-ruler' }] : []),
  ])
  const link = computed(() => ({ path: `/targets/${props.targetId}/concepts`, query: { cd: key.value } }))

  const adding = ref(false)
  const initial = computed(() => conceptDescriptionFromElement(props.node, id.value, 'en'))

  function onCreated (detail: ConceptDescriptionDetail) {
    queryCache.setQueryData(['targets', props.targetId, 'concept-descriptions', key.value], detail)
    void queryCache.invalidateQueries({ key: conceptDescriptionsKey(props.targetId) })
    void cd.refetch()
  }
</script>
