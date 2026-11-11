<template>
  <div class="d-flex flex-column h-100">
    <v-toolbar v-if="!hideToolbar" class="flex-shrink-0">
      <v-toolbar-title class="text-body-medium text-medium-emphasis">{{ label }}</v-toolbar-title>

      <template #append>
        <v-btn
          v-tooltip="t('code.find')"
          :aria-label="t('code.find')"
          :disabled="!ready"
          icon="mdi-magnify"
          size="small"
          @click="find"
        />

        <v-btn
          v-tooltip="wrap ? t('code.noWrap') : t('code.wrap')"
          :aria-label="wrap ? t('code.noWrap') : t('code.wrap')"
          :icon="wrap ? 'mdi-wrap-disabled' : 'mdi-wrap'"
          size="small"
          @click="wrap = !wrap"
        />

        <v-btn
          v-if="fileName"
          v-tooltip="t('details.download')"
          :aria-label="t('details.download')"
          icon="mdi-download"
          size="small"
          @click="download"
        />

        <v-btn
          v-tooltip="t('common.copy')"
          :aria-label="t('common.copy')"
          :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          size="small"
          @click="copy"
        />
      </template>
    </v-toolbar>

    <v-divider v-if="!hideToolbar" />

    <v-progress-linear v-if="!ready && !loadError" class="flex-shrink-0" />

    <v-alert
      v-if="loadError"
      class="ma-4"
      :text="loadError"
      :title="t('code.loadFailed')"
      type="error"
    />

    <!-- Monaco needs a sized host; it lays itself out when the host changes. -->
    <v-sheet class="flex-grow-1 overflow-hidden" color="transparent" :height="height ?? 0" :min-height="height ? undefined : 120">
      <div ref="host" class="h-100" />
    </v-sheet>
  </div>
</template>

<script lang="ts" setup>
  import type { TextLanguage } from '@basyx/file-viewer'
  import type { editor } from 'monaco-editor'
  import type * as Monaco from '~/utils/monaco'
  import type { CodeSchema } from '~/utils/monaco'
  import { useTheme } from 'vuetify'

  // A code view with Monaco, as in the BaSyx AAS Web UI: syntax colours,
  // folding and find (⌘F / Ctrl+F). Read-only unless `editable`; editable JSON
  // is checked against `schemas`.
  const props = defineProps<{
    label: string
    language: TextLanguage
    editable?: boolean
    hideToolbar?: boolean
    fileName?: string
    /** A fixed height; without it, the view fills its flex parent. */
    height?: number | string
    schemas?: CodeSchema[]
    /** Groups the editor's models, so schemas can match them (`fileMatch`). */
    modelNamespace?: string
  }>()
  const text = defineModel<string>({ required: true })

  const { t } = useI18n()
  const theme = useTheme()
  const host = useTemplateRef<HTMLDivElement>('host')

  const ready = ref(false)
  const loadError = ref<string | null>(null)
  const wrap = ref(true)
  const copied = ref(false)
  let instance: editor.IStandaloneCodeEditor | undefined
  let model: editor.ITextModel | undefined
  let runtime: typeof Monaco | undefined
  let applying = false
  let disposed = false

  const options = computed<editor.IStandaloneEditorConstructionOptions>(() => ({
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    folding: true,
    tabSize: 2,
    fontSize: 13,
    wordWrap: wrap.value ? 'on' : 'off',
    readOnly: !props.editable,
    domReadOnly: !props.editable,
    renderValidationDecorations: props.editable ? 'on' : 'off',
    ariaLabel: props.label,
    theme: theme.current.value.dark ? 'vs-dark' : 'vs',
  }))

  watch(options, value => instance?.updateOptions(value))
  watch(() => theme.current.value.dark, dark => runtime?.monaco.editor.setTheme(dark ? 'vs-dark' : 'vs'))
  watch(text, value => {
    if (model && value !== model.getValue()) {
      applying = true
      model.setValue(value)
      applying = false
    }
  })
  watch(() => props.language, language => model && runtime?.monaco.editor.setModelLanguage(model, language))

  onMounted(async () => {
    try {
      runtime = await import('~/utils/monaco')
      if (disposed || !host.value) {
        return
      }
      if (props.schemas) {
        runtime.registerJsonSchemas(props.schemas)
      }
      const { monaco } = runtime
      const uri = monaco.Uri.parse(`inmemory://${props.modelNamespace ?? 'code-view'}/${crypto.randomUUID()}.${props.language}`)
      model = monaco.editor.createModel(text.value, props.language, uri)
      instance = monaco.editor.create(host.value, { ...options.value, model })
      model.onDidChangeContent(() => {
        if (!applying && model) {
          text.value = model.getValue()
        }
      })
      ready.value = true
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error)
    }
  })

  onBeforeUnmount(() => {
    disposed = true
    instance?.dispose()
    model?.dispose()
  })

  function find () {
    instance?.focus()
    void instance?.getAction('actions.find')?.run()
  }

  async function copy () {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }

  function download () {
    const url = URL.createObjectURL(new Blob([text.value], { type: props.language === 'xml' ? 'application/xml' : (props.language === 'json' ? 'application/json' : 'text/plain') }))
    const link = document.createElement('a')
    link.href = url
    link.download = props.fileName!
    link.click()
    URL.revokeObjectURL(url)
  }

  defineExpose({ find })
</script>
