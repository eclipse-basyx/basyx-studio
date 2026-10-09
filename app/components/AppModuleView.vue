<template>
  <v-container fluid max-width="none">
    <TargetHeader v-if="targetId" :target="target?.data.value" :trail="trail" />

    <h1 v-else class="text-headline-medium mb-4">{{ title }}</h1>

    <ProblemAlert v-if="contributions.error.value" :error="contributions.error.value" retry @retry="contributions.refetch()" />

    <v-progress-linear v-else-if="contributions.isLoading.value" />

    <v-alert v-else-if="!module" :text="t('apps.notInstalled')" type="info" />

    <template v-else-if="targetId && target">
      <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

      <TargetAuthorization
        v-else-if="target.data.value && target.needsAuthorization.value"
        :target="target.data.value"
        @authorized="target.refetch()"
      />

      <v-alert v-else-if="module.context === 'shell' && !shellId" :text="t('apps.needsShell')" type="info" />

      <v-card-pane v-else-if="target.data.value">
        <AppFrame
          :key="`${targetId}:${shellKey ?? ''}:${module.installationId}:${module.id}`"
          :contribution="module"
          :shell-id="shellId"
          :sub-path="subPath"
          :target="target.data.value"
          @navigate="navigate"
        />
      </v-card-pane>
    </template>

    <v-card-pane v-else>
      <AppFrame
        :key="`${module.installationId}:${module.id}`"
        :contribution="module"
        :sub-path="subPath"
        :target="null"
        @navigate="navigate"
      />
    </v-card-pane>
  </v-container>
</template>

<script lang="ts" setup>
  import { decodeResourceKey } from '~/utils/aas'

  // An app module page (MVP-3). Global modules live under /apps, target and
  // shell modules under /targets/{targetId}/apps; the rest of the path is the
  // module's own sub-path (nested routes).
  const props = defineProps<{
    installationId: string
    route: string
    targetId: string | null
    shellKey: string | null
    subPath: string
  }>()

  const { t } = useI18n()
  const router = useRouter()
  const currentRoute = useRoute()
  const label = useLocalizedLabel()

  const contributions = useAppContributions()
  const module = computed(() => contributions.data.value?.modules
    .find(item => item.installationId === props.installationId && item.route === props.route) ?? null)
  const target = props.targetId ? useTarget(() => props.targetId!) : null
  const shellId = computed(() => props.shellKey ? decodeResourceKey(props.shellKey) : null)

  const title = computed(() => module.value ? label(module.value.title) : t('app.apps'))
  const trail = computed(() => [{ title: title.value }])

  function navigate (subPath: string) {
    const base = props.targetId
      ? `/targets/${props.targetId}/apps/${props.installationId}/${props.route}`
      : `/apps/${props.installationId}/${props.route}`
    void router.replace({ path: subPath ? `${base}/${subPath}` : base, query: currentRoute.query })
  }
</script>
