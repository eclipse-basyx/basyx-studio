<template>
  <v-dialog v-model="open" max-width="760" persistent>
    <DialogCard flush :title="title">
      <v-sheet color="transparent" height="360">
        <CodeView
          v-model="text"
          editable
          label="JSON"
          language="json"
          model-namespace="insert"
        />
      </v-sheet>

      <v-divider />

      <div class="pa-3">
        <v-alert v-if="findings.length > 0" density="compact" :title="t('editor.findings')" type="error">
          <ul class="ps-4 text-body-small">
            <li v-for="finding in findings.slice(0, 6)" :key="`${finding.path}:${finding.message}`">
              <span v-if="finding.path" class="font-weight-medium">{{ finding.path }}: </span>{{ finding.message }}
            </li>
          </ul>
        </v-alert>

        <v-alert v-else-if="checked" density="compact" :text="t('insert.valid')" type="success" />

        <ProblemAlert v-if="error" class="mt-2" :error="error" />
      </div>

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="close" />
        <v-btn-primary :disabled="!checked || findings.length > 0" :loading="busy" :text="t('insert.insert')" @click="insert" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ValidationResult } from '#shared/contract'

  // Insert from JSON (MVP-5 plan, C3): the code view checks the text with AAS
  // Core on the server while the user types; only valid JSON can be inserted.
  const props = defineProps<{
    targetId: string
    kind: 'element' | 'submodel' | 'conceptDescription'
    title: string
    /** Runs the write with the parsed JSON; rejects with the problem to show. */
    submit: (value: Record<string, unknown>) => Promise<void>
  }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()

  const text = ref('')
  const findings = ref<Array<{ path: string, message: string }>>([])
  const checked = ref(false)
  const busy = ref(false)
  const error = ref<unknown>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0

  function parse (): Record<string, unknown> | null {
    try {
      const value = JSON.parse(text.value) as unknown
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch {
      return null
    }
  }

  watch(text, () => {
    checked.value = false
    error.value = null
    clearTimeout(timer)
    const value = parse()
    if (value === null) {
      findings.value = text.value.trim() === '' ? [] : [{ path: '', message: t('insert.notJson') }]
      return
    }
    findings.value = []
    const current = ++sequence
    timer = setTimeout(async () => {
      try {
        const result = await api<ValidationResult>(`/targets/${props.targetId}/validations`, { method: 'POST', body: { kind: props.kind, value } })
        if (current === sequence) {
          findings.value = result.violations
          checked.value = true
        }
      } catch (error_) {
        error.value = error_
      }
    }, 350)
  })

  watch(open, value => {
    if (value) {
      text.value = ''
      findings.value = []
      checked.value = false
      error.value = null
    }
  })

  async function insert () {
    const value = parse()
    if (!value) {
      return
    }
    busy.value = true
    error.value = null
    try {
      await props.submit(value)
      close()
    } catch (error_) {
      error.value = error_
    } finally {
      busy.value = false
    }
  }

  function close () {
    clearTimeout(timer)
    open.value = false
  }
</script>
