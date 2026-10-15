<template>
  <!-- Selecting an element changes the URL; that must not close the drawer. -->
  <v-navigation-drawer
    v-model="ui.detailsDrawer"
    :border="covering ? 0 : 's'"
    disable-route-watcher
    location="end"
    :temporary="!lgAndUp"
    :width="drawerWidth"
  >
    <!-- A new element: its form takes the drawer until it is created or cancelled (U4). -->
    <div v-if="creating" class="d-flex flex-column h-100">
      <v-toolbar class="px-1" color="transparent" density="compact">
        <v-toolbar-title class="text-title-medium">{{ t('editor.newTitle', { type: creating.element.modelType, parent: creating.parentLabel }) }}</v-toolbar-title>
        <v-btn :aria-label="t('common.close')" icon="mdi-close" size="small" @click="emit('cancel-create')" />
      </v-toolbar>

      <v-divider />

      <div class="flex-grow-1 overflow-y-auto">
        <ElementForm
          :create="creating"
          :explicit-save="capabilities.persistence === 'explicit_save'"
          :link-concepts="capabilities.conceptDescriptions"
          :submodel-key="creating.submodelKey"
          :target-id="targetId"
          @cancel="emit('cancel-create')"
          @created="detail => emit('created', detail)"
        />
      </div>
    </div>

    <!-- The shell form (U5): the shell header's Edit opens it here. -->
    <div v-else-if="editingShell && shellDetail" class="d-flex flex-column h-100">
      <v-toolbar class="px-1" color="transparent" density="compact">
        <v-toolbar-title class="text-title-medium">{{ t('shell.editTitle') }}</v-toolbar-title>
        <v-btn :aria-label="t('common.close')" icon="mdi-close" size="small" @click="emit('close-shell')" />
      </v-toolbar>

      <v-divider />

      <div class="flex-grow-1 overflow-y-auto">
        <ShellForm
          :can-upload="capabilities.files"
          :explicit-save="capabilities.persistence === 'explicit_save'"
          :shell="shellDetail"
          :target-id="targetId"
          @changed="detail => emit('shell-changed', detail)"
        />
      </div>
    </div>

    <div v-else-if="item" class="d-flex flex-column h-100">
      <!-- Where the selection is, on one line: up to the parent, or jump to
           any level from the path menu. The title below names the selection. -->
      <v-toolbar class="px-1" color="transparent" density="compact">
        <template v-if="trail.length > 0">
          <v-btn
            v-tooltip="t('details.up', { name: trail.at(-1)!.title })"
            :aria-label="t('details.up', { name: trail.at(-1)!.title })"
            icon="mdi-arrow-up"
            size="small"
            @click="emit('select', trail.at(-1)!.id)"
          />

          <v-menu>
            <template #activator="{ props: activator }">
              <!-- A list item, as its title truncates: a long path stays on one line. -->
              <v-list-item
                v-bind="activator"
                append-icon="mdi-chevron-down"
                :aria-label="t('details.pathMenu')"
                class="flex-shrink-1 px-2"
                min-height="32"
              >
                <template #title>
                  <span class="text-body-small text-medium-emphasis">{{ trail.map(segment => segment.title).join(' › ') }}</span>
                </template>
              </v-list-item>
            </template>

            <v-card max-width="360">
              <v-list>
                <v-list-item
                  v-for="segment in trail"
                  :key="segment.id"
                  :prepend-icon="segment.icon"
                  :title="segment.title"
                  @click="emit('select', segment.id)"
                />

                <v-list-item active :prepend-icon="modelTypeIcon(item.modelType)" :title="title" />
              </v-list>
            </v-card>
          </v-menu>
        </template>

        <v-spacer />

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
            <v-icon :icon="modelTypeIcon(item.modelType)" />
          </v-avatar>
        </template>

        <v-card-title class="text-title-large text-wrap text-break">{{ title }}</v-card-title>
        <v-card-subtitle>{{ item.variableGroup ? t('details.variableGroup') : item.modelType }}</v-card-subtitle>

        <template v-if="path" #append>
          <v-btn
            v-tooltip="t('details.copyPath')"
            :aria-label="t('details.copyPath')"
            icon="mdi-link-variant"
            size="small"
            @click="copy(path, t('details.path'))"
          />
        </template>
      </v-card-item>

      <!-- Not mandatory: a mode from the URL may wait for its tab (app views load later). -->
      <v-tabs
        v-model="mode"
        class="flex-shrink-0"
        density="compact"
        :mandatory="false"
        show-arrows
      >
        <v-tab
          v-for="entry in modes"
          :key="entry.value"
          :prepend-icon="entry.icon"
          :text="entry.title"
          :value="entry.value"
        />
      </v-tabs>

      <v-divider />

      <ProblemAlert
        v-if="activeQuery.error.value"
        class="ma-4"
        :error="activeQuery.error.value"
        retry
        @retry="activeQuery.refetch()"
      />

      <v-skeleton-loader v-else-if="mode !== 'xml' && mode !== 'visualization' && !activeQuery.data.value" type="card, list-item-two-line@3" />

      <!-- Details -->
      <div v-else-if="mode === 'details' && detail" class="flex-grow-1 overflow-y-auto">
        <div v-if="item.elementKey && (!form || keepsView)" class="pa-4">
          <!-- Types whose form covers their whole value replace the view; the
               views of File, Blob and Operation stay and get the form below. -->
          <ElementValueView
            v-if="!form || keepsView"
            :can-invoke="canInvoke"
            :can-replace="canWrite && capabilities.files"
            :detail="detail"
            :history="history"
            :item="item"
            :refreshing="refreshing"
            :submodel-key="item.submodelKey"
            :target-id="targetId"
            @changed="onChanged"
            @select="id => emit('select', id)"
          />
        </div>

        <div v-if="form && item.elementKey && detail">
          <ElementForm
            :detail="detail"
            :explicit-save="capabilities.persistence === 'explicit_save'"
            :link-concepts="capabilities.conceptDescriptions"
            :submodel-key="item.submodelKey"
            :target-id="targetId"
            @changed="onChanged"
          />
        </div>

        <div v-else-if="form && detail">
          <SubmodelForm
            :detail="detail"
            :explicit-save="capabilities.persistence === 'explicit_save'"
            :submodel-key="item.submodelKey"
            :target-id="targetId"
            @changed="onChanged"
          />
        </div>

        <!-- In edit mode the form holds the fields; only what it cannot edit stays. -->
        <v-list v-if="metadata.length > 0" class="px-2" lines="two">
          <v-list-subheader :title="t('details.metadata')" />

          <v-list-item
            v-for="row in metadata"
            :key="row.label"
            :prepend-icon="row.icon"
            :subtitle="row.label"
          >
            <v-list-item-title class="text-wrap text-break">{{ row.value }}</v-list-item-title>

            <template v-if="row.copy" #append>
              <v-btn :aria-label="t('common.copy')" icon="mdi-content-copy" size="x-small" @click="copy(row.value, row.label)" />
            </template>
          </v-list-item>
        </v-list>

        <v-divider />

        <v-expansion-panels :model-value="['description', 'concept']" multiple>
          <v-expansion-panel v-if="!form" :title="t('details.description')" value="description">
            <v-expansion-panel-text class="text-body-medium text-medium-emphasis">
              {{ description ?? t('details.noDescription') }}
            </v-expansion-panel-text>
          </v-expansion-panel>

          <!-- What the semantic ID means (MVP-6 plan, E1). -->
          <v-expansion-panel v-if="showConcept" :title="t('cd.semanticsCard')" value="concept">
            <v-expansion-panel-text>
              <ConceptDescriptionCard :can-create="canCreateConcept" :node="value" :target-id="targetId" />
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel v-if="!form" :title="t('details.qualifiers')" value="qualifiers">
            <v-expansion-panel-text>
              <div v-if="qualifiers.length > 0" class="d-flex flex-wrap ga-2">
                <v-chip v-for="qualifier in qualifiers" :key="qualifier" prepend-icon="mdi-tag-outline" :text="qualifier" />
              </div>

              <span v-else class="text-body-medium text-medium-emphasis">{{ t('details.noQualifiers') }}</span>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>

      <div v-else-if="mode === 'visualization' && submodelRef" class="flex-grow-1 overflow-y-auto">
        <ElementVisualizationPanel
          v-model:view="view"
          :shell-id="shellId"
          :submodel="{ id: submodelRef.submodelId, semanticId: submodelRef.semanticId }"
          :submodel-label="submodelLabel ?? submodelRef.submodelId"
          :target="target"
          :views="views"
        />
      </div>

      <div v-else-if="mode === 'json'" class="flex-grow-1 overflow-hidden">
        <JsonPanel :file-name="`${fileName}.json`" :label="t('details.modes.jsonLabel')" :value="fullValue" />
      </div>

      <div v-else-if="mode === 'xml'" class="flex-grow-1 overflow-hidden">
        <ElementXmlPanel
          :at="at"
          :element-key="item.elementKey"
          :file-name="fileName"
          :submodel-key="item.submodelKey"
          :target-id="targetId"
        />
      </div>

      <div v-else-if="mode === 'uml'" class="flex-grow-1 overflow-hidden">
        <ElementUmlPanel :file-name="fileName" :value="fullValue" />
      </div>
    </div>

    <v-empty-state
      v-else
      icon="mdi-cursor-default-click-outline"
      size="64"
      :text="t('details.nothingText')"
      :title="t('details.nothing')"
    />

    <!-- Apply and Discard of the open form, always in view (FormActions). -->
    <template #append>
      <div id="details-form-actions" />
    </template>
  </v-navigation-drawer>
</template>

<script lang="ts" setup>
  import type { ElementDetail, ShellDetail, SubmodelDetail, SubmodelRef, SubmodelViewContributionInfo, Target, TargetCapabilities } from '#shared/contract'
  import type { ShellTreeItem } from '~/composables/useShellTrees'
  import type { DetailsMode } from '~/utils/aas'
  import type { CreatingElement } from '~/utils/editor'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { isElementModelType } from '#shared/aas/defaults'
  import { decodeResourceKey, langText, modelTypeIcon } from '~/utils/aas'
  import { formActionsFooterKey } from '~/utils/editor'

  // The details drawer (MVP-4 plan, T2): the selected submodel or element in
  // the modes of the Web UI's right pane. The mode and the app view are in the
  // URL (`mode`, `view`).
  const props = defineProps<{
    target: Target
    shellId: string
    submodelLabel: string | null
    submodelRef: SubmodelRef | null
    item: ShellTreeItem | null
    capabilities: TargetCapabilities
    /** The user may change values and files (edit mode, rights, not a past state). */
    canWrite: boolean
    canInvoke: boolean
    /** Point in time of a historic view, or `null` for now. */
    at: string | null
    history: number[]
    refreshing: boolean
    /** A new element being created below a parent (U4); takes the drawer. */
    creating: CreatingElement | null
    /** The shell's form takes the drawer (U5). */
    editingShell: boolean
    shellDetail: ShellDetail | null | undefined
  }>()
  const emit = defineEmits<{
    'select': [id: string]
    'created': [detail: ElementDetail]
    'cancel-create': []
    'close-shell': []
    'shell-changed': [detail: ShellDetail]
    /** An element changed at its source; reload what shows it. */
    'changed': [detail: ElementDetail]
  }>()
  const mode = defineModel<DetailsMode>('mode', { required: true })
  provide(formActionsFooterKey, '#details-form-actions')
  const view = defineModel<string | null>('view', { required: true })

  const { t } = useI18n()
  const ui = useUiStore()
  const api = useStudioApi()
  const copy = useClipboard()
  const queryCache = useQueryCache()
  const preferences = usePreferences().preferences
  const { smAndUp, mdAndUp, lgAndUp, width } = useDisplay()

  const targetId = computed(() => props.target.id)

  // Widened to the whole content area; a layout choice kept in this browser (P1).
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
  // Widened, it covers the content area only: the rail (56 px) and an open
  // shell list (340 px) stay visible beside it.
  const listOpen = computed(() => ui.listDrawer ?? mdAndUp.value)
  // Next to the shell list, the list's border is the only one.
  const covering = computed(() => wide.value && lgAndUp.value && listOpen.value)
  const drawerWidth = computed(() => (wide.value && lgAndUp.value
    ? Math.max(440, width.value - 56 - (listOpen.value ? 340 : 0))
    : (smAndUp.value ? 440 : 360)))

  // Same key prefix as before (MVP-2/3): app writes invalidate `['targets', id, 'details']`.
  const detailsKey = () => ['targets', targetId.value, 'details', props.shellId, props.item?.submodelKey ?? '', props.item?.elementKey ?? '', props.at ?? '']
  const details = useQuery({
    key: detailsKey,
    query: async ({ signal }) => {
      const item = props.item!
      const at = props.at ?? undefined
      if (item.elementKey) {
        return api<ElementDetail>(`/targets/${targetId.value}/submodels/${item.submodelKey}/elements/${item.elementKey}`, { query: { at }, signal })
      }
      const submodel = await api<SubmodelDetail>(`/targets/${targetId.value}/submodels/${item.submodelKey}`, { query: { at }, signal })
      return { key: submodel.key, path: '', value: submodel.submodel, revision: submodel.revision ?? null, concurrency: null, ancestors: [] } satisfies ElementDetail
    },
    enabled: () => props.item !== null && !props.item.unavailable && !props.item.more,
  })

  // JSON and UML of a submodel need its elements, which its details leave out.
  const usesFullSubmodel = computed(() => props.item?.elementKey === null && (mode.value === 'json' || mode.value === 'uml'))
  const fullSubmodel = useQuery({
    key: () => ['targets', targetId.value, 'details', props.shellId, props.item?.submodelKey ?? '', 'full', props.at ?? ''],
    query: ({ signal }) => api<SubmodelDetail>(`/targets/${targetId.value}/submodels/${props.item!.submodelKey}`, { query: { content: 'full', at: props.at ?? undefined }, signal }),
    enabled: () => props.item !== null && !props.item.unavailable && usesFullSubmodel.value,
  })

  const activeQuery = computed(() => (usesFullSubmodel.value ? fullSubmodel : details))
  const detail = computed(() => details.data.value ?? null)
  const value = computed(() => (detail.value?.value ?? {}) as Record<string, any>)
  const fullValue = computed(() => (usesFullSubmodel.value ? fullSubmodel.data.value?.submodel : detail.value?.value) ?? null)
  const path = computed(() => props.item?.elementKey ? decodeResourceKey(props.item.elementKey) : null)
  const title = computed(() => props.item?.variableGroup ? t(`variables.${props.item.variableGroup}`) : (props.item?.title ?? ''))
  const fileName = computed(() => (path.value ?? props.submodelLabel ?? 'submodel').replaceAll(/[^\w-]/g, '_'))

  /** The levels above the selection: its submodel and parent elements. */
  const trail = computed(() => {
    const item = props.item
    if (!item?.elementKey) {
      return []
    }
    return [
      { id: itemId(item.submodelKey, null), title: props.submodelLabel ?? t('details.submodel'), icon: modelTypeIcon('Submodel') },
      ...(detail.value?.ancestors ?? []).map(ancestor => ({ id: itemId(item.submodelKey, ancestor.key), title: ancestor.label, icon: 'mdi-subdirectory-arrow-right' })),
    ]
  })

  // App views of the selected submodel (or the submodel of the selected element).
  const contributions = useAppContributions(() => props.submodelRef?.semanticId ?? null)
  const views = computed<SubmodelViewContributionInfo[]>(() => (contributions.data.value?.submodelViews ?? [])
    .filter(item => item.reason.semanticId === props.submodelRef?.semanticId)
    .toSorted((a, b) => Number(b.bundled) - Number(a.bundled)))

  const modes = computed<Array<{ value: DetailsMode, title: string, icon: string }>>(() => [
    { value: 'details', title: t('details.modes.details'), icon: 'mdi-information-outline' },
    ...(views.value.length > 0 ? [{ value: 'visualization' as const, title: t('details.modes.visualization'), icon: 'mdi-puzzle-outline' }] : []),
    { value: 'json', title: t('details.modes.json'), icon: 'mdi-code-json' },
    // Operation variable groups have no AAS serialization of their own.
    ...(props.item?.variableGroup ? [] : [{ value: 'xml' as const, title: t('details.modes.xml'), icon: 'mdi-xml' }]),
    { value: 'uml', title: t('details.modes.uml'), icon: 'mdi-sitemap-outline' },
  ])
  // A mode the selection does not offer (no app view, a variable group)
  // shows the details; app views are known once the contributions arrived.
  watch([modes, () => contributions.data.value], ([available, data]) => {
    const known = mode.value !== 'visualization' || data !== undefined
    if (props.item && known && !available.some(entry => entry.value === mode.value)) {
      mode.value = 'details'
    }
  })

  // The edit form: in edit mode, for elements and submodels the target lets the user change.
  const form = computed(() => props.canWrite && props.capabilities.writeStructure && !props.at
    && detail.value?.revision !== null && detail.value?.revision !== undefined
    && (props.item?.elementKey ? isElementModelType(value.value.modelType) : true))
  const keepsView = computed(() => ['File', 'Blob', 'Operation'].includes(String(value.value.modelType)))

  // The concept description behind the semantic ID, where the target has a repository for them.
  const showConcept = computed(() => props.capabilities.conceptDescriptions && typeof value.value.semanticId?.keys?.[0]?.value === 'string' && value.value.semanticId.keys[0].value !== '')
  const canCreateConcept = computed(() => props.canWrite && props.capabilities.writeStructure && props.capabilities.createResources && !props.at)

  const description = computed(() => langText(Array.isArray(value.value.description) ? value.value.description : [], preferences.value.valueLanguage))

  const qualifiers = computed(() => ((value.value.qualifiers ?? []) as Array<{ type?: string, value?: string }>)
    .map(qualifier => `${qualifier.type ?? '?'}: ${qualifier.value ?? ''}`))

  // The Web UI's header fields (D6), where the element has them; `edited`
  // marks those the form edits, which edit mode shows only in the form.
  const metadata = computed(() => {
    const element = value.value
    const semanticId = (element.semanticId?.keys?.[0]?.value as string | undefined) ?? props.item?.semanticId ?? null
    const displayName = langText(Array.isArray(element.displayName) ? element.displayName : [], preferences.value.valueLanguage)
    const rows: Array<{ label: string, value: string, icon: string, copy?: boolean, edited?: boolean }> = []
    if (props.item?.modelType === 'Submodel') {
      rows.push({ label: t('details.identifier'), value: String(element.id ?? decodeResourceKey(props.item.submodelKey)), icon: 'mdi-identifier', copy: true, edited: true })
    }
    if (typeof element.idShort === 'string') {
      rows.push({ label: t('details.idShort'), value: element.idShort, icon: 'mdi-label-outline', copy: true, edited: true })
    }
    if (displayName && displayName !== element.idShort) {
      rows.push({ label: t('details.displayName'), value: displayName, icon: 'mdi-format-title', edited: true })
    }
    if (semanticId) {
      rows.push({ label: t('details.semanticId'), value: semanticId, icon: 'mdi-identifier', copy: true, edited: true })
    }
    if (element.kind) {
      rows.push({ label: t('details.kind'), value: String(element.kind), icon: 'mdi-shape-outline', edited: true })
    }
    if (element.category) {
      rows.push({ label: t('details.category'), value: String(element.category), icon: 'mdi-tag-outline', edited: true })
    }
    if (element.valueType) {
      rows.push({ label: t('details.valueType'), value: String(element.valueType), icon: 'mdi-code-tags', edited: true })
    }
    if (element.contentType) {
      rows.push({ label: t('details.contentType'), value: String(element.contentType), icon: 'mdi-file-cog-outline', edited: true })
    }
    if (element.administration?.version) {
      rows.push({ label: t('details.version'), value: [element.administration.version, element.administration.revision].filter(Boolean).join('.'), icon: 'mdi-file-certificate-outline', edited: true })
    }
    if (props.item?.children) {
      rows.push({ label: t('details.children'), value: t('details.elements', props.item.children.filter(child => !child.more).length), icon: 'mdi-file-tree-outline' })
    }
    if (path.value) {
      rows.push({ label: t('details.idShortPath'), value: path.value, icon: 'mdi-map-marker-path', copy: true })
    }
    return form.value ? rows.filter(row => !row.edited) : rows
  })

  function onChanged (changed: ElementDetail) {
    queryCache.setQueryData(detailsKey(), changed)
    emit('changed', changed)
  }
</script>
