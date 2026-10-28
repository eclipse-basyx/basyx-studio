<template>
  <!-- In the frame Studio shows alone over its dimmed page (openFullscreen without
       header), so the dialog has the whole window; Studio dims, so it does not.
       The card as Studio's dialogs (DialogCard): the title in a tinted header,
       the body, and the actions, which close it. -->
  <v-dialog
    max-width="720"
    :model-value="true"
    :persistent="!entered"
    :scrim="false"
    scrollable
    @after-enter="entered = true"
    @update:model-value="emit('close')"
  >
    <v-card data-test="contact-dialog">
      <v-card-header class="flex-shrink-0">
        <v-card-title class="text-wrap text-break" data-test="contact-dialog-name">{{ heading.title }}</v-card-title>
      </v-card-header>

      <v-divider />

      <v-card-text class="pa-4 d-flex flex-column ga-3">
        <div v-if="heading.subtitle || (heading.role && !canEdit)" class="d-flex flex-wrap align-center ga-2">
          <span v-if="heading.subtitle" class="text-body-medium text-medium-emphasis">{{ heading.subtitle }}</span>
          <v-chip v-if="heading.role && !canEdit" prepend-icon="mdi-account-tie-outline" :text="heading.role" />
        </div>

        <v-alert
          v-if="notice"
          closable
          data-test="notice"
          density="compact"
          :text="notice.text"
          :type="notice.type"
          @click:close="emit('dismiss')"
        />

        <DetailList :rows="rows" />
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn-secondary
          v-if="!canEdit"
          data-test="save-vcard"
          prepend-icon="mdi-card-account-details-outline"
          :text="t('contact.save')"
          @click="emit('save')"
        />

        <v-spacer />

        <v-btn data-test="contact-dialog-close" :text="t('contacts.close')" @click="emit('close')" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ContactInformation } from '@basyx/studio-app-kit/contacts'
  import { contactRows } from '@basyx/studio-app-kit/contacts'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { computed, ref } from 'vue'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'
  import { contactHeading } from './presentation'

  // A contact's details: address with map, every channel and link, languages
  // and further details, and the vCard; in edit mode every element as a row.
  const props = defineProps<{ contact: ContactInformation, index: number, notice: { type: 'success' | 'error', text: string } | null }>()
  const emit = defineEmits<{ close: [], save: [], dismiss: [] }>()

  const { t, formatLocale } = useI18n()
  const { canEdit } = useRowActions()
  /** A click while the dialog fades in is not taken for one outside it. */
  const entered = ref(false)

  const heading = computed(() => contactHeading(t, props.contact, props.index, formatLocale.value))
  /** In view mode without what the heading shows. */
  const rows = computed(() => contactRows(props.contact, formatLocale.value, { edit: canEdit.value })
    .filter(row => canEdit.value || !['role', 'company', 'department'].includes(row.key)))
</script>
