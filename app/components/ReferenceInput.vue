<template>
  <div class="d-flex flex-column ga-3">
    <div v-if="label" class="d-flex align-center">
      <span class="text-body-medium">{{ label }}</span>
      <v-spacer />

      <v-btn
        v-if="clipboardReference"
        class="mt-2"
        prepend-icon="mdi-content-paste"
        size="small"
        :text="t('editor.pasteReference')"
        @click="model = clipboardReference"
      />
    </div>

    <!-- The common case: one global reference, one field. -->
    <v-text-field
      v-if="simple"
      :error-messages="errorMessages"
      :label="placeholder ?? t('editor.referenceValue')"
      :model-value="reference?.keys[0]?.value ?? ''"
      @update:model-value="setSimple"
    >
      <template #append-inner>
        <v-btn
          v-tooltip="t('editor.referenceAdvanced')"
          :aria-label="t('editor.referenceAdvanced')"
          density="comfortable"
          icon="mdi-tune-variant"
          size="small"
          @click="advanced = true"
        />
      </template>
    </v-text-field>

    <template v-else>
      <div class="d-flex ga-3">
        <v-select
          :items="referenceTypes"
          :label="t('editor.referenceType')"
          :model-value="reference?.type ?? 'ExternalReference'"
          @update:model-value="type => update({ type, keys: reference?.keys ?? [blankKey()] })"
        />

        <v-btn
          v-if="!required"
          v-tooltip="t('editor.clear')"
          :aria-label="t('editor.clear')"
          class="mt-2"
          icon="mdi-close"
          size="small"
          @click="clear"
        />
      </div>

      <div v-for="(key, index) in reference?.keys ?? []" :key="index" class="d-flex align-start ga-3">
        <v-select
          class="flex-grow-0"
          :items="keyTypes"
          :label="t('editor.keyType')"
          :model-value="key.type"
          width="200"
          @update:model-value="type => updateKey(index, { type })"
        />

        <v-text-field
          class="flex-grow-1"
          :error-messages="index === 0 ? errorMessages : undefined"
          :label="t('editor.keyValue')"
          :model-value="key.value"
          @update:model-value="value => updateKey(index, { value })"
        />

        <v-btn
          v-if="(reference?.keys.length ?? 0) > 1"
          :aria-label="t('editor.remove')"
          class="mt-2"
          icon="mdi-close"
          size="small"
          @click="update({ ...reference!, keys: reference!.keys.filter((_, position) => position !== index) })"
        />
      </div>

      <v-btn
        class="align-self-start"
        prepend-icon="mdi-plus"
        size="small"
        :text="t('editor.addKey')"
        @click="update({ type: reference?.type ?? 'ExternalReference', keys: [...(reference?.keys ?? []), blankKey()] })"
      />
    </template>
  </div>
</template>

<script lang="ts" setup>
  import { keyTypes, referenceTypes } from '~/utils/editor'

  interface Reference {
    type: string
    keys: Array<{ type: string, value: string }>
  }

  // A reference: one field for a global reference, and the type and keys for
  // everything else (the Web UI's reference input, with the common case
  // first). Used for semantic IDs, reference elements, relationships and
  // every other reference field.
  const props = defineProps<{
    label?: string
    placeholder?: string
    required?: boolean
    errorMessages?: string[]
  }>()
  const model = defineModel<unknown>({ required: true })

  const { t } = useI18n()
  const clipboard = useClipboardStore()

  const blankKey = () => ({ type: 'GlobalReference', value: '' })

  const reference = computed<Reference | null>(() => {
    const value = model.value as Partial<Reference> | null | undefined
    return value && Array.isArray(value.keys)
      ? { type: String(value.type ?? 'ExternalReference'), keys: value.keys.map(key => ({ type: String(key.type), value: String(key.value ?? '') })) }
      : null
  })

  // Several keys or another kind of reference need the full editor.
  const advanced = ref(false)
  const simple = computed(() => !advanced.value
    && (reference.value === null
      || (reference.value.type === 'ExternalReference' && reference.value.keys.length === 1 && reference.value.keys[0]!.type === 'GlobalReference')))

  const clipboardReference = computed(() => clipboard.copiedReference ?? null)

  function update (next: Reference) {
    model.value = next
  }

  function clear () {
    model.value = null
    advanced.value = false
  }

  function setSimple (value: string) {
    model.value = value === '' && !props.required ? null : { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] }
  }

  function updateKey (index: number, patch: Partial<Reference['keys'][number]>) {
    update({ type: reference.value?.type ?? 'ExternalReference', keys: (reference.value?.keys ?? []).map((key, position) => position === index ? { ...key, ...patch } : key) })
  }
</script>
