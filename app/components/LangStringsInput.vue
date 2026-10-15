<template>
  <div class="d-flex flex-column ga-3">
    <div v-if="label" class="text-body-medium">{{ label }}</div>

    <div v-for="(entry, index) in strings" :key="index" class="d-flex align-start ga-3">
      <v-combobox
        class="flex-grow-0"
        hide-no-data
        item-title="code"
        item-value="code"
        :items="languageItems"
        :label="t('editor.language')"
        :model-value="entry.language"
        :return-object="false"
        width="132"
        @update:model-value="code => change(index, { language: String(code ?? '') })"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :subtitle="item.name" :title="item.code" />
        </template>
      </v-combobox>

      <v-textarea
        auto-grow
        class="flex-grow-1"
        :label="t('editor.text')"
        :model-value="entry.text"
        rows="1"
        @update:model-value="text => change(index, { text })"
      />

      <v-btn
        v-tooltip="t('editor.remove')"
        :aria-label="t('editor.remove')"
        class="mt-2"
        icon="mdi-close"
        size="small"
        @click="strings = strings.filter((_, position) => position !== index)"
      />
    </div>

    <v-btn
      class="align-self-start"
      prepend-icon="mdi-plus"
      size="small"
      :text="strings.length === 0 ? t('editor.addText') : t('editor.addTranslation')"
      @click="add"
    />

    <div v-for="message in errorMessages ?? []" :key="message" class="text-body-small text-error">{{ message }}</div>
    <div v-if="hint && !errorMessages?.length" class="text-body-small text-medium-emphasis">{{ hint }}</div>
  </div>
</template>

<script lang="ts" setup>
  import type { LangString } from '#shared/contract'
  import { languages } from '~/utils/languages'

  // Language strings (display names, descriptions, multi-language values),
  // oriented at the BaSyx Web UI: a language per line with a searchable list,
  // a growing text field and a remove button. A new line gets the first
  // language that is not used yet, so the common case needs no typing.
  defineProps<{ label?: string, hint?: string, errorMessages?: string[] }>()
  const strings = defineModel<LangString[]>({ required: true })

  const { t } = useI18n()
  const languageItems = languages

  function add () {
    const used = new Set(strings.value.map(entry => entry.language))
    const next = languages.find(language => !used.has(language.code))?.code ?? ''
    strings.value = [...strings.value, { language: next, text: '' }]
  }

  function change (index: number, patch: Partial<LangString>) {
    strings.value = strings.value.map((entry, position) => position === index ? { ...entry, ...patch } : entry)
  }
</script>
