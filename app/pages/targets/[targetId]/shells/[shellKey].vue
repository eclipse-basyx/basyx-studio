<template>
  <div>
    <!-- The drawers register with the app layout from inside the page. -->
    <ShellListDrawer :active-key="shellKey" :target-id="targetId" />

    <v-container>
      <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

      <TargetAuthorization
        v-else-if="target.data.value && (target.needsAuthorization.value || authRequired)"
        :target="target.data.value"
        @authorized="onAuthorized"
      />

      <ProblemAlert v-else-if="shell.error.value" :error="shell.error.value" retry @retry="shell.refetch()" />

      <v-skeleton-loader v-else-if="!shell.data.value || !target.data.value" type="card, article" />

      <template v-else>
        <!-- Shell header: title and a muted meta line, then the identifiers
             as a description list. Phones keep the star and a menu. -->
        <v-card class="mb-3">
          <v-card-item class="pa-3">
            <template #prepend>
              <ShellAvatar
                class="me-1"
                :icon-size="smAndUp ? 28 : 24"
                :shell="{ key: shellKey, idShort: shellJson.idShort ?? null, assetKind, thumbnail: hasThumbnail, thumbnailUrl }"
                :size="smAndUp ? 48 : 40"
                :target-id="targetId"
                :thumbnails="capabilities.files"
              />
            </template>

            <v-card-title class="ma-0 text-wrap text-break" :class="smAndUp ? 'text-title-large' : 'text-title-medium'" tag="h1">{{ shellLabel }}</v-card-title>

            <div class="d-flex flex-wrap align-center gc-3 text-body-small text-medium-emphasis">
              <span v-for="item in headerMeta" :key="item.text" class="d-inline-flex align-center ga-1" :class="item.class">
                <v-icon :icon="item.icon" size="14" />
                {{ item.text }}
              </span>
            </div>

            <template #append>
              <div class="d-flex align-center ga-1">
                <WorkspaceActions
                  v-if="target.data.value.workspace"
                  :target="target.data.value"
                  @error="error => (actionError = error)"
                  @restored="onRestored"
                />

                <template v-if="smAndUp">
                  <v-btn
                    v-if="canEditShell"
                    prepend-icon="mdi-pencil-outline"
                    :text="t('shell.edit')"
                    @click="editShell"
                  />

                  <v-btn
                    v-if="canEditShell && assetKind === 'Type'"
                    prepend-icon="mdi-content-copy"
                    :text="t('instance.create')"
                    @click="instanceOpen = true"
                  />

                  <v-btn
                    v-if="canShare"
                    prepend-icon="mdi-account-multiple-plus-outline"
                    :text="t('share.share')"
                    @click="shareOpen = true"
                  />

                  <v-menu v-if="capabilities.export">
                    <template #activator="{ props: activator }">
                      <v-btn
                        v-bind="activator"
                        append-icon="mdi-chevron-down"
                        color="primary"
                        prepend-icon="mdi-download"
                        :text="t('shell.export')"
                        variant="tonal"
                      />
                    </template>

                    <v-card>
                      <v-list>
                        <v-list-item
                          v-for="format in exportFormats"
                          :key="format.value"
                          :href="`${apiBasePath}/targets/${targetId}/shells/${shellKey}/export?format=${format.value}`"
                          :prepend-icon="format.icon"
                          :subtitle="format.subtitle"
                          :title="format.title"
                        />
                      </v-list>
                    </v-card>
                  </v-menu>
                </template>

                <!-- Everything else; on phones also export, share and the identifiers. -->
                <v-menu v-if="!smAndUp || canDelete">
                  <template #activator="{ props: activator }">
                    <v-btn v-bind="activator" :aria-label="t('shell.more')" icon="mdi-dots-vertical" />
                  </template>

                  <v-card>
                    <v-list>
                      <template v-if="!smAndUp">
                        <v-list-item v-if="canEditShell" prepend-icon="mdi-pencil-outline" :title="t('shell.edit')" @click="editShell" />

                        <v-list-item
                          v-if="canEditShell && assetKind === 'Type'"
                          prepend-icon="mdi-content-copy"
                          :title="t('instance.create')"
                          @click="instanceOpen = true"
                        />

                        <template v-if="capabilities.export">
                          <v-list-subheader :title="t('shell.export')" />

                          <v-list-item
                            v-for="format in exportFormats"
                            :key="format.value"
                            :href="`${apiBasePath}/targets/${targetId}/shells/${shellKey}/export?format=${format.value}`"
                            :prepend-icon="format.icon"
                            :title="format.title"
                          />

                          <v-divider class="my-1" />
                        </template>

                        <v-list-item v-if="canShare" prepend-icon="mdi-account-multiple-plus-outline" :title="t('share.share')" @click="shareOpen = true" />

                        <v-list-item v-if="globalAssetId" prepend-icon="mdi-qrcode" :title="t('qr.show')" @click="qrOpen = true" />

                        <v-list-item
                          :prepend-icon="showIdentifiers ? 'mdi-information-off-outline' : 'mdi-information-outline'"
                          :title="showIdentifiers ? t('shell.hideIdentifiers') : t('shell.showIdentifiers')"
                          @click="showIdentifiers = !showIdentifiers"
                        />
                      </template>

                      <template v-if="canDelete">
                        <v-divider v-if="!smAndUp" class="my-1" />
                        <v-list-item base-color="error" prepend-icon="mdi-delete-outline" :title="t('shell.delete')" @click="confirmDelete = true" />
                      </template>
                    </v-list>
                  </v-card>
                </v-menu>
              </div>
            </template>
          </v-card-item>

          <!-- Identifiers: label column, value and its copy button side by side,
               and the global asset ID as a QR code. Phones stack label and
               value and show them on request. -->
          <template v-if="smAndUp || showIdentifiers">
            <v-divider />

            <div class="d-flex align-center ga-3 px-3 py-2">
              <div class="flex-grow-1 overflow-hidden">
                <!-- A fixed label column: the card's width depends on the drawers, not on the window. -->
                <div
                  v-for="row in identifiers"
                  :key="row.label"
                  class="d-flex text-body-small"
                  :class="smAndUp ? 'align-center' : 'flex-column mb-1'"
                >
                  <v-sheet
                    class="d-flex align-center ga-2 flex-shrink-0 text-medium-emphasis text-no-wrap"
                    color="transparent"
                    :width="smAndUp ? 136 : undefined"
                  >
                    <v-icon :icon="row.icon" size="16" />
                    {{ row.label }}
                  </v-sheet>

                  <div class="d-flex align-center ga-1 overflow-hidden">
                    <span :class="smAndUp ? 'text-truncate' : 'text-break'" :title="row.value">{{ row.value }}</span>
                    <v-btn :aria-label="t('common.copyLabel', { label: row.label })" icon="mdi-content-copy" size="x-small" @click="copy(row.value, row.label)" />
                  </div>
                </div>
              </div>

              <v-btn
                v-if="globalAssetId && smAndUp"
                v-tooltip="t('qr.show')"
                :aria-label="t('qr.show')"
                class="pa-1 flex-shrink-0"
                height="72"
                min-width="0"
                width="72"
                @click="qrOpen = true"
              >
                <v-img :alt="t('qr.alt', { id: globalAssetId })" :src="qrPreview" width="64" />
              </v-btn>
            </div>
          </template>
        </v-card>

        <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

        <!-- Tabs -->
        <v-tabs v-model="tab" class="mb-3">
          <v-tab prepend-icon="mdi-file-tree-outline" :text="t('shell.tabs.submodels')" value="submodels" />
          <v-tab prepend-icon="mdi-view-dashboard-variant-outline" :text="t('shell.tabs.overview')" value="overview" />
          <v-tab v-if="capabilities.changeFeed" prepend-icon="mdi-timeline-clock-outline" :text="t('shell.tabs.changes')" value="changes" />
          <v-tab prepend-icon="mdi-code-json" :text="t('shell.tabs.json')" value="json" />
        </v-tabs>

        <v-tabs-window v-model="tab">
          <v-tabs-window-item value="submodels">
            <v-card>
              <!-- One row at every width: the filter takes the free space, the
                   controls are icon buttons with tooltips (D10). A past state
                   is named in the alert below. -->
              <div class="d-flex align-center ga-1 px-3 py-2">
                <v-text-field
                  v-model="treeSearch"
                  class="flex-grow-1 me-1"
                  clearable
                  density="compact"
                  min-width="120"
                  :placeholder="t('shell.filterElements')"
                  prepend-inner-icon="mdi-filter-variant"
                />

                <v-menu v-if="capabilities.history" v-model="historyMenu" :close-on-content-click="false">
                  <template #activator="{ props: activator }">
                    <v-btn
                      v-tooltip="asOf ? asOfLabel : t('history.pickHint')"
                      v-bind="activator"
                      :aria-label="asOf ? asOfLabel : t('history.now')"
                      :color="asOf ? 'warning' : undefined"
                      icon="mdi-history"
                      size="small"
                      :variant="asOf ? 'tonal' : 'text'"
                    />
                  </template>

                  <v-card>
                    <v-date-picker
                      :max="new Date()"
                      :model-value="asOf"
                      show-adjacent-months
                      :title="t('history.pick')"
                      @update:model-value="pickDate"
                    />
                  </v-card>
                </v-menu>

                <v-btn
                  v-tooltip="autoRefresh ? t('shell.autoRefreshOn', { seconds: preferences.preferences.value.refreshIntervalSeconds }) : t('shell.autoRefreshOff')"
                  :aria-label="t('shell.autoRefresh')"
                  :aria-pressed="autoRefresh"
                  :color="autoRefresh ? 'primary' : undefined"
                  :disabled="Boolean(asOf)"
                  :icon="autoRefresh ? 'mdi-sync' : 'mdi-sync-off'"
                  size="small"
                  :variant="autoRefresh ? 'tonal' : 'text'"
                  @click="preferences.update(current => ({ ...current, autoRefresh: !current.autoRefresh }))"
                />

                <v-btn
                  v-if="canEditShell"
                  prepend-icon="mdi-plus"
                  size="small"
                  :text="t('shell.addSubmodel')"
                  @click="addSubmodelOpen = true"
                />

                <v-btn
                  v-tooltip="t('shell.expandAll')"
                  :aria-label="t('shell.expandAll')"
                  icon="mdi-unfold-more-horizontal"
                  :loading="expanding"
                  size="small"
                  @click="expandAll"
                />

                <v-btn
                  v-tooltip="t('shell.collapseAll')"
                  :aria-label="t('shell.collapseAll')"
                  icon="mdi-unfold-less-horizontal"
                  size="small"
                  @click="opened = []"
                />
              </div>

              <v-divider />

              <v-expand-transition>
                <v-alert
                  v-if="asOf"
                  density="compact"
                  icon="mdi-history"
                  rounded="0"
                  :text="t('history.readOnly', { date: asOfLabel })"
                  type="warning"
                >
                  <template #append>
                    <v-btn :text="t('history.backToNow')" @click="asOf = null" />
                  </template>
                </v-alert>
              </v-expand-transition>

              <ProblemAlert
                v-if="refs.error.value"
                class="ma-2"
                :error="refs.error.value"
                retry
                @retry="refs.refetch()"
              />

              <v-progress-linear v-else-if="refs.isLoading.value || trees.loading.value" />

              <div v-if="refs.data.value && submodelRefs.length === 0" class="pa-4 text-medium-emphasis">{{ t('shell.noSubmodels') }}</div>

              <v-treeview
                v-else
                v-model:activated="activated"
                v-model:opened="opened"
                active-strategy="single-independent"
                class="pa-2"
                indent-lines="default"
                item-props
                item-title="title"
                item-value="id"
                :items="treeItems"
                :load-children="loadChildren"
                :search="treeSearch ?? undefined"
              >
                <template #prepend="{ item }">
                  <v-icon v-if="item.more" icon="mdi-dots-horizontal" />

                  <v-icon v-else :color="item.unavailable ? undefined : 'primary'" :icon="item.unavailable === 'forbidden' ? 'mdi-lock-outline' : modelTypeIcon(item.modelType)" />
                </template>

                <template #title="{ item }">
                  <span v-if="item.more" class="text-primary">{{ t('shell.showMore', { count: Math.min(levelPageSize, item.more.remaining), remaining: item.more.remaining }) }}</span>

                  <span v-else-if="item.unavailable" v-tooltip="t(`shell.unavailable.${item.unavailable}`)" class="text-disabled">{{ item.title }}</span>

                  <span v-else :class="item.modelType === 'Submodel' ? 'font-weight-semibold' : undefined">
                    {{ item.variableGroup ? t(`variables.${item.variableGroup}`) : item.title }}
                  </span>

                  <v-chip v-if="item.draft" class="ms-2" color="warning" :text="t('edit.draftNode')" />
                </template>

                <template #append="{ item }">
                  <template v-if="item.modelType === 'Submodel'">
                    <v-chip
                      v-if="item.refreshable && refreshSeconds"
                      class="me-1"
                      color="success"
                      prepend-icon="mdi-refresh-auto"
                      size="x-small"
                      :text="t('shell.autoRefresh')"
                    />

                    <v-chip v-if="mdAndUp && item.semanticId" size="x-small" :text="semanticLabel(item.semanticId)" />
                  </template>

                  <span v-else-if="item.preview" class="text-body-small text-medium-emphasis text-truncate ms-2">
                    {{ item.preview }}<template v-if="unitTypes.has(item.modelType) && unitOf(item.semanticId)">&nbsp;{{ unitOf(item.semanticId) }}</template>
                  </span>

                  <v-icon
                    v-if="hasDraft(item)"
                    v-tooltip="t('edit.unsaved')"
                    class="ms-1"
                    color="warning"
                    icon="mdi-circle-medium"
                  />

                  <!-- Structure actions: edit mode only (UX-006). One menu for the page (below), so
                       a refresh of the rows never closes it. -->
                  <v-btn
                    v-if="canEditStructure && hasActions(item)"
                    :aria-label="t('edit.rowMenu')"
                    class="ms-1"
                    density="comfortable"
                    icon="mdi-dots-vertical"
                    size="x-small"
                    @click.stop="openRowMenu($event, item)"
                  />
                </template>
              </v-treeview>
            </v-card>
          </v-tabs-window-item>

          <v-tabs-window-item value="overview">
            <ShellOverview
              v-if="tab === 'overview'"
              :refs="submodelRefs"
              :shell-id="shellId"
              :signals="liveSignals"
              :target="target.data.value"
              @select="select"
            />
          </v-tabs-window-item>

          <v-tabs-window-item value="changes">
            <ShellChanges
              v-if="tab === 'changes'"
              :refs="submodelRefs"
              :shell-id="shellId"
              :shell-label="shellLabel"
              :target-id="targetId"
            />
          </v-tabs-window-item>

          <v-tabs-window-item value="json">
            <v-card height="600">
              <JsonPanel :file-name="jsonFileName" :label="t('shell.jsonLabel')" :value="shellJson" />
            </v-card>
          </v-tabs-window-item>
        </v-tabs-window>

        <AssetQrDialog v-if="globalAssetId" v-model="qrOpen" :content="globalAssetId" :file-name="shellJson.idShort ?? 'asset'" />

        <ShareDialog
          v-if="canShare"
          v-model="shareOpen"
          :shell-key="shellKey"
          :shell-label="shellLabel"
          :target-id="targetId"
        />

        <v-menu v-model="rowMenuOpen" :activator="rowMenuActivator ?? undefined" :close-on-content-click="false" :open-on-click="false">
          <v-card v-if="menuItem" @click="closeRowMenu">
            <v-list>
              <v-list-item
                v-if="menuItem.modelType === 'Submodel'"
                prepend-icon="mdi-pencil-outline"
                :title="t('edit.editSubmodel')"
                @click="select(menuItem.id)"
              />

              <v-list-group v-if="isContainerItem(menuItem) && menuItem.modelType !== 'SubmodelElementList'">
                <template #activator="{ props: group }">
                  <v-list-item v-bind="group" prepend-icon="mdi-plus" :title="t('edit.addElement')" />
                </template>

                <v-list-item
                  v-for="type in addableTypes(menuItem)"
                  :key="type"
                  :prepend-icon="modelTypeIcon(type)"
                  :title="type"
                  @click="startCreate(menuItem, type)"
                />
              </v-list-group>

              <v-list-item
                v-else-if="isContainerItem(menuItem)"
                prepend-icon="mdi-plus"
                :title="t('edit.addElement')"
                @click="startCreate(menuItem, null)"
              />

              <v-list-item
                v-if="isContainerItem(menuItem) && clipboardStore.copied"
                prepend-icon="mdi-content-paste"
                :subtitle="clipboardStore.copied.label"
                :title="t('edit.paste')"
                @click="pasteInto(menuItem)"
              />

              <v-list-item
                v-if="isContainerItem(menuItem)"
                prepend-icon="mdi-code-json"
                :title="t('edit.insertJson')"
                @click="jsonTarget = menuItem"
              />

              <template v-if="menuItem.modelType === 'Submodel' && capabilities.createResources">
                <v-list-item
                  v-if="menuItem.kind === 'Template'"
                  prepend-icon="mdi-file-replace-outline"
                  :title="t('edit.convert')"
                  @click="convertTarget = menuItem"
                />

                <v-list-item base-color="error" prepend-icon="mdi-file-remove-outline" :title="t('edit.removeSubmodel')" @click="removeSubmodelTarget = menuItem" />
              </template>

              <template v-if="menuItem.elementKey">
                <v-divider v-if="isContainerItem(menuItem)" class="my-1" />
                <v-list-item prepend-icon="mdi-content-copy" :title="t('edit.copy')" @click="copyElement(menuItem)" />
                <v-list-item prepend-icon="mdi-link-variant" :title="t('edit.copyReference')" @click="copyReference(menuItem)" />
                <v-list-item prepend-icon="mdi-content-duplicate" :title="t('edit.duplicate')" @click="duplicate(menuItem)" />

                <v-divider class="my-1" />
                <v-list-item :disabled="!canMove(menuItem) || position(menuItem) <= 0" prepend-icon="mdi-arrow-up" :title="t('edit.moveUp')" @click="move(menuItem, -1)" />
                <v-list-item :disabled="!canMove(menuItem) || position(menuItem) < 0 || position(menuItem) >= siblingCount(menuItem) - 1" prepend-icon="mdi-arrow-down" :title="t('edit.moveDown')" @click="move(menuItem, 1)" />

                <v-divider class="my-1" />
                <v-list-item base-color="error" prepend-icon="mdi-delete-outline" :title="t('edit.delete')" @click="pendingDelete = menuItem" />
              </template>
            </v-list>
          </v-card>
        </v-menu>

        <v-dialog max-width="460" :model-value="convertTarget !== null" @update:model-value="open => { if (!open) convertTarget = null }">
          <DialogCard :title="t('edit.convertTitle')">
            {{ t('edit.convertText', { name: convertTarget?.title ?? '' }) }}

            <template #actions>
              <v-btn :text="t('common.cancel')" @click="convertTarget = null" />
              <v-btn-primary :loading="converting" :text="t('edit.convert')" @click="convertToInstance" />
            </template>
          </DialogCard>
        </v-dialog>

        <v-dialog max-width="480" :model-value="removeSubmodelTarget !== null" @update:model-value="open => { if (!open) removeSubmodelTarget = null }">
          <DialogCard :title="t('edit.removeSubmodelTitle', { name: removeSubmodelTarget?.title ?? '' })">
            {{ t('edit.removeSubmodelText') }}

            <v-checkbox v-model="alsoDelete" class="mt-2" :label="t('edit.alsoDelete')" />

            <template #actions>
              <v-btn :text="t('common.cancel')" @click="removeSubmodelTarget = null" />
              <v-btn-primary color="error" :loading="removingSubmodel" :text="t('edit.removeSubmodel')" @click="removeSubmodel" />
            </template>
          </DialogCard>
        </v-dialog>

        <SubmodelAddDialog v-model="addSubmodelOpen" :shell-key="shellKey" :target-id="targetId" @added="afterShellChange" />

        <InstanceDialog
          v-model="instanceOpen"
          :name="shellLabel"
          :shell-key="shellKey"
          :target-id="targetId"
          @created="onInstanceCreated"
        />

        <JsonInsertDialog
          :kind="'element'"
          :model-value="jsonTarget !== null"
          :submit="insertJson"
          :target-id="targetId"
          :title="t('edit.insertJsonTitle', { name: jsonTarget?.title ?? '' })"
          @update:model-value="open => { if (!open) jsonTarget = null }"
        />

        <v-dialog max-width="420" :model-value="pendingDelete !== null" @update:model-value="open => { if (!open) pendingDelete = null }">
          <DialogCard :title="t('edit.deleteTitle')">
            {{ t('edit.deleteText', { name: pendingDelete?.title ?? '', type: pendingDelete?.modelType ?? '' }) }}

            <template #actions>
              <v-btn :text="t('common.cancel')" @click="pendingDelete = null" />
              <v-btn-primary color="error" :loading="removing" :text="t('edit.delete')" @click="removeElement" />
            </template>
          </DialogCard>
        </v-dialog>

        <v-dialog v-model="confirmDelete" max-width="420">
          <DialogCard :title="t('shell.deleteTitle')">
            <p class="text-body-medium mb-2">{{ t('shell.deleteText', { name: shellLabel }) }}</p>

            <template v-if="submodelRefs.length > 0">
              <v-checkbox v-model="alsoDeleteSubmodels" :label="t('shell.alsoDeleteSubmodels', submodelRefs.length)" />

              <v-expand-transition>
                <v-sheet
                  v-if="alsoDeleteSubmodels"
                  border
                  class="overflow-y-auto"
                  color="transparent"
                  max-height="200"
                  rounded="lg"
                >
                  <v-list>
                    <v-list-subheader>{{ t('shell.affectedSubmodels') }}</v-list-subheader>

                    <v-list-item
                      v-for="submodelRef in submodelRefs"
                      :key="submodelRef.key"
                      prepend-icon="mdi-file-tree-outline"
                      :subtitle="submodelRef.submodelId"
                      :title="submodelRef.idShort ?? submodelRef.submodelId"
                    />
                  </v-list>
                </v-sheet>
              </v-expand-transition>

              <v-alert
                v-if="alsoDeleteSubmodels"
                class="mt-3"
                density="compact"
                :text="t('shell.sharedWarning')"
                type="warning"
              />
            </template>

            <template #actions>
              <v-btn :text="t('common.cancel')" @click="confirmDelete = false" />
              <v-btn-primary color="error" :loading="deleting" :text="t('shell.delete')" @click="remove" />
            </template>
          </DialogCard>
        </v-dialog>
      </template>
    </v-container>

    <ElementDetailsDrawer
      v-if="target.data.value && shell.data.value"
      v-model:mode="detailsMode"
      v-model:view="detailsView"
      :at="asOfIso"
      :can-invoke="canInvoke"
      :can-write="canWrite"
      :capabilities="capabilities"
      :creating="creating"
      :editing-shell="editingShell"
      :history="selectedItem ? (trees.history.value.get(selectedItem.id) ?? []) : []"
      :item="selectedItem"
      :refreshing="Boolean(refreshSeconds)"
      :shell-detail="shell.data.value"
      :shell-id="shellId"
      :submodel-label="selectedSubmodelLabel"
      :submodel-ref="selectedRef"
      :target="target.data.value"
      @cancel-create="creating = null"
      @changed="onElementChanged"
      @close-shell="editingShell = false"
      @created="onCreated"
      @select="select"
      @shell-changed="onShellChanged"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { ElementModelType } from '#shared/aas/defaults'
  import type { DeleteResult, EffectiveRights, ElementDetail, ShellCreateResult, ShellDetail, SubmodelRef, Target, TargetCapabilities } from '#shared/contract'
  import type { LiveSignal } from '~/components/ShellOverview.vue'
  import type { ShellTreeItem } from '~/composables/useShellTrees'
  import type { StructureAction } from '~/stores/structureActions'
  import type { DetailsMode } from '~/utils/aas'
  import type { CreatingElement } from '~/utils/editor'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { childTypesFor, isContainerType, newElement, uniqueIdShort } from '#shared/aas/defaults'
  import { apiBasePath, noCapabilities } from '#shared/contract'
  import { expandAllCap, itemId, levelPageSize } from '~/composables/useShellTrees'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { decodeResourceKey, detailsModes, langText, modelTypeIcon } from '~/utils/aas'
  import { identificationLinkSvg, svgDataUrl } from '~/utils/qr'

  const { t, locale } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const invalidate = useInvalidate()
  const queryCache = useQueryCache()
  const ui = useUiStore()
  const copy = useClipboard()
  const preferences = usePreferences()
  const notifications = useNotificationsStore()
  const { smAndUp, mdAndUp } = useDisplay()
  const draftSuffix = '#draft'
  /** Live value cards on the Overview, so a large submodel cannot fill it. */
  const liveSignalLimit = 8

  const targetId = computed(() => String(route.params.targetId))
  const shellKey = computed(() => String(route.params.shellKey))
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

  const capabilities = computed<TargetCapabilities>(() => target.data.value?.capabilities ?? noCapabilities)
  const rights = useQuery({
    key: () => ['targets', targetId.value, 'shells', shellKey.value, 'rights'],
    query: ({ signal }) => api<EffectiveRights>(`/targets/${targetId.value}/shells/${shellKey.value}/rights`, { signal }),
    enabled: () => ready() && Boolean(target.data.value?.capabilities.sharing),
  })
  const can = (action: keyof EffectiveRights) => !capabilities.value.sharing || (rights.data.value?.[action] ?? false)

  const shellJson = computed(() => (shell.data.value?.shell ?? {}) as Record<string, any>)
  const shellId = computed(() => String(shellJson.value.id ?? ''))
  const jsonFileName = computed(() => `${String(shellJson.value.idShort ?? 'shell').replaceAll(/[^\w-]/g, '_')}.json`)
  const shellLabel = computed(() => langText(shellJson.value.displayName ?? [], preferences.preferences.value.valueLanguage) ?? shellJson.value.idShort ?? shellId.value)
  const assetKind = computed(() => (shellJson.value.assetInformation?.assetKind as string | undefined) ?? null)
  const assetType = computed(() => (shellJson.value.assetInformation?.assetType as string | undefined) ?? null)
  // The idShort only when the title is a display name, so nothing repeats.
  /** The muted line under the title: idShort, kind, submodels, target. */
  const headerMeta = computed(() => [
    ...(shellJson.value.idShort && shellJson.value.idShort !== shellLabel.value ? [{ text: String(shellJson.value.idShort), icon: '$aas', class: undefined }] : []),
    ...(assetKind.value ? [{ text: t('shell.assetKind', { kind: assetKind.value }), icon: 'mdi-shape-outline', class: assetKind.value === 'Type' ? 'text-warning' : undefined }] : []),
    { text: t('shell.submodelCount', submodelRefs.value.length), icon: 'mdi-folder-multiple-outline', class: undefined },
    ...(target.data.value ? [{ text: target.data.value.name, icon: 'mdi-server-network', class: undefined }] : []),
  ])
  const thumbnailUrl = computed(() => {
    const path = shellJson.value.assetInformation?.defaultThumbnail?.path
    return typeof path === 'string' && /^https?:\/\//i.test(path) ? path : null
  })
  const hasThumbnail = computed(() => typeof shellJson.value.assetInformation?.defaultThumbnail?.path === 'string')
  const submodelRefs = computed(() => refs.data.value?.items ?? [])

  const identifiers = computed(() => [
    { label: t('shell.identifier'), value: shellId.value, icon: 'mdi-identifier' },
    ...(shellJson.value.assetInformation?.globalAssetId
      ? [{ label: t('shell.globalAssetId'), value: String(shellJson.value.assetInformation.globalAssetId), icon: 'mdi-barcode' }]
      : []),
    ...(assetType.value ? [{ label: t('shell.assetType'), value: assetType.value, icon: 'mdi-tag-outline' }] : []),
  ])

  // In view mode nothing can be changed (plan D8); with sharing, the user's rights decide (D15).
  const asOf = ref<Date | null>(null)
  const canWrite = computed(() => ui.editing && capabilities.value.write && can('update') && !asOf.value)
  // Structure actions need the target to accept structural writes (MVP-5 plan, P1).
  const canEditShell = computed(() => ui.editing && capabilities.value.createResources && can('update') && !asOf.value)
  const canEditStructure = computed(() => ui.editing && capabilities.value.writeStructure && can('update') && !asOf.value)
  const canDelete = computed(() => ui.editing && capabilities.value.deleteShells && can('delete'))
  const canInvoke = computed(() => capabilities.value.operations && can('execute') && !asOf.value)
  const canShare = computed(() => capabilities.value.sharing && can('manage'))

  const exportFormats = computed(() => [
    { value: 'aasx', title: t('shell.formats.aasx'), subtitle: '.aasx', icon: 'mdi-package-variant-closed' },
    { value: 'json', title: t('shell.formats.json'), subtitle: '.json', icon: 'mdi-code-json' },
    { value: 'xml', title: t('shell.formats.xml'), subtitle: '.xml', icon: 'mdi-xml' },
  ])

  const tab = computed({
    get: () => {
      const value = typeof route.query.tab === 'string' ? route.query.tab : 'submodels'
      return value === 'changes' && !capabilities.value.changeFeed ? 'submodels' : value
    },
    set: (value: string) => router.replace({ query: { ...route.query, tab: value === 'submodels' ? undefined : value } }),
  })

  // Point in time: the end of the chosen day, or now for today.
  const historyMenu = ref(false)
  const asOfIso = computed(() => {
    if (!asOf.value) {
      return null
    }
    const end = new Date(asOf.value)
    end.setHours(23, 59, 59, 999)
    return (end > new Date() ? new Date() : end).toISOString()
  })
  const asOfLabel = computed(() => asOf.value?.toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '')
  function pickDate (value: unknown) {
    asOf.value = value instanceof Date ? value : null
    historyMenu.value = false
  }

  const autoRefresh = computed(() => preferences.preferences.value.autoRefresh)
  const refreshSeconds = computed(() => preferences.preferences.value.autoRefresh && !asOf.value ? preferences.preferences.value.refreshIntervalSeconds : null)
  const opened = ref<string[]>([])
  const treeSearch = ref<string | null>('')
  const trees = useShellTrees({
    targetId: () => targetId.value,
    refs: () => submodelRefs.value,
    at: () => asOfIso.value,
    refreshSeconds: () => refreshSeconds.value,
    opened: () => opened.value,
    unpaged: () => Boolean(treeSearch.value),
  })
  // Units of linked concept descriptions, shown beside values in the tree and on the Overview (MVP-6 plan, E6).
  const unitOf = useConceptUnits(targetId, () => capabilities.value.conceptDescriptions)
  const unitTypes = new Set(['Property', 'Range'])

  // The Overview's live values: numeric properties whose value changed while auto-refresh re-read them.
  const liveSignals = computed<LiveSignal[]>(() => {
    if (!refreshSeconds.value) {
      return []
    }
    const signals: LiveSignal[] = []
    for (const [id, values] of trees.history.value) {
      const item = new Set(values).size > 1 ? trees.lookup(id) : null
      if (item) {
        const submodel = trees.items.value.find(entry => entry.id === item.submodelKey)?.title ?? item.submodelKey
        signals.push({ id, title: item.title, submodel, value: item.preview, unit: unitOf(item.semanticId), history: values })
      }
    }
    return signals.slice(0, liveSignalLimit)
  })
  const treeItems = computed(() => {
    const items = trees.items.value.map(item => item.unavailable ? { ...item, disabled: true } : item)
    const draft = creating.value
    if (!draft) {
      return items
    }
    // The element being created is a row of its own, marked as a draft (U4).
    const parentId = draft.parentKey ? itemId(draft.submodelKey, draft.parentKey) : draft.submodelKey
    const row: ShellTreeItem = {
      id: `${parentId}${draftSuffix}`,
      title: String(draft.element.idShort ?? draft.element.modelType),
      modelType: String(draft.element.modelType),
      submodelKey: draft.submodelKey,
      elementKey: null,
      semanticId: null,
      preview: null,
      valueType: null,
      variableGroup: null,
      unavailable: null,
      refreshable: false,
      draft: true,
    }
    const insert = (list: ShellTreeItem[]): ShellTreeItem[] => list.map(item => item.id === parentId
      ? { ...item, children: [...(item.children ?? []), row] }
      : (item.children ? { ...item, children: insert(item.children) } : item))
    return insert(items)
  })

  async function loadChildren (raw: unknown) {
    await trees.loadChildren(raw as ShellTreeItem)
  }

  // Expands the opened submodels (or all, if none is open) as far as the cap allows.
  const expanding = ref(false)
  async function expandAll () {
    expanding.value = true
    try {
      const openSubmodels = trees.items.value.filter(item => opened.value.includes(item.id)).map(item => item.id)
      const { ids, capped } = await trees.expandAll(openSubmodels.length > 0 ? openSubmodels : trees.items.value.map(item => item.id))
      opened.value = [...new Set([...opened.value, ...ids])]
      if (capped) {
        notifications.notify({ text: t('shell.expandCapped', { count: expandAllCap.toLocaleString(locale.value) }), color: 'info' })
      }
    } finally {
      expanding.value = false
    }
  }

  /** Short label of a semantic ID for the submodel chip, e.g. `Nameplate 3.0`. */
  function semanticLabel (semanticId: string): string {
    const idta = /\/([A-Z]+)\/(\d+)\/(\d+)(?:\/[A-Z]+)?$/i.exec(semanticId)
    return idta ? `${idta[1]} ${idta[2]}.${idta[3]}` : (semanticId.split(/[/#]/).findLast(Boolean) ?? semanticId)
  }

  // Selection lives in the URL (`submodel`, `element`), so it can be shared and survives reloads.
  const selectedId = computed(() => {
    const submodel = typeof route.query.submodel === 'string' ? route.query.submodel : null
    const element = typeof route.query.element === 'string' ? route.query.element : null
    return submodel ? itemId(submodel, element) : null
  })

  const selectedItem = computed(() => selectedId.value ? trees.lookup(selectedId.value) : null)
  const selectedSubmodelLabel = computed(() => trees.items.value.find(item => item.id === selectedItem.value?.submodelKey)?.title ?? null)
  const selectedRef = computed(() => submodelRefs.value.find(ref => ref.key === selectedItem.value?.submodelKey) ?? null)

  // The drawer's mode and app view (R3); a `view` alone (MVP-3 links) opens the visualization.
  const detailsMode = computed<DetailsMode>({
    get: () => {
      const value = route.query.mode
      if (typeof value === 'string' && (detailsModes as readonly string[]).includes(value)) {
        return value as DetailsMode
      }
      return typeof route.query.view === 'string' ? 'visualization' : 'details'
    },
    set: (value: DetailsMode) => router.replace({ query: { ...route.query, mode: value === 'details' ? undefined : value, view: value === 'visualization' ? route.query.view : undefined } }),
  })
  const detailsView = computed<string | null>({
    get: () => (typeof route.query.view === 'string' ? route.query.view : null),
    set: (value: string | null) => router.replace({ query: { ...route.query, view: value ?? undefined } }),
  })

  function select (id: string | null) {
    const found = id ? trees.lookup(id) : null
    if (found?.more) {
      trees.showMore(found.more.parent)
      return
    }
    // A new element's draft stays in the draft store; the form closes.
    if (id?.endsWith(draftSuffix)) {
      return
    }
    creating.value = null
    editingShell.value = false
    void router.replace({ query: { ...route.query, submodel: found?.submodelKey, element: found?.elementKey ?? undefined } })
    ui.detailsDrawer = Boolean(found)
  }

  const activated = computed({
    get: () => (selectedId.value ? [selectedId.value] : []),
    set: (ids: unknown[]) => select((ids[0] as string | undefined) ?? null),
  })

  // Open the first submodel when the tree appears.
  watch(() => trees.items.value.length, (count, before) => {
    if (count > 0 && !before && opened.value.length === 0) {
      opened.value = trees.items.value.filter(item => !item.unavailable).slice(0, 1).map(item => item.id)
    }
  })

  // A selection made elsewhere (deep link, search): load and open its path,
  // which the element's ancestors name.
  const revealing = ref<string | null>(null)
  watch([selectedId, () => submodelRefs.value.length, asOfIso], async ([id]) => {
    const submodel = typeof route.query.submodel === 'string' ? route.query.submodel : null
    const element = typeof route.query.element === 'string' ? route.query.element : null
    if (!id || !submodel || revealing.value === id || !submodelRefs.value.some(ref => ref.key === submodel && ref.status === 'available')) {
      return
    }
    revealing.value = id
    try {
      let ancestors: string[] = []
      if (element && !trees.lookup(id)) {
        const detail = await api<ElementDetail>(`/targets/${targetId.value}/submodels/${submodel}/elements/${element}`, { query: { at: asOfIso.value ?? undefined } })
        ancestors = detail.ancestors.map(ancestor => ancestor.key)
      } else if (element) {
        ancestors = trail(id)
      }
      const path = await trees.reveal(submodel, ancestors, element)
      if (path && selectedId.value === id) {
        opened.value = [...new Set([...opened.value, ...path])]
        ui.detailsDrawer = true
      }
    } catch {
      // The drawer shows why the element cannot be read.
      ui.detailsDrawer = true
    } finally {
      revealing.value = null
    }
  }, { immediate: true })

  /** Element keys of the loaded items above an item. */
  function trail (id: string): string[] {
    const walk = (list: ShellTreeItem[], path: string[]): string[] | null => {
      for (const item of list) {
        if (item.id === id) {
          return path
        }
        const found = walk(item.children ?? [], item.elementKey ? [...path, item.elementKey] : path)
        if (found) {
          return found
        }
      }
      return null
    }
    return walk(trees.items.value, []) ?? []
  }

  watch([targetId, shellKey], () => {
    asOf.value = null
    opened.value = []
  })
  // Remembered once the shell is loaded, with the title the user saw.
  watch(() => shell.data.value?.key, key => {
    if (key) {
      void preferences.rememberShell(targetId.value, key, shellLabel.value)
    }
  }, { immediate: true })

  async function onElementChanged (detail: ElementDetail) {
    const item = selectedItem.value
    if (item) {
      await trees.refresh(item.submodelKey)
    }
    // A workspace now has unsaved changes.
    await queryCache.invalidateQueries({ key: ['targets', targetId.value], exact: true })
    // A rename or move gives the element a new path: the selection and URL follow (W3).
    if (item?.elementKey && detail.key !== item.elementKey) {
      select(itemId(item.submodelKey, detail.key))
    }
  }

  // Structure editing (MVP-5 plan, U3, U4, U6, C1)
  const clipboardStore = useClipboardStore()
  const drafts = useDraftStore()
  const structure = useStructureEdits(() => targetId.value)
  const creating = ref<CreatingElement | null>(null)
  const editingShell = ref(false)
  const rowMenuOpen = ref(false)
  const rowMenuActivator = ref<HTMLElement | null>(null)
  const rowMenuItem = ref<ShellTreeItem | null>(null)
  // A snapshot of the row: refreshes of the tree do not rebuild the open menu.
  const menuItem = computed(() => rowMenuItem.value)

  /** Choosing an action closes the menu; opening the type group does not. */
  function closeRowMenu (event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('.v-list-group__header')) {
      rowMenuOpen.value = false
    }
  }

  function openRowMenu (event: MouseEvent, item: ShellTreeItem) {
    rowMenuItem.value = item
    rowMenuActivator.value = event.currentTarget as HTMLElement
    rowMenuOpen.value = true
  }
  const addSubmodelOpen = ref(false)
  const instanceOpen = ref(false)
  const jsonTarget = ref<ShellTreeItem | null>(null)
  const convertTarget = ref<ShellTreeItem | null>(null)
  const converting = ref(false)
  const removeSubmodelTarget = ref<ShellTreeItem | null>(null)
  const alsoDelete = ref(false)
  const removingSubmodel = ref(false)
  const pendingDelete = ref<ShellTreeItem | null>(null)
  const removing = ref(false)

  const hasDraft = (item: ShellTreeItem) => !item.more && !item.draft && drafts.has(targetId.value, item.submodelKey, item.elementKey ?? 'submodel')
  const isContainerItem = (item: ShellTreeItem) => item.modelType === 'Submodel' || isContainerType(item.modelType)
  function hasActions (item: ShellTreeItem) {
    return !item.more && !item.unavailable && !item.variableGroup && item.modelType !== 'OperationVariables'
      && (item.modelType === 'Submodel' ? isContainerItem(item) : !item.elementKey?.includes('@'))
  }
  const addableTypes = (item: ShellTreeItem) => childTypesFor(item.modelType === 'Submodel' ? null : { modelType: item.modelType })

  const siblings = (item: ShellTreeItem) => (trees.parentOf(item.id)?.children ?? []).filter(child => !child.more)
  // Named children keep an order only where the target stores one; list items always do.
  const canMove = (item: ShellTreeItem) => capabilities.value.orderedChildren || (decodeResourceKey(item.elementKey ?? '') ?? '').endsWith(']')
  const position = (item: ShellTreeItem) => siblings(item).findIndex(child => child.id === item.id)
  const siblingCount = (item: ShellTreeItem) => siblings(item).length

  /** The revision of the children of a container, loading its level first. */
  async function structureRevisionOf (item: Pick<ShellTreeItem, 'id' | 'submodelKey' | 'elementKey'>): Promise<string> {
    await trees.loadChildren(item)
    const revision = trees.structureRevision(item.id)
    if (!revision) {
      throw new StudioApiError({ type: 'about:blank', title: 'The structure is not known yet', status: 412, code: 'structure_conflict', requestId: '', retryable: true })
    }
    return revision
  }

  async function guard (work: () => Promise<void>) {
    actionError.value = null
    try {
      await work()
    } catch (error) {
      actionError.value = error
      // A conflict means the tree is out of date.
      if (error instanceof StudioApiError && ['structure_conflict', 'revision_conflict'].includes(error.code) && selectedItem.value) {
        await trees.refresh(selectedItem.value.submodelKey)
      }
    }
  }

  function editShell () {
    creating.value = null
    editingShell.value = true
    ui.detailsDrawer = true
  }

  /** Something about the shell changed: its header, references and tree are read again. */
  async function afterShellChange () {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
    await trees.reload()
  }

  async function onShellChanged () {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
  }

  async function onRestored () {
    await afterShellChange()
  }

  async function onInstanceCreated (result: ShellCreateResult) {
    await queryCache.invalidateQueries({ key: ['targets', targetId.value] })
    notifications.notify({ text: t('instance.created', { name: result.shell.idShort ?? result.shell.id }), color: 'success' })
    await router.push(`/targets/${targetId.value}/shells/${result.shell.key}`)
  }

  async function insertJson (value: Record<string, unknown>) {
    const parent = jsonTarget.value!
    const revision = await structureRevisionOf(parent)
    const names = (parent.children ?? []).filter(child => !child.more).map(child => child.title)
    const added = await structure.paste(parent.submodelKey, parent.elementKey, revision, value, names, parent.modelType === 'SubmodelElementList')
    opened.value = [...new Set([...opened.value, parent.id])]
    await afterStructureChange(parent.submodelKey)
    select(itemId(parent.submodelKey, added.key))
  }

  async function convertToInstance () {
    const item = convertTarget.value
    if (!item) {
      return
    }
    converting.value = true
    await guard(async () => {
      const result = await api<{ removedQualifiers: number }>(`/targets/${targetId.value}/submodels/${item.submodelKey}/instance-conversions`, { method: 'POST' })
      notifications.notify({ text: t('edit.converted', { name: item.title, count: result.removedQualifiers }), color: 'success' })
      await afterShellChange()
    })
    converting.value = false
    convertTarget.value = null
  }

  async function removeSubmodel () {
    const item = removeSubmodelTarget.value
    if (!item) {
      return
    }
    removingSubmodel.value = true
    await guard(async () => {
      await api(`/targets/${targetId.value}/shells/${shellKey.value}/submodel-refs/${item.submodelKey}`, {
        method: 'DELETE',
        query: { deleteSubmodel: String(alsoDelete.value) },
      })
      if (selectedItem.value?.submodelKey === item.submodelKey) {
        select(null)
      }
      await afterShellChange()
    })
    removingSubmodel.value = false
    removeSubmodelTarget.value = null
    alsoDelete.value = false
  }

  // ⌘Z and ⇧⌘Z undo and redo on workspaces, until Save or Close (W8); live
  // targets have no undo, and text fields keep their own.
  const workspaceId = computed(() => target.data.value?.workspace ? targetId.value : null)
  function onKeydown (event: KeyboardEvent) {
    if (!ui.editing || !workspaceId.value || !capabilities.value.undo || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
      return
    }
    const active = event.target as HTMLElement | null
    if (active?.closest('input, textarea, [contenteditable="true"], .monaco-editor')) {
      return
    }
    event.preventDefault()
    const workspace = target.data.value?.workspace
    const kind = event.shiftKey ? 'redos' : 'undos'
    if ((kind === 'undos' && !workspace?.canUndo) || (kind === 'redos' && !workspace?.canRedo)) {
      return
    }
    void guard(async () => {
      const updated = await api<Target>(`/workspaces/${workspaceId.value}/${kind}`, { method: 'POST' })
      queryCache.setQueryData(['targets', updated.id], updated)
      await afterShellChange()
    })
  }
  onMounted(() => globalThis.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => globalThis.removeEventListener('keydown', onKeydown))

  // The selected node's actions are in the command palette too (U3).
  const structureActions = useStructureActionsStore()
  watchEffect(() => {
    const item = selectedItem.value
    if (!canEditStructure.value || !item || !hasActions(item)) {
      structureActions.set([])
      return
    }
    const actions: StructureAction[] = []
    if (isContainerItem(item)) {
      actions.push(
        { key: 'add', title: t('palette.structure.add', { name: item.title }), icon: 'mdi-plus', run: () => void startCreate(item, item.modelType === 'SubmodelElementList' ? null : 'Property') },
        { key: 'json', title: t('palette.structure.json', { name: item.title }), icon: 'mdi-code-json', run: () => (jsonTarget.value = item) },
        ...(clipboardStore.copied
          ? [{ key: 'paste', title: t('palette.structure.paste', { name: item.title }), icon: 'mdi-content-paste', run: () => void pasteInto(item) }]
          : []),
      )
    }
    if (item.elementKey) {
      actions.push(
        { key: 'copy', title: t('palette.structure.copy', { name: item.title }), icon: 'mdi-content-copy', run: () => void copyElement(item) },
        { key: 'duplicate', title: t('palette.structure.duplicate', { name: item.title }), icon: 'mdi-content-duplicate', run: () => void duplicate(item) },
        { key: 'delete', title: t('palette.structure.delete', { name: item.title }), icon: 'mdi-delete-outline', run: () => (pendingDelete.value = item) },
      )
    }
    structureActions.set(actions)
  })
  onBeforeUnmount(() => structureActions.set([]))

  async function startCreate (item: ShellTreeItem, modelType: ElementModelType | null) {
    await guard(async () => {
      const revision = await structureRevisionOf(item)
      const parent = item.elementKey ? (await structure.read(item.submodelKey, item.elementKey)).value as Record<string, unknown> : null
      const inList = parent?.modelType === 'SubmodelElementList'
      const type = (inList ? parent.typeValueListElement : modelType) as ElementModelType
      const taken = (item.children ?? []).filter(child => !child.more).map(child => child.title)
      creating.value = {
        submodelKey: item.submodelKey,
        parentKey: item.elementKey,
        parentLabel: item.title,
        structureRevision: revision,
        index: null,
        element: newElement(type, inList ? null : uniqueIdShort(type, taken), parent),
        isListChild: inList,
      }
      opened.value = [...new Set([...opened.value, item.id])]
      ui.detailsDrawer = true
    })
  }

  async function afterStructureChange (submodelKey: string) {
    await trees.refresh(submodelKey)
    await queryCache.invalidateQueries({ key: ['targets', targetId.value], exact: true })
    // Paths of list items shift, so cached details may show another element now.
    await queryCache.invalidateQueries({ key: ['targets', targetId.value, 'details'] })
  }

  /**
   * A selection addressed by list index follows a deleted or moved element
   * (`to` is `null` for a delete). False if the selection was deleted with it.
   */
  function followSelection (item: ShellTreeItem, to: number | null): boolean {
    const element = typeof route.query.element === 'string' ? decodeResourceKey(route.query.element) : null
    const changed = item.elementKey ? decodeResourceKey(item.elementKey) : null
    if (route.query.submodel !== item.submodelKey || !element || !changed) {
      return true
    }
    const next = followListChange(element, changed, to)
    if (next !== null && next !== element) {
      void router.replace({ query: { ...route.query, element: resourceKey(next) } })
    }
    return next !== null
  }

  async function onCreated (detail: ElementDetail) {
    const submodelKey = creating.value?.submodelKey
    creating.value = null
    if (submodelKey) {
      await afterStructureChange(submodelKey)
      select(itemId(submodelKey, detail.key))
    }
  }

  async function removeElement () {
    const item = pendingDelete.value
    if (!item?.elementKey) {
      return
    }
    removing.value = true
    await guard(async () => {
      await structure.remove(item.submodelKey, item.elementKey!)
      notifications.notify({ text: t('edit.deleted', { name: item.title }), color: 'success' })
      const parent = trees.parentOf(item.id)
      const wasSelected = selectedId.value === item.id || !followSelection(item, null)
      await afterStructureChange(item.submodelKey)
      if (wasSelected) {
        select(parent?.id ?? null)
      }
    })
    removing.value = false
    pendingDelete.value = null
  }

  async function move (item: ShellTreeItem, delta: -1 | 1) {
    await guard(async () => {
      const parent = trees.parentOf(item.id)
      if (!parent || !item.elementKey) {
        return
      }
      const revision = await structureRevisionOf(parent)
      const to = position(item) + delta
      const moved = await structure.move(item.submodelKey, item.elementKey, to, revision)
      const wasSelected = selectedId.value === item.id
      if (!wasSelected) {
        followSelection(item, to)
      }
      await afterStructureChange(item.submodelKey)
      if (wasSelected) {
        select(itemId(item.submodelKey, moved.key))
      }
    })
  }

  async function copyElement (item: ShellTreeItem) {
    await guard(async () => {
      const detail = await structure.read(item.submodelKey, item.elementKey!)
      const element = detail.value as Record<string, unknown>
      clipboardStore.copy({ element, label: `${item.modelType} ${item.title}` })
      // As AAS JSON on the system clipboard too (C1).
      await copy(JSON.stringify(element, null, 2), item.title)
    })
  }

  /** A model reference to an element, for reference fields (C2). */
  async function copyReference (item: ShellTreeItem) {
    const submodelId = decodeResourceKey(item.submodelKey)
    const locator = decodeResourceKey(item.elementKey!)
    if (!submodelId || !locator) {
      return
    }
    const segments = locator.match(/[^.[\]]+/g) ?? []
    const keys = [
      { type: 'Submodel', value: submodelId },
      ...segments.map((segment, index) => ({ type: index === segments.length - 1 ? item.modelType : 'SubmodelElement', value: segment })),
    ]
    clipboardStore.copyReference({ type: 'ModelReference', keys })
    notifications.notify({ text: t('edit.referenceCopied', { name: item.title }), color: 'info' })
  }

  async function pasteInto (parent: ShellTreeItem) {
    const copied = clipboardStore.copied
    if (!copied) {
      return
    }
    await guard(async () => {
      const revision = await structureRevisionOf(parent)
      const names = (parent.children ?? []).filter(child => !child.more).map(child => child.title)
      const added = await structure.paste(parent.submodelKey, parent.elementKey, revision, copied.element, names, parent.modelType === 'SubmodelElementList')
      notifications.notify({ text: t('edit.pasted', { name: String(added.path) }), color: 'success' })
      opened.value = [...new Set([...opened.value, parent.id])]
      await afterStructureChange(parent.submodelKey)
      select(itemId(parent.submodelKey, added.key))
    })
  }

  async function duplicate (item: ShellTreeItem) {
    await guard(async () => {
      const parent = trees.parentOf(item.id)
      if (!parent) {
        return
      }
      const element = (await structure.read(item.submodelKey, item.elementKey!)).value as Record<string, unknown>
      const revision = await structureRevisionOf(parent)
      const names = (parent.children ?? []).filter(child => !child.more).map(child => child.title)
      const added = await structure.paste(item.submodelKey, parent.elementKey, revision, element, names, parent.modelType === 'SubmodelElementList')
      await afterStructureChange(item.submodelKey)
      select(itemId(item.submodelKey, added.key))
    })
  }

  const shareOpen = ref(false)
  const showIdentifiers = ref(false)
  const qrOpen = ref(false)
  const globalAssetId = computed(() => typeof shellJson.value.assetInformation?.globalAssetId === 'string' ? shellJson.value.assetInformation.globalAssetId as string : null)
  const qrPreview = computed(() => globalAssetId.value ? svgDataUrl(identificationLinkSvg(globalAssetId.value)) : '')
  const confirmDelete = ref(false)
  const alsoDeleteSubmodels = ref(false)
  const deleting = ref(false)
  const actionError = ref<unknown>(null)

  async function remove () {
    deleting.value = true
    actionError.value = null
    try {
      const result = await api<DeleteResult>(`/targets/${targetId.value}/shells/${shellKey.value}`, { method: 'DELETE', query: { deleteSubmodels: String(alsoDeleteSubmodels.value) } })
      confirmDelete.value = false
      const failed = result.sync.filter(step => step.outcome === 'failed').length
      notifications.notify(failed > 0
        ? { text: t('shell.deletedSyncFailed', { name: shellLabel.value, count: failed }), color: 'warning' }
        : { text: t('shell.deleted', { name: shellLabel.value }), color: 'success' })
      await invalidate(['targets', targetId.value, 'shells'], ['targets', targetId.value])
      await router.push(`/targets/${targetId.value}/shells`)
    } catch (error) {
      confirmDelete.value = false
      actionError.value = error
    } finally {
      deleting.value = false
    }
  }

  const authRequired = computed(() => [shell.error.value, refs.error.value]
    .some(error => error instanceof StudioApiError && error.code === 'target_auth_required'))

  async function onAuthorized () {
    await invalidate(['targets', targetId.value])
  }
</script>
