<template>
  <v-toolbar class="flex-shrink-0" :title="label(contribution.title)">
    <template #append>
      <span class="text-body-small text-medium-emphasis text-truncate d-none d-sm-inline">{{ t('overview.reason', { app: label(contribution.appTitle), submodel: opened.submodel.idShort ?? opened.submodel.id }) }}</span>

      <v-chip
        v-if="contribution.unsigned"
        class="ms-2"
        color="warning"
        size="x-small"
        :text="t('apps.unsigned')"
      />

      <v-btn :aria-label="t('common.close')" data-test="app-view-close" icon="mdi-close" @click="emit('close')" />
    </template>
  </v-toolbar>

  <v-divider />

  <AppFrame
    v-if="shown"
    :key="`${opened.view.installationId}:${opened.view.id}:${opened.submodel.id}`"
    :contribution="contribution"
    fullscreen
    :shell-id="opened.shellId"
    :submodel="{ id: opened.submodel.id, semanticId: opened.submodel.semanticId }"
    :target="target"
    :view-state="viewState"
    @close-fullscreen="emit('close')"
  />
</template>

<script lang="ts" setup>
  import type { OpenedView, Target } from '#shared/contract'

  // Another app's view in Studio's dialog (studio.ui.openView, ADR 0051).
  // The view follows the installed apps as on the shell page: after an update
  // in place, the refetched contributions carry the new package's digest, and
  // the frame loads it (ADR 0044). Until they arrive, and should the app be
  // gone, it is the view Studio's server picked. A view embedded in an app's
  // page opens itself here with the state it passed (ADR 0051).
  const props = defineProps<{
    opened: OpenedView
    /** Whether the dialog has scaled in: the frame is created only then (AppFrame.vue). */
    shown: boolean
    target: Target | null
    viewState?: string
  }>()
  const emit = defineEmits<{ close: [] }>()

  const { t } = useI18n()
  const label = useLocalizedLabel()

  const contributions = useAppContributions(() => props.opened.submodel.semanticId)
  const contribution = computed(() => contributions.data.value?.submodelViews
    .find(view => view.installationId === props.opened.view.installationId && view.id === props.opened.view.id) ?? props.opened.view)
</script>
