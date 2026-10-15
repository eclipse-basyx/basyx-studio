<template>
  <v-dialog v-model="open" max-width="520">
    <DialogCard :title="t('instance.title')">
      <p class="text-body-medium text-medium-emphasis mb-4">{{ t('instance.text', { name }) }}</p>

      <v-text-field v-model="idShort" class="mb-3" :label="t('details.idShort')" />
      <v-text-field v-model="globalAssetId" :hint="t('wizard.generatedHint')" :label="t('shell.globalAssetId')" persistent-hint />

      <ProblemAlert v-if="error" class="mt-3" :error="error" />

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="open = false" />
        <v-btn-primary :loading="busy" :text="t('instance.create')" @click="create" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ShellCreateResult } from '#shared/contract'

  // An instance from a type shell (MVP-5 plan, T4): a new shell with
  // `derivedFrom`, asset kind Instance and copies of the type's submodels.
  const props = defineProps<{ targetId: string, shellKey: string, name: string }>()
  const emit = defineEmits<{ created: [result: ShellCreateResult] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()
  const idShort = ref('')
  const globalAssetId = ref('')
  const busy = ref(false)
  const error = ref<unknown>(null)

  async function create () {
    busy.value = true
    error.value = null
    try {
      const result = await api<ShellCreateResult>(`/targets/${props.targetId}/shells/${props.shellKey}/instances`, {
        method: 'POST',
        body: {
          shell: {
            ...(idShort.value.trim() ? { idShort: idShort.value.trim() } : {}),
            ...(globalAssetId.value.trim() ? { assetInformation: { globalAssetId: globalAssetId.value.trim() } } : {}),
          },
        },
      })
      open.value = false
      emit('created', result)
    } catch (error_) {
      error.value = error_
    } finally {
      busy.value = false
    }
  }
</script>
