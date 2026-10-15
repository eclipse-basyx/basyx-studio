<template>
  <v-dialog v-model="open" :fullscreen="xs" max-width="720" scrollable>
    <DialogCard :title="t('shells.query.title')">
      <p class="text-body-medium text-medium-emphasis mt-0 mb-4">
        {{ t(`shells.query.${queryTarget}`) }}. {{ t('shells.query.text', { roots: queryRoots[queryTarget].join(', ') }) }}
      </p>

      <!-- Monaco with the IDTA query schema: suggestions (Ctrl+Space) and checks while typing. -->
      <v-sheet border height="360" rounded="lg">
        <CodeView
          v-model="text"
          editable
          :label="t('shells.query.label')"
          language="json"
          model-namespace="aas-query"
          :schemas="schemas"
        />
      </v-sheet>

      <v-alert
        v-if="findings.length > 0"
        class="mt-4"
        :title="t('problem.query_invalid')"
        type="error"
      >
        <v-list>
          <v-list-item
            v-for="finding in findings"
            :key="`${finding.path}:${finding.message}`"
            class="px-0"
            :subtitle="finding.message"
            :title="finding.path"
          />
        </v-list>
      </v-alert>

      <ProblemAlert v-else-if="error" class="mt-4" :error="error" />

      <template #actions-start>
        <v-btn-secondary prepend-icon="mdi-restore" :text="t('shells.query.fromSearch')" @click="reset" />
      </template>

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="open = false" />
        <v-btn-primary :disabled="!text.trim()" :loading="checking" :text="t('shells.query.apply')" @click="apply" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { QueryTarget } from '#shared/search/expression'
  import { useDisplay } from 'vuetify'
  import { buildShellQuery, conceptDescriptionSearchFields, parseSearch, queryRoots, searchFields } from '#shared/search/expression'
  import querySchema from '#shared/search/query-schema.json'
  import { StudioApiError } from '~/composables/useStudioApi'

  // The advanced search (MVP-4 plan, S2): a raw AAS Query Language query,
  // checked by the server before the list shows its results.

  const props = defineProps<{
    targetId: string
    /** Shells (`repository`, `registry`) or concept descriptions (`conceptDescriptions`, MVP-6 plan, S1). */
    queryTarget: QueryTarget
    /** The search field's expression, the starting point of a new query. */
    expression: string
    query: Record<string, unknown> | null
  }>()
  const emit = defineEmits<{ apply: [query: Record<string, unknown>] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const { xs } = useDisplay()
  const api = useStudioApi()

  const text = ref('')
  // The vendored IDTA-01002-3 schema, rooted at its Query definition.
  const schemas = [{
    uri: 'https://admin-shell.io/aas/API/3/query-schema.json',
    fileMatch: ['inmemory://aas-query/*'],
    schema: { $schema: querySchema.$schema, definitions: querySchema.definitions, $ref: '#/definitions/Query' },
  }]
  const checking = ref(false)
  const error = ref<unknown>(null)
  const findings = ref<Array<{ path: string, message: string }>>([])

  function format (query: object | undefined): string {
    return JSON.stringify(query ?? { $condition: { $boolean: true } }, null, 2)
  }

  function reset () {
    const fields = props.queryTarget === 'conceptDescriptions' ? conceptDescriptionSearchFields : searchFields
    text.value = format(buildShellQuery(props.queryTarget, parseSearch(props.expression, fields)))
    findings.value = []
    error.value = null
  }

  watch(open, value => {
    if (value) {
      reset()
      if (props.query) {
        text.value = format(props.query)
      }
    }
  })

  async function apply () {
    findings.value = []
    error.value = null
    let query: unknown
    try {
      query = JSON.parse(text.value)
    } catch (error_) {
      findings.value = [{ path: '/', message: t('shells.query.invalidJson', { message: (error_ as Error).message }) }]
      return
    }
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      findings.value = [{ path: '/', message: t('shells.query.notObject') }]
      return
    }
    checking.value = true
    try {
      // One row is enough to know that the server accepts the query.
      await api(`/targets/${props.targetId}/searches`, { method: 'POST', body: { scope: props.queryTarget === 'conceptDescriptions' ? 'conceptDescriptions' : 'shells', query, limit: 1 } })
      emit('apply', query as Record<string, unknown>)
      open.value = false
    } catch (error_) {
      const violations = error_ instanceof StudioApiError ? error_.problem?.violations : undefined
      if (violations?.length) {
        findings.value = violations
      } else {
        error.value = error_
      }
    } finally {
      checking.value = false
    }
  }
</script>
