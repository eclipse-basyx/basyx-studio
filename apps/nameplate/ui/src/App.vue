<template>
  <v-app>
    <!-- Studio's card shows the view's title. Layout of the BaSyx AAS Web UI's
         Nameplate plugins in the frame of the Documents app: the product at a
         glance, then cards for the product's facts and the manufacturer (side
         by side in a wide frame), the markings, which open their details, and
         the asset specific properties, collapsed. -->
    <v-view-card>
      <v-progress-linear v-if="loading" />

      <!-- The frame Studio shows alone over its page has no close button of Studio's:
           where the details cannot be shown, a dialog with the reason closes it. -->
      <v-dialog
        v-else-if="dialogPath && (error || !dialogMarking)"
        max-width="480"
        :model-value="true"
        :scrim="false"
        @update:model-value="closeDialog"
      >
        <v-card data-test="dialog-unavailable">
          <v-card-header class="flex-shrink-0">
            <v-card-title>{{ t('marking.unavailable') }}</v-card-title>
          </v-card-header>

          <v-divider />

          <v-card-text class="pa-4">
            <v-alert :text="error ?? t('marking.missing')" type="error" />
          </v-card-text>

          <v-divider />

          <v-card-actions>
            <v-spacer />

            <v-btn data-test="dialog-unavailable-close" :text="t('nameplate.close')" @click="closeDialog" />
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <!-- A marking's details, in the frame Studio shows alone over its page (openMarking). -->
      <MarkingDialog
        v-else-if="nameplate && dialogMarking"
        :client="client"
        :index="nameplate.markings.indexOf(dialogMarking)"
        :marking="dialogMarking"
        :notice="notice"
        :submodel-id="submodelId"
        @close="closeDialog"
        @dismiss="notice = null"
      />

      <div v-else-if="nameplate" class="pa-4 d-flex flex-column ga-4">
        <v-alert
          v-if="notice"
          closable
          data-test="notice"
          density="compact"
          :text="notice.text"
          :type="notice.type"
          @click:close="notice = null"
        />

        <NameplateHeader :client="client" :nameplate="nameplate" :submodel-id="submodelId" @open="openMarking">
          <!-- Where Studio shows no full-screen button of its own (details pane, another app's page). -->
          <v-btn
            v-if="ownFullscreen"
            :aria-label="t('nameplate.fullscreen')"
            data-test="nameplate-fullscreen"
            icon
            size="small"
            @click="openFullscreen"
          >
            <v-icon icon="mdi-fullscreen" />
            <v-tooltip activator="parent" location="bottom" :text="t('nameplate.fullscreen')" />
          </v-btn>
        </NameplateHeader>

        <!-- The product and the manufacturer as cards with Studio's tinted headers, as tall as each other. -->
        <v-row dense>
          <v-col v-if="product.length > 0" cols="12" md="6">
            <SectionCard data-test="product" icon="mdi-package-variant-closed" :title="t('sections.product')">
              <DetailList :rows="product" />
            </SectionCard>
          </v-col>

          <v-col v-if="manufacturer.length > 0" cols="12" md="6">
            <SectionCard data-test="manufacturer" icon="mdi-factory" :title="t('sections.manufacturer')">
              <template v-if="nameplate.contact && !canEdit" #actions>
                <v-btn
                  data-test="save-vcard"
                  prepend-icon="mdi-card-account-details-outline"
                  size="small"
                  :text="t('contact.save')"
                  @click="saveVCard"
                />
              </template>

              <DetailList :rows="manufacturer" />
            </SectionCard>
          </v-col>

        </v-row>

        <!-- The markings' cards are bordered themselves. -->
        <section v-if="nameplate.markings.length > 0" data-test="markings">
          <SectionHeading icon="mdi-check-decagram-outline" :title="t('sections.markings')" />
          <MarkingList :client="client" :markings="nameplate.markings" :submodel-id="submodelId" @open="openMarking" />
        </section>

        <AssetProperties v-if="groups.length > 0" v-model:open="propertiesOpen" :groups="groups" />
      </div>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { Marking, Nameplate } from './nameplate'
  import type { FileRef } from '@basyx/studio-app-kit/aas'
  import type { AppContext, StudioClient } from '@basyx/studio-sdk'
  import { provideFileViewer } from '@basyx/file-viewer/vue'
  import { fieldText, loadSubmodel } from '@basyx/studio-app-kit'
  import { contactVCard, vCardFileName } from '@basyx/studio-app-kit/contacts'
  import { provideRowActions, useFieldEditor } from '@basyx/studio-app-kit/editing'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref, shallowRef, watch } from 'vue'
  import AssetProperties from './AssetProperties.vue'
  import DetailList from './DetailList.vue'
  import { provideI18n } from './i18n'
  import MarkingDialog from './MarkingDialog.vue'
  import MarkingList from './MarkingList.vue'
  import { parseNameplate } from './nameplate'
  import NameplateHeader from './NameplateHeader.vue'
  import { manufacturerRows, productRows, propertyGroups } from './presentation'
  import SectionCard from './SectionCard.vue'
  import SectionHeading from './SectionHeading.vue'

  // The Digital Nameplate of an asset (IDTA 02006 3.0 and 2.0, ZVEI 1.0). In
  // Studio's edit mode, its values can be changed where the target and the
  // user's rights allow it.
  const props = defineProps<{ client: StudioClient }>()

  const { t, locale, formatLocale } = provideI18n(props.client)
  provideFileViewer({ locale: () => locale.value })

  const context = ref<AppContext>(props.client.context)
  props.client.onContext(value => {
    context.value = value
  })
  const submodelId = computed(() => context.value.submodel!.id)
  const ownFullscreen = computed(() => !context.value.fullscreen && !context.value.fullscreenControl)
  const canEdit = computed(() => (context.value.target?.write ?? false) && context.value.mode === 'edit' && !context.value.embedded)

  const loading = ref(true)
  const error = ref<string | null>(null)
  const notice = ref<{ type: 'success' | 'error', text: string } | null>(null)
  const nameplate = shallowRef<Nameplate | null>(null)
  const propertiesOpen = ref(false)

  const product = computed(() => (nameplate.value ? productRows(t, nameplate.value, formatLocale.value, canEdit.value) : []))
  const manufacturer = computed(() => (nameplate.value ? manufacturerRows(t, nameplate.value, formatLocale.value, canEdit.value) : []))
  const groups = computed(() => (nameplate.value ? propertyGroups(t, nameplate.value.assetSpecificProperties, formatLocale.value, canEdit.value) : []))

  function fail (error_: unknown) {
    notice.value = { type: 'error', text: error_ instanceof StudioError ? error_.message : String(error_) }
  }

  async function load () {
    try {
      nameplate.value = parseNameplate(await loadSubmodel(props.client))
      error.value = null
    } catch (error_) {
      error.value = error_ instanceof StudioError ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  const editor = useFieldEditor({
    client: props.client,
    t,
    locale: () => formatLocale.value,
    submodelId: () => submodelId.value,
    onSaved: async label => {
      notice.value = { type: 'success', text: t('edit.saved', { label }) }
      await props.client.ui.notify(t('edit.saved', { label }), 'success')
      await load()
    },
  })
  watch(editor.error, value => {
    if (value) {
      notice.value = { type: 'error', text: value }
    }
  })
  watch(canEdit, value => {
    if (!value) {
      editor.cancel()
    }
  })

  provideRowActions({
    canEdit,
    editor,
    // The frame opens no windows: Studio opens https in the browser, mailto: and tel: in the mail or phone app.
    open: url => void props.client.ui.openExternal(url).catch(fail),
    copy: text => void props.client.ui.copyText(text).then(() => props.client.ui.notify(t('contact.copied'), 'success')).catch(fail),
    preview: (file: FileRef) => void props.client.ui.previewFile(submodelId.value, file.path).catch(fail),
  })

  /** The manufacturer's contact as vCard, with the manufacturer as organization; Studio saves the file. */
  function saveVCard () {
    const value = nameplate.value
    if (!value?.contact) {
      return
    }
    const organization = fieldText(value.fields.manufacturerName, formatLocale.value)
    void props.client.ui.saveFile(vCardFileName(value.contact, formatLocale.value, organization || 'manufacturer'), contactVCard(value.contact, formatLocale.value, { organization }), 'text/vcard').catch(fail)
  }

  // Full screen opens with the asset specific properties as they are (`context.viewState`):
  // Studio's button with the reported state, the app's own where Studio has none.
  const viewState = computed(() => JSON.stringify({ properties: propertiesOpen.value }))
  watch(viewState, state => void props.client.ui.setViewState(state))

  function openFullscreen () {
    void props.client.ui.openFullscreen(viewState.value)
  }

  /** The marking whose details this frame shows as a dialog; `null` for the view. */
  const dialogPath = ref<string | null>(null)
  const dialogMarking = computed(() => nameplate.value?.markings.find(marking => marking.path === dialogPath.value) ?? null)

  /**
   * A marking's details in a dialog: the view again, alone over Studio's
   * dimmed page (openFullscreen without header), so the dialog has the
   * window wherever the view is, also in a short Overview card.
   */
  function openMarking (marking: Marking) {
    void props.client.ui.openFullscreen(JSON.stringify({ marking: marking.path }), { header: false })
  }

  function closeDialog () {
    void props.client.ui.closeFullscreen()
  }

  function restore (state: string) {
    try {
      const parsed = JSON.parse(state) as { properties?: unknown, marking?: unknown }
      propertiesOpen.value = parsed.properties === true
      dialogPath.value = context.value.fullscreen && typeof parsed.marking === 'string' ? parsed.marking : null
    } catch {
      // Not ours, or empty: the view, collapsed.
    }
  }

  // A full-screen dialog may have changed values: read them again when it closes.
  watch(() => context.value.fullscreenOpen, (open, before) => {
    if (before && !open) {
      void load()
    }
  })

  onMounted(async () => {
    restore(context.value.viewState ?? '')
    await load()
  })
</script>
