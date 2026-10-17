<template>
  <v-dialog v-model="open" max-width="520">
    <DialogCard :title="t('upload.title')">
      <p class="text-body-medium text-medium-emphasis mt-0 mb-3">{{ t('upload.into', { name: target.name }) }}</p>

      <v-file-upload
        v-model="file"
        accept=".aasx,.json,.xml"
        :browse-text="t('upload.browse')"
        clearable
        density="comfortable"
        :divider-text="t('upload.or')"
        :title="t('upload.drop')"
      />

      <div class="text-body-small text-medium-emphasis mt-2">{{ t('upload.hint') }}</div>
      <ProblemAlert v-if="error" class="mt-4" :error="error" />
      <v-alert v-if="added" class="mt-4" :text="t('upload.added', added.length)" type="success" />

      <!-- The imported shells, one click away. -->
      <v-list v-if="added && added.length > 0" class="mt-2" nav>
        <v-list-item
          v-for="shell in added"
          :key="shell.key"
          prepend-icon="$aas"
          :subtitle="shell.id"
          :title="langText(shell.displayName) ?? shell.idShort ?? shell.id"
          :to="`/targets/${target.id}/shells/${shell.key}`"
          @click="open = false"
        />
      </v-list>

      <SyncReport class="mt-4" :steps="syncSteps" />

      <template #actions>
        <v-btn :text="t('common.close')" @click="open = false" />
        <v-btn-primary :disabled="!file" :loading="uploading" :text="t('upload.upload')" @click="upload" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ShellSummary, SyncStep, Target, UploadResult } from '#shared/contract'
  import { langText } from '~/utils/aas'

  const props = defineProps<{ target: Target, initialFile?: File | null }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()
  const router = useRouter()
  const invalidate = useInvalidate()
  const notifications = useNotificationsStore()

  const file = shallowRef<File | File[] | undefined>()
  const uploading = ref(false)
  const error = ref<unknown>(null)
  const added = ref<ShellSummary[] | null>(null)
  const syncSteps = ref<SyncStep[]>([])

  watch(open, isOpen => {
    if (isOpen) {
      file.value = props.initialFile ?? undefined
      error.value = null
      added.value = null
      syncSteps.value = []
    }
  }, { immediate: true })

  async function upload () {
    const chosen = Array.isArray(file.value) ? file.value[0] : file.value
    if (!chosen) {
      return
    }
    uploading.value = true
    error.value = null
    try {
      const result = await api<UploadResult>(`/targets/${props.target.id}/uploads`, {
        method: 'POST',
        query: { fileName: chosen.name },
        headers: { 'Content-Type': chosen.type || 'application/octet-stream' },
        body: chosen,
      })
      added.value = result.shells
      syncSteps.value = result.sync
      file.value = undefined
      await invalidate(['targets', props.target.id, 'shells'])
      // A single shell opens right away; several, or sync failures, stay in the dialog.
      const [only] = result.shells
      if (only && result.shells.length === 1 && result.sync.every(step => step.outcome !== 'failed')) {
        open.value = false
        notifications.notify({ text: t('upload.imported', { name: langText(only.displayName) ?? only.idShort ?? only.id }), color: 'success' })
        await router.push(`/targets/${props.target.id}/shells/${only.key}`)
      }
    } catch (error_) {
      error.value = error_
    } finally {
      uploading.value = false
    }
  }
</script>
