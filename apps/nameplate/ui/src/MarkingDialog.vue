<template>
  <!-- In the frame Studio shows alone over its dimmed page (openFullscreen without
       header), so the dialog has the whole window; Studio dims, so it does not.
       The card as Studio's dialogs (DialogCard): the title in a tinted header,
       the body, and the actions, which close it. -->
  <v-dialog
    max-width="640"
    :model-value="true"
    :persistent="!entered"
    :scrim="false"
    scrollable
    @after-enter="entered = true"
    @update:model-value="emit('close')"
  >
    <v-card data-test="marking-dialog">
      <v-card-header class="flex-shrink-0">
        <v-card-title class="text-wrap text-break" data-test="marking-dialog-name">{{ name }}</v-card-title>
      </v-card-header>

      <v-divider />

      <v-card-text class="pa-4 d-flex flex-column ga-3">
        <div v-if="expired">
          <v-chip color="error" data-test="marking-dialog-expired" prepend-icon="mdi-alert-decagram-outline" :text="t('marking.expired')" />
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

        <!-- The image in Studio's file viewer, larger still. -->
        <v-card
          :aria-label="t('marking.preview', { name })"
          data-test="marking-dialog-image"
          :disabled="!marking.file"
          height="200"
          @click="marking.file && preview?.(marking.file)"
        >
          <PreviewImage
            :alt="name"
            :client="client"
            :file="marking.file"
            height="200"
            icon="mdi-check-decagram-outline"
            :submodel-id="submodelId"
            width="100%"
          />
        </v-card>

        <DetailList v-if="rows.length > 0" :rows="rows" />
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-spacer />

        <v-btn data-test="marking-dialog-close" :text="t('nameplate.close')" @click="emit('close')" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Marking } from './nameplate'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { computed, ref } from 'vue'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'
  import { markingExpired, markingName, markingRows } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // A marking's image, certificate, dates and notes; in edit mode each value
  // changes in place, as in the view.
  const props = defineProps<{ client: StudioClient, submodelId: string, marking: Marking, index: number, notice: { type: 'success' | 'error', text: string } | null }>()
  const emit = defineEmits<{ close: [], dismiss: [] }>()

  const { t, formatLocale } = useI18n()
  const { canEdit, preview } = useRowActions()
  /** A click while the dialog fades in is not taken for one outside it. */
  const entered = ref(false)

  const name = computed(() => markingName(t, props.marking, props.index, formatLocale.value))
  const expired = computed(() => markingExpired(props.marking, formatLocale.value))
  const rows = computed(() => markingRows(t, props.marking, formatLocale.value, canEdit.value))
</script>
