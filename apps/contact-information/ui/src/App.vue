<template>
  <v-app>
    <!-- Studio's card shows the view's title. The BaSyx AAS Web UI's
         ContactInformations plugin as compact cards, side by side where the
         frame is wide, with a search where there are many; a card opens the
         contact's details. -->
    <v-view-card>
      <v-progress-linear v-if="loading" />

      <!-- The frame Studio shows alone over its page has no close button of Studio's:
           where the details cannot be shown, a dialog with the reason closes it. -->
      <v-dialog
        v-else-if="dialogPath && (error || !dialogContact)"
        max-width="480"
        :model-value="true"
        :scrim="false"
        @update:model-value="closeDialog"
      >
        <v-card data-test="dialog-unavailable">
          <v-card-header class="flex-shrink-0">
            <v-card-title>{{ t('contacts.unavailable') }}</v-card-title>
          </v-card-header>

          <v-divider />

          <v-card-text class="pa-4">
            <v-alert :text="error ?? t('contacts.missing')" type="error" />
          </v-card-text>

          <v-divider />

          <v-card-actions>
            <v-spacer />

            <v-btn data-test="dialog-unavailable-close" :text="t('contacts.close')" @click="closeDialog" />
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <v-card-text v-else-if="contacts.length === 0" class="text-medium-emphasis" data-test="no-contacts">{{ t('contacts.none') }}</v-card-text>

      <!-- A contact's details, in the frame Studio shows alone over its page (openContact). -->
      <ContactDialog
        v-else-if="dialogContact"
        :contact="dialogContact"
        :index="contacts.indexOf(dialogContact)"
        :notice="notice"
        @close="closeDialog"
        @dismiss="notice = null"
        @save="saveVCard(dialogContact)"
      />

      <div v-else class="pa-4 d-flex flex-column ga-3">
        <v-alert
          v-if="notice"
          closable
          data-test="notice"
          density="compact"
          :text="notice.text"
          :type="notice.type"
          @click:close="notice = null"
        />

        <div v-if="searchable || ownFullscreen" class="d-flex align-center ga-2">
          <v-text-field
            v-if="searchable"
            :aria-label="t('contacts.search')"
            clearable
            data-test="contact-search"
            density="compact"
            :model-value="query"
            :placeholder="t('contacts.search')"
            prepend-inner-icon="mdi-magnify"
            @update:model-value="value => (query = value ?? '')"
          />

          <v-spacer v-else />

          <!-- Where Studio shows no full-screen button of its own (details pane, another app's page). -->
          <v-btn
            v-if="ownFullscreen"
            :aria-label="t('contacts.fullscreen')"
            data-test="contacts-fullscreen"
            icon
            size="small"
            @click="openFullscreen"
          >
            <v-icon icon="mdi-fullscreen" />
            <v-tooltip activator="parent" location="bottom" :text="t('contacts.fullscreen')" />
          </v-btn>
        </div>

        <div v-if="filtered.length < contacts.length" class="text-body-small text-medium-emphasis" data-test="contact-count">
          {{ t('contacts.filtered', { count: filtered.length, total: contacts.length }) }}
        </div>

        <div v-if="filtered.length === 0" class="text-body-medium text-medium-emphasis" data-test="no-match">{{ t('contacts.noMatch') }}</div>

        <v-row dense>
          <v-col
            v-for="entry in filtered"
            :key="entry.contact.path"
            cols="12"
            lg="3"
            md="4"
            sm="6"
          >
            <ContactCard :contact="entry.contact" :index="entry.index" @open="openContact(entry.contact)" />
          </v-col>
        </v-row>
      </div>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { ContactInformation } from '@basyx/studio-app-kit/contacts'
  import type { AppContext, StudioClient } from '@basyx/studio-sdk'
  import { loadSubmodel } from '@basyx/studio-app-kit'
  import { contactMatches, contactVCard, parseContactInformations, vCardFileName } from '@basyx/studio-app-kit/contacts'
  import { provideRowActions, useFieldEditor } from '@basyx/studio-app-kit/editing'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref, shallowRef, watch } from 'vue'
  import ContactCard from './ContactCard.vue'
  import ContactDialog from './ContactDialog.vue'
  import { provideI18n } from './i18n'

  // The contacts of an asset (IDTA 02002 Contact Information 1.0). In
  // Studio's edit mode, their values can be changed where the target and
  // the user's rights allow it.
  const props = defineProps<{ client: StudioClient }>()

  const { t, formatLocale } = provideI18n(props.client)

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
  const contacts = shallowRef<ContactInformation[]>([])
  const query = ref('')

  /** A search for more than a few contacts. */
  const searchable = computed(() => contacts.value.length > 3)
  const filtered = computed(() => contacts.value
    .map((contact, index) => ({ contact, index }))
    .filter(entry => contactMatches(entry.contact, query.value, formatLocale.value)))

  function fail (error_: unknown) {
    notice.value = { type: 'error', text: error_ instanceof StudioError ? error_.message : String(error_) }
  }

  async function load () {
    try {
      contacts.value = parseContactInformations(await loadSubmodel(props.client))
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
  })

  /** The contact as vCard; Studio saves the file. */
  function saveVCard (contact: ContactInformation) {
    void props.client.ui.saveFile(vCardFileName(contact, formatLocale.value), contactVCard(contact, formatLocale.value), 'text/vcard').catch(fail)
  }

  // Full screen opens with the same search (`context.viewState`): Studio's
  // button with the reported state, the app's own where Studio has none.
  const viewState = computed(() => JSON.stringify({ query: query.value }))
  watch(viewState, state => void props.client.ui.setViewState(state))

  function openFullscreen () {
    void props.client.ui.openFullscreen(viewState.value)
  }

  /** The contact whose details this frame shows as a dialog; `null` for the view. */
  const dialogPath = ref<string | null>(null)
  const dialogContact = computed(() => contacts.value.find(contact => contact.path === dialogPath.value) ?? null)

  /**
   * A contact's details in a dialog: the view again, alone over Studio's
   * dimmed page (openFullscreen without header), so the dialog has the
   * window wherever the view is, also in a short Overview card.
   */
  function openContact (contact: ContactInformation) {
    void props.client.ui.openFullscreen(JSON.stringify({ contact: contact.path }), { header: false })
  }

  function closeDialog () {
    void props.client.ui.closeFullscreen()
  }

  function restore (state: string) {
    try {
      const parsed = JSON.parse(state) as { query?: unknown, contact?: unknown }
      query.value = typeof parsed.query === 'string' ? parsed.query : ''
      dialogPath.value = context.value.fullscreen && typeof parsed.contact === 'string' ? parsed.contact : null
    } catch {
      // Not ours, or empty: the view, without search.
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
