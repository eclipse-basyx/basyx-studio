<template>
  <!-- A full-screen dialog (AGENTS.md: edge to edge, v-card-fullscreen), laid out as the App
       Builder's chat page: the chat with the agent, and the document as a pane beside it. -->
  <v-dialog v-model="open" fullscreen persistent>
    <v-card-fullscreen class="d-flex flex-column" color="background" data-test="app-builder-planning" height="100%">
      <v-toolbar class="flex-shrink-0" :title="t('planning.title', { name: name.trim() || t('newApp.title') })">
        <template #append>
          <div class="d-flex align-center ga-2">
            <v-btn-toggle v-model="stage" data-test="app-builder-planning-stage" mandatory>
              <v-btn :text="t('planning.requirementsTitle')" value="requirements" />
              <v-btn :disabled="!plan.trim() && stage !== 'plan'" :text="t('planning.planTitle')" value="plan" />
            </v-btn-toggle>

            <v-btn-primary
              v-if="stage === 'requirements'"
              data-test="app-builder-planning-next"
              :disabled="writing || !requirements.trim()"
              :text="t('planning.next')"
              @click="emit('next')"
            />

            <v-btn-primary
              v-else
              data-test="app-builder-planning-create"
              :disabled="writing || !requirements.trim() || !plan.trim()"
              :loading="busy"
              :text="t('planning.create')"
              @click="emit('create')"
            />

            <v-btn
              v-tooltip="t('planning.back')"
              :aria-label="t('planning.back')"
              data-test="app-builder-planning-close"
              icon="mdi-close"
              @click="open = false"
            />
          </div>
        </template>
      </v-toolbar>

      <v-divider />

      <div class="d-flex flex-grow-1 overflow-hidden">
        <!-- The chat, as ChatView's. -->
        <div class="d-flex flex-column flex-grow-1 overflow-hidden">
          <div ref="scroller" class="flex-grow-1 overflow-y-auto">
            <v-container class="d-flex flex-column ga-3 px-4 py-3" data-test="app-builder-planning-chat" max-width="760">
              <div class="text-body-small text-medium-emphasis">{{ t('planning.hint', { agent }) }} {{ t('planning.files', { agent }) }}</div>

              <ProblemAlert v-if="problem" :error="problem" />

              <template v-for="item in messages" :key="item.id">
                <div v-if="item.kind === 'user'" class="d-flex justify-end">
                  <v-sheet class="px-3 py-2 text-body-medium text-pre-wrap text-break" color="surface-light" max-width="85%" rounded="lg">{{ item.text }}</v-sheet>
                </div>

                <div v-else-if="item.kind === 'agent'">
                  <MarkdownText v-if="item.text" :text="item.text" />

                  <div v-if="item.updated.length > 0" class="d-flex flex-wrap ga-1 mt-1">
                    <v-chip v-for="entry in item.updated" :key="entry" prepend-icon="mdi-file-document-edit-outline" :text="t(entry === 'plan' ? 'planning.updatedPlan' : 'planning.updatedRequirements')" />
                  </div>
                </div>

                <v-alert v-else :text="item.text" type="error" />
              </template>
            </v-container>
          </div>

          <v-container class="px-4 pt-0 pb-3" max-width="760">
            <div aria-live="polite" class="d-flex align-center ga-2 text-body-small text-medium-emphasis mb-1 px-2" role="status">
              <template v-if="writing">
                <v-progress-circular indeterminate size="14" width="2" />
                <span>{{ transcript.state === 'starting' ? t('planning.starting', { agent }) : t('planning.working', { agent }) }}</span>
              </template>
            </div>

            <v-sheet-composer>
              <v-textarea
                v-model="draft"
                :aria-label="t('planning.placeholder', { agent })"
                data-test="app-builder-planning-message"
                :placeholder="t('planning.placeholder', { agent })"
                @keydown.enter.exact.prevent="send"
              />

              <v-btn
                v-if="writing"
                v-tooltip="t('chat.stop')"
                :aria-label="t('chat.stop')"
                data-test="app-builder-planning-stop"
                :disabled="transcript.state !== 'working'"
                icon="mdi-stop"
                @click="emit('stop')"
              />

              <v-btn
                v-else
                v-tooltip="t('chat.send')"
                :aria-label="t('chat.send')"
                data-test="app-builder-planning-send"
                :disabled="!draft.trim()"
                icon="mdi-arrow-up"
                @click="send"
              />
            </v-sheet-composer>
          </v-container>
        </div>

        <!-- The document, as the preview pane beside a chat. -->
        <v-sheet class="d-flex flex-column flex-shrink-0 border-s" width="50%">
          <div class="d-flex align-center ga-2 ps-4 pe-2 py-1 border-b">
            <span class="text-title-small">{{ t(stage === 'plan' ? 'planning.planTitle' : 'planning.requirementsTitle') }}</span>
            <span class="text-body-small text-medium-emphasis flex-grow-1 text-truncate">{{ planningFiles[stage] }}</span>

            <v-progress-circular v-if="writing" indeterminate size="14" width="2" />

            <v-btn-toggle v-model="view" mandatory>
              <v-btn-toggle-icon
                v-tooltip="t('planning.edit')"
                :aria-label="t('planning.edit')"
                data-test="app-builder-planning-edit"
                icon="mdi-pencil-outline"
                value="edit"
              />

              <v-btn-toggle-icon
                v-tooltip="t('planning.preview')"
                :aria-label="t('planning.preview')"
                data-test="app-builder-planning-preview"
                icon="mdi-eye-outline"
                value="preview"
              />
            </v-btn-toggle>
          </div>

          <div v-if="!document.trim() && writing" class="d-flex flex-column align-center justify-center ga-2 flex-grow-1 text-body-medium text-medium-emphasis">
            <v-progress-circular indeterminate size="24" width="2" />
            {{ t('planning.drafting', { agent }) }}
          </div>

          <div v-else class="flex-grow-1 overflow-y-auto px-4 py-2">
            <v-textarea
              v-if="view === 'edit'"
              :aria-label="t(stage === 'plan' ? 'planning.planTitle' : 'planning.requirementsTitle')"
              auto-grow
              class="text-body-medium"
              :data-test="`app-builder-planning-${stage}`"
              hide-details
              :model-value="document"
              :readonly="writing"
              rows="12"
              variant="plain"
              @update:model-value="value => (stage === 'plan' ? plan = value : requirements = value)"
            />

            <MarkdownText v-else :text="document" />
          </div>
        </v-sheet>
      </div>
    </v-card-fullscreen>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { PlanningStage } from '#shared/app-builder-planning'
  import type { Transcript } from './transcript'
  import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
  import { planningFiles, planningStages, splitReply } from '#shared/app-builder-planning'
  import { useI18n } from './i18n'
  import MarkdownText from './MarkdownText.vue'

  // The planning of a new app (ADR 0054): the requirements, then the plan,
  // each a document the agent drafts and the user edits, beside the chat in
  // which they discuss it. Closing it goes back to the idea.
  const open = defineModel<boolean>({ required: true })
  const stage = defineModel<PlanningStage>('stage', { required: true })
  const requirements = defineModel<string>('requirements', { required: true })
  const plan = defineModel<string>('plan', { required: true })
  const props = defineProps<{ transcript: Transcript, agent: string, name: string, busy: boolean, problem: unknown }>()
  const emit = defineEmits<{ send: [message: string], stop: [], next: [], create: [] }>()
  const { t } = useI18n()

  const view = ref<'edit' | 'preview'>('edit')
  const draft = ref('')
  const writing = computed(() => props.transcript.state === 'starting' || props.transcript.state === 'working')
  const document = computed(() => stage.value === 'plan' ? plan.value : requirements.value)

  type Message
    = | { kind: 'user', id: string, text: string }
      | { kind: 'agent', id: string, text: string, updated: PlanningStage[] }
      | { kind: 'error', id: string, text: string }

  /** The chat without the documents, which are in the pane: a note of each one a reply updated. */
  const messages = computed<Message[]>(() => props.transcript.items.flatMap((item): Message[] => {
    switch (item.kind) {
      case 'user': {
        return [{ kind: 'user', id: item.id, text: item.text }]
      }
      case 'agent': {
        let text = item.text
        const updated: PlanningStage[] = []
        for (const entry of planningStages) {
          const split = splitReply(text, entry)
          if (split.document !== null) {
            updated.push(entry)
            text = split.reply
          }
        }
        return [{ kind: 'agent', id: item.id, text, updated }]
      }
      case 'error': {
        return [{ kind: 'error', id: item.id, text: item.message }]
      }
      default: {
        return []
      }
    }
  }))

  function send () {
    const text = draft.value.trim()
    if (!text || writing.value) {
      return
    }
    emit('send', text)
    draft.value = ''
  }

  // Follows the chat while the user is at its end.
  const scroller = useTemplateRef<HTMLElement>('scroller')
  watch(() => props.transcript.seq, async () => {
    const element = scroller.value
    if (!element) {
      return
    }
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    await nextTick()
    if (atBottom) {
      element.scrollTop = element.scrollHeight
    }
  })
</script>
