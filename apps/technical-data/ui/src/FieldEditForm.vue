<template>
  <!-- Edited in place: a dialog would not fit a frame sized to its content.
       No form: app frames may not submit forms (sandbox without allow-forms). -->
  <div v-if="draft" data-test="edit-field">
    <div v-if="draft.field.modelType === 'Range'" class="d-flex flex-wrap ga-2">
      <v-text-field
        v-model="draft.value"
        autofocus
        data-test="edit-min"
        :label="t('edit.min')"
        @keydown.enter="editor.save"
        @keydown.esc="editor.cancel"
      />

      <v-text-field
        v-model="draft.max"
        data-test="edit-max"
        :label="t('edit.max')"
        @keydown.enter="editor.save"
        @keydown.esc="editor.cancel"
      />
    </div>

    <v-text-field
      v-else
      v-model="draft.value"
      autofocus
      :hint="draft.language ? t('edit.language', { language: draft.language }) : undefined"
      :label="draft.label"
      :persistent-hint="Boolean(draft.language)"
      @keydown.enter="editor.save"
      @keydown.esc="editor.cancel"
    />

    <v-alert
      v-if="draft.error"
      class="mt-2"
      data-test="edit-error"
      density="compact"
      :text="draft.error"
      type="warning"
    />

    <div class="d-flex justify-end ga-2 mt-2">
      <v-btn :text="t('edit.cancel')" @click="editor.cancel" />
      <v-btn-primary data-test="edit-save" :loading="editor.saving.value" :text="t('edit.save')" @click="editor.save" />
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { useI18n } from './i18n'

  // The value being changed, in place of its row's value: a text, or a
  // Range's lower and upper bound; Enter saves, Escape cancels.
  const { t } = useI18n()
  const { editor } = useRowActions()
  const draft = editor.draft
</script>
