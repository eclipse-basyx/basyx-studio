<template>
  <v-navigation-drawer
    v-model="ui.detailsDrawer"
    border="s"
    disable-route-watcher
    location="end"
    :temporary="!lgAndUp"
    :width="drawerWidth"
  >
    <div v-if="cdKey" class="d-flex flex-column h-100">
      <v-toolbar class="px-1" color="transparent" density="compact">
        <v-spacer />

        <v-btn
          v-if="canWrite && detail.data.value"
          v-tooltip="t('cd.delete')"
          :aria-label="t('cd.delete')"
          icon="mdi-delete-outline"
          size="small"
          @click="emit('delete', detail.data.value)"
        />

        <v-btn
          v-if="lgAndUp"
          v-tooltip="wide ? t('details.narrow') : t('details.widen')"
          :aria-label="wide ? t('details.narrow') : t('details.widen')"
          :icon="wide ? 'mdi-arrow-collapse-right' : 'mdi-arrow-expand-left'"
          size="small"
          @click="wide = !wide"
        />

        <v-btn :aria-label="t('common.close')" icon="mdi-close" size="small" @click="ui.detailsDrawer = false" />
      </v-toolbar>

      <v-card-item class="pt-2">
        <template #prepend>
          <v-avatar color="primary" size="48" variant="tonal">
            <v-icon icon="mdi-book-open-page-variant-outline" />
          </v-avatar>
        </template>

        <v-card-title class="text-title-large text-wrap text-break">{{ title }}</v-card-title>
        <v-card-subtitle class="text-wrap text-break">{{ id }}</v-card-subtitle>

        <template #append>
          <v-btn
            v-tooltip="t('concepts.copyId')"
            :aria-label="t('concepts.copyId')"
            icon="mdi-content-copy"
            size="small"
            @click="copy(id, t('concepts.id'))"
          />
        </template>
      </v-card-item>

      <v-tabs
        v-model="mode"
        class="flex-shrink-0"
        density="compact"
        show-arrows
      >
        <v-tab prepend-icon="mdi-information-outline" :text="t('details.modes.details')" value="details" />
        <v-tab prepend-icon="mdi-code-json" :text="t('details.modes.json')" value="json" />
        <v-tab prepend-icon="mdi-xml" :text="t('details.modes.xml')" value="xml" />
      </v-tabs>

      <v-divider />

      <ProblemAlert
        v-if="detail.error.value"
        class="ma-4"
        :error="detail.error.value"
        retry
        @retry="detail.refetch()"
      />

      <v-skeleton-loader v-else-if="!detail.data.value" type="card, list-item-two-line@3" />

      <div v-else-if="mode === 'details'" class="flex-grow-1 overflow-y-auto">
        <ConceptDescriptionForm
          v-if="canWrite"
          :detail="detail.data.value"
          :explicit-save="capabilities.persistence === 'explicit_save'"
          :target-id="targetId"
          @changed="onChanged"
        />

        <template v-else>
          <v-list class="px-2" lines="two">
            <v-list-subheader :title="t('details.metadata')" />

            <v-list-item
              v-for="row in metadata"
              :key="row.label"
              :prepend-icon="row.icon"
              :subtitle="row.label"
            >
              <v-list-item-title class="text-wrap text-break">{{ row.value }}</v-list-item-title>
            </v-list-item>
          </v-list>

          <v-divider />

          <v-expansion-panels :model-value="['definition', 'values']" multiple>
            <v-expansion-panel :title="t('concepts.definition')" value="definition">
              <v-expansion-panel-text class="text-body-medium text-medium-emphasis">
                {{ definition ?? t('concepts.noDefinition') }}
              </v-expansion-panel-text>
            </v-expansion-panel>

            <v-expansion-panel v-if="valuePairs.length > 0" :title="t('dataSpec.valueList')" value="values">
              <v-expansion-panel-text>
                <v-list>
                  <v-list-item
                    v-for="pair in valuePairs"
                    :key="pair.value"
                    :subtitle="pair.valueId"
                    :title="pair.value"
                  />
                </v-list>
              </v-expansion-panel-text>
            </v-expansion-panel>

            <v-expansion-panel v-if="caseOf.length > 0" :title="t('cd.isCaseOf')" value="caseOf">
              <v-expansion-panel-text>
                <div class="d-flex flex-wrap ga-2">
                  <v-chip v-for="reference in caseOf" :key="reference" prepend-icon="mdi-link-variant" :text="reference" />
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </template>
      </div>

      <div v-else-if="mode === 'json'" class="flex-grow-1 overflow-hidden">
        <JsonPanel :file-name="`${fileName}.json`" :label="t('details.modes.jsonLabel')" :value="detail.data.value.conceptDescription" />
      </div>

      <div v-else-if="mode === 'xml'" class="flex-grow-1 overflow-hidden">
        <ProblemAlert
          v-if="xml.error.value"
          class="ma-4"
          :error="xml.error.value"
          retry
          @retry="xml.refetch()"
        />

        <v-skeleton-loader v-else-if="xml.isPending.value" type="paragraph@3" />

        <CodeView
          v-else
          :file-name="`${fileName}.xml`"
          :label="t('details.modes.xmlLabel')"
          language="xml"
          :model-value="xml.data.value ?? ''"
        />
      </div>
    </div>

    <v-empty-state
      v-else
      icon="mdi-cursor-default-click-outline"
      size="64"
      :text="t('cd.nothingText')"
      :title="t('details.nothing')"
    />

    <!-- Apply and Discard of the form, always in view (FormActions). -->
    <template #append>
      <div id="cd-form-actions" />
    </template>
  </v-navigation-drawer>
</template>

<script lang="ts" setup>
  import type { ConceptDescriptionDetail, TargetCapabilities } from '#shared/contract'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { isIec61360 } from '#shared/aas/iec61360'
  import { decodeResourceKey, langText } from '~/utils/aas'
  import { formActionsFooterKey } from '~/utils/editor'

  // The details drawer of the Concepts page (MVP-6 plan, L1, L2): the
  // selected concept description in *Details*, *JSON* and *XML*, with its
  // form in edit mode, beside the table as the element drawer beside the tree.
  const props = defineProps<{
    targetId: string
    cdKey: string | null
    capabilities: TargetCapabilities
    /** Edit mode on a target that accepts concept description writes. */
    canWrite: boolean
  }>()
  const emit = defineEmits<{
    changed: [detail: ConceptDescriptionDetail]
    delete: [detail: ConceptDescriptionDetail]
  }>()
  const mode = defineModel<'details' | 'json' | 'xml'>('mode', { required: true })
  provide(formActionsFooterKey, '#cd-form-actions')

  const { t } = useI18n()
  const ui = useUiStore()
  const api = useStudioApi()
  const copy = useClipboard()
  const queryCache = useQueryCache()
  const preferences = usePreferences().preferences
  const { smAndUp, lgAndUp, width } = useDisplay()

  // Widened to the content area beside the rail; shared with the element drawer.
  const wideKey = 'studio.detailsDrawer.wide'
  const wide = ref(false)
  onMounted(() => {
    try {
      wide.value = localStorage.getItem(wideKey) === 'true'
    } catch {
      // Without storage the drawer starts narrow.
    }
  })
  watch(wide, value => {
    try {
      localStorage.setItem(wideKey, String(value))
    } catch {
      // Not remembered without storage.
    }
  })
  const drawerWidth = computed(() => (wide.value && lgAndUp.value ? Math.max(440, width.value - 56) : (smAndUp.value ? 440 : 360)))

  const detailKey = () => ['targets', props.targetId, 'concept-descriptions', props.cdKey ?? '']
  const detail = useQuery({
    key: detailKey,
    query: ({ signal }) => api<ConceptDescriptionDetail>(`/targets/${props.targetId}/concept-descriptions/${props.cdKey}`, { signal }),
    enabled: () => props.cdKey !== null,
  })

  const xml = useQuery({
    key: () => [...detailKey(), 'xml', detail.data.value?.revision ?? ''],
    query: async ({ signal }) => {
      const blob = await api<Blob>(`/targets/${props.targetId}/concept-descriptions/${props.cdKey}`, { query: { format: 'xml' }, responseType: 'blob', signal })
      return blob.text()
    },
    enabled: () => props.cdKey !== null && mode.value === 'xml',
  })

  type Json = Record<string, any>
  const value = computed<Json>(() => (detail.data.value?.conceptDescription ?? {}) as Json)
  const content = computed<Json>(() => ((value.value.embeddedDataSpecifications ?? []) as Json[]).find(entry => isIec61360(entry))?.dataSpecificationContent ?? {})
  const id = computed(() => String(value.value.id ?? (props.cdKey ? decodeResourceKey(props.cdKey) : '') ?? ''))
  const title = computed(() => langText(content.value.preferredName ?? [], preferences.value.valueLanguage) ?? value.value.idShort ?? id.value)
  const definition = computed(() => langText(content.value.definition ?? [], preferences.value.valueLanguage))
  const fileName = computed(() => String(value.value.idShort ?? 'concept-description').replaceAll(/[^\w-]/g, '_'))
  const valuePairs = computed(() => ((content.value.valueList?.valueReferencePairs ?? []) as Json[])
    .map(pair => ({ value: String(pair.value ?? ''), valueId: String(pair.valueId?.keys?.[0]?.value ?? '') })))
  const caseOf = computed(() => ((value.value.isCaseOf ?? []) as Json[]).map(reference => String(reference.keys?.[0]?.value ?? '')).filter(Boolean))

  const metadata = computed(() => {
    const rows: Array<{ label: string, value: string, icon: string }> = []
    const add = (label: string, text: unknown, icon: string) => {
      if (typeof text === 'string' && text !== '') {
        rows.push({ label, value: text, icon })
      }
    }
    add(t('details.idShort'), value.value.idShort, 'mdi-label-outline')
    add(t('concepts.dataType'), content.value.dataType, 'mdi-code-tags')
    add(t('concepts.unit'), content.value.unit, 'mdi-ruler')
    add(t('dataSpec.unitId'), content.value.unitId?.keys?.[0]?.value, 'mdi-identifier')
    add(t('dataSpec.symbol'), content.value.symbol, 'mdi-format-letter-case')
    add(t('dataSpec.shortName'), langText(content.value.shortName ?? [], preferences.value.valueLanguage), 'mdi-format-title')
    add(t('dataSpec.sourceOfDefinition'), content.value.sourceOfDefinition, 'mdi-book-outline')
    add(t('dataSpec.valueFormat'), content.value.valueFormat, 'mdi-format-list-text')
    add(t('dataSpec.value'), content.value.value, 'mdi-equal')
    if (value.value.administration?.version) {
      add(t('details.version'), [value.value.administration.version, value.value.administration.revision].filter(Boolean).join('.'), 'mdi-file-certificate-outline')
    }
    return rows
  })

  function onChanged (changed: ConceptDescriptionDetail) {
    queryCache.setQueryData(detailKey(), changed)
    emit('changed', changed)
  }
</script>
