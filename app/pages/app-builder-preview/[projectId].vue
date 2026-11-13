<template>
  <v-app>
    <v-main>
      <v-theme-provider :theme="builderTheme" with-background>
        <v-card-fullscreen class="d-flex flex-column" height="100dvh">
          <ProblemAlert v-if="error" class="ma-3" :error="error" />

          <PreviewPane
            v-else-if="project"
            :build-seq="0"
            :default-target-id="project.previewTargetId"
            detached
            :initial-selection="initialSelection"
            :project-id="project.id"
            @close="close"
          />

          <v-progress-linear v-else />
        </v-card-fullscreen>
      </v-theme-provider>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import type { PreviewSelection } from '#shared/app-preview-window'
  import type { AppProject } from '#shared/contract'
  import { provideI18n } from '~/components/app-builder/i18n'
  import PreviewPane from '~/components/app-builder/PreviewPane.vue'

  definePageMeta({ layout: false, previewWindow: true })

  const route = useRoute()
  const { t } = provideI18n()
  const builderTheme = useAppBuilderTheme()
  const client = useAppBuilderClient()
  const session = useSessionStore()
  const desktop = useDesktopBridge()
  const project = ref<AppProject | null>(null)
  const error = ref<unknown>(null)
  const initialSelection = ref<PreviewSelection | null>(null)

  useHead({ title: () => `${t('preview.title')}${project.value ? ` — ${project.value.name}` : ''} — BaSyx Studio` })

  onMounted(async () => {
    try {
      if (!session.isDesktop) {
        throw new Error(t('preview.desktopOnly'))
      }
      const [projects, selection] = await Promise.all([
        client.call('listProjects', {}),
        desktop?.getAppPreviewSelection?.() ?? null,
      ])
      initialSelection.value = selection
      project.value = projects.find(entry => entry.id === route.params.projectId) ?? null
      if (!project.value) {
        throw new Error(t('preview.projectMissing'))
      }
    } catch (error_) {
      error.value = error_
    }
  })

  function close () {
    window.close()
  }
</script>
