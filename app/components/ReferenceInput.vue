<template>
  <div class="d-flex flex-column ga-3">
    <!-- The label and the reference's actions, in the same place whether
         the type and keys are shown or not. -->
    <div class="d-flex align-center ga-1">
      <span v-if="label" class="text-body-medium">{{ label }}</span>
      <v-spacer />

      <v-btn
        v-if="clipboardReference"
        v-tooltip="t('editor.pasteReference')"
        :aria-label="t('editor.pasteReference')"
        icon="mdi-content-paste"
        size="small"
        @click="paste"
      />

      <v-btn
        :append-icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        :aria-expanded="expanded"
        size="small"
        :text="t('editor.referenceKeys')"
        @click="expanded = !expanded"
      />

      <v-btn
        v-if="removable || (!required && reference !== null)"
        v-tooltip="t('editor.removeReference')"
        :aria-label="t('editor.removeReference')"
        icon="mdi-delete-outline"
        size="small"
        @click="clear"
      />
    </div>

    <template v-if="!expanded">
      <!-- The common case: one global reference, one field. -->
      <v-text-field
        v-if="simple"
        :error-messages="errorMessages"
        :label="placeholder ?? t('editor.referenceValue')"
        :model-value="reference?.keys[0]?.value ?? ''"
        @update:model-value="setSimple"
      />

      <!-- Anything else reads as its path of keys; editing it opens the keys. -->
      <v-text-field
        v-else
        :error-messages="errorMessages"
        :label="reference!.type"
        :model-value="reference!.keys.map(key => key.value).join(' › ')"
        readonly
        @click="expanded = true"
      />
    </template>

    <template v-else>
      <v-btn-toggle
        :aria-label="t('editor.referenceType')"
        class="align-self-start"
        mandatory
        :model-value="reference?.type ?? 'ExternalReference'"
        @update:model-value="type => update({ type, keys: reference?.keys ?? [blankKey()] })"
      >
        <v-btn v-for="type in referenceTypes" :key="type" :text="type" :value="type" />
      </v-btn-toggle>

      <div v-for="(key, index) in keys" :key="index" class="d-flex align-start ga-3">
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
        >
          <!-- Inside the field, as Vuetify's clear icon, so it lines up at any density. -->
          <template v-if="keys.length > 1" #append-inner>
            <v-icon
              v-tooltip="t('editor.removeKey')"
              :aria-label="t('editor.removeKey')"
              icon="mdi-close"
              @click="removeKey(index)"
              @keydown.enter.space.prevent="removeKey(index)"
            />
          </template>
        </v-text-field>
      </div>

      <v-btn
        class="align-self-start"
        prepend-icon="mdi-plus"
        size="small"
        :text="t('editor.addKey')"
        @click="update({ type: reference?.type ?? 'ExternalReference', keys: [...keys, blankKey()] })"
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

  // A reference: one field for a global reference, its type and keys behind
  // a toggle that opens and closes in place (the Web UI's reference input,
  // with the common case first). Used for semantic IDs, reference elements,
  // relationships and every other reference field.
  const props = defineProps<{
    label?: string
    placeholder?: string
    required?: boolean
    /** An entry of a list (supplemental semantic IDs, …): removing sets it to `null`, which the list drops. */
    removable?: boolean
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
  const keys = computed(() => reference.value?.keys ?? [blankKey()])

  /** One global reference fits one field; several keys or another kind need the keys. */
  function isSimple (value: Reference | null): boolean {
    return value === null || (value.type === 'ExternalReference' && value.keys.length === 1 && value.keys[0]!.type === 'GlobalReference')
  }
  const simple = computed(() => isSimple(reference.value))
  const expanded = ref(!isSimple(reference.value))

  const clipboardReference = computed(() => clipboard.copiedReference ?? null)

  function update (next: Reference) {
    model.value = next
  }

  function paste () {
    model.value = clipboardReference.value
    expanded.value = !isSimple(reference.value)
  }

  function clear () {
    model.value = null
    expanded.value = false
  }

  function setSimple (value: string) {
    model.value = value === '' && !props.required ? null : { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] }
  }

  function updateKey (index: number, patch: Partial<Reference['keys'][number]>) {
    update({ type: reference.value?.type ?? 'ExternalReference', keys: keys.value.map((key, position) => position === index ? { ...key, ...patch } : key) })
  }

  function removeKey (index: number) {
    update({ type: reference.value?.type ?? 'ExternalReference', keys: keys.value.filter((_, position) => position !== index) })
  }
</script>
