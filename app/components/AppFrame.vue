<template>
  <div class="d-flex flex-column flex-grow-1">
    <v-progress-linear v-if="!connected" />

    <!-- Created only on the client, after the bridge listens: a frame in
         server-rendered HTML would load before hydration. -->
    <iframe
      v-if="mounted"
      ref="frame"
      class="flex-grow-1 w-100 border-0 d-block"
      referrerpolicy="no-referrer"
      sandbox="allow-scripts"
      :src="contribution.entryUrl"
      :title="t('apps.frameTitle', { name: label(contribution.title) })"
      @load="onLoad"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { AppContext, AppContributionInfo, Target } from '#shared/contract'
  import { useTheme } from 'vuetify'
  import { appProtocol } from '#shared/contract'

  // A sandboxed app frame (ADR 0017): no same-origin access, popups, forms or
  // top navigation. Key it by target (and submodel), so a new target always
  // gets a new frame and never sees the previous target's data.
  const props = defineProps<{
    contribution: AppContributionInfo
    target: Target | null
    shellId?: string | null
    submodel?: { id: string, semanticId: string | null } | null
    subPath?: string
  }>()
  const emit = defineEmits<{ navigate: [subPath: string] }>()

  const { t, locale } = useI18n()
  const theme = useTheme()
  const label = useLocalizedLabel()
  const frame = useTemplateRef<HTMLIFrameElement>('frame')

  const themeColors = computed(() => Object.fromEntries(Object.entries(theme.current.value.colors)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')))

  const context = computed<AppContext>(() => ({
    protocol: appProtocol,
    installationId: props.contribution.installationId,
    appId: props.contribution.appId,
    contribution: { kind: props.contribution.kind, id: props.contribution.id },
    target: props.target
      ? {
        id: props.target.id,
        name: props.target.name,
        write: props.target.capabilities.write,
        persistence: props.target.capabilities.persistence,
      }
      : null,
    shell: props.shellId ? { id: props.shellId } : null,
    submodel: props.submodel ? { ...props.submodel } : null,
    subPath: props.subPath ?? '',
    locale: locale.value,
    theme: { dark: theme.current.value.dark, colors: themeColors.value },
  }))

  const mounted = ref(false)
  onMounted(() => (mounted.value = true))

  const { connected, onLoad } = useAppBridge(frame, {
    contribution: () => props.contribution,
    targetId: props.target?.id ?? null,
    context: () => context.value,
    onNavigate: subPath => emit('navigate', subPath),
  })
</script>
