<template>
  <v-row>
    <!-- Live values: numeric properties whose values changed while auto-refresh re-read them. -->
    <v-col v-if="signals.length > 0" class="d-flex flex-wrap ga-4" cols="12">
      <v-card
        v-for="signal in signals"
        :key="signal.id"
        class="flex-1-1-0"
        max-width="280"
        min-width="180"
        @click="emit('select', signal.id)"
      >
        <v-card-item>
          <v-card-subtitle class="text-label-medium">{{ signal.title }}</v-card-subtitle>

          <v-card-title class="text-headline-small font-weight-medium">
            {{ signal.value }}
            <span v-if="signal.unit && signal.value !== null" class="text-body-large text-medium-emphasis">{{ signal.unit }}</span>
          </v-card-title>

          <template #append>
            <v-icon v-tooltip="t('overview.liveHint', { submodel: signal.submodel, count: signal.history.length })" color="success" icon="mdi-refresh-auto" size="small" />
          </template>
        </v-card-item>

        <v-sparkline
          :gradient="gradient"
          height="56"
          line-width="3"
          :model-value="signal.history"
          padding="8"
          smooth="10"
        />
      </v-card>
    </v-col>

    <v-col
      v-for="view in views"
      :key="`${view.submodel.key}:${view.contribution.installationId}:${view.contribution.id}`"
      cols="12"
      lg="6"
    >
      <div class="d-flex align-center ga-2 mb-1 px-1 text-body-small text-medium-emphasis">
        <span class="text-truncate">{{ t('overview.reason', { app: label(view.contribution.appTitle), submodel: view.submodel.idShort ?? view.submodel.submodelId }) }}</span>
        <v-chip v-if="view.contribution.unsigned" color="warning" size="x-small" :text="t('apps.unsigned')" />
        <v-tooltip activator="parent" :text="t('apps.matchReason', { semanticId: view.contribution.reason.semanticId })" />
      </div>

      <AppFrame
        :contribution="view.contribution"
        fit
        :shell-id="shellId"
        :submodel="{ id: view.submodel.submodelId, semanticId: view.submodel.semanticId }"
        :target="target"
      />
    </v-col>

    <v-col v-if="contributions.isPending.value" cols="12">
      <v-skeleton-loader type="card" />
    </v-col>

    <v-col v-else-if="views.length === 0 && signals.length === 0" cols="12">
      <v-empty-state
        icon="mdi-puzzle-outline"
        size="64"
        :text="t('overview.noneText')"
        :title="t('overview.none')"
      />
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  import type { SubmodelRef, SubmodelViewContributionInfo, Target } from '#shared/contract'
  import { useTheme } from 'vuetify'

  /** A numeric property whose value changed while auto-refresh re-read it. */
  export interface LiveSignal {
    id: string
    title: string
    submodel: string
    value: string | null
    /** The unit of its concept description, if any (MVP-6 plan, E6). */
    unit: string | null
    history: number[]
  }

  // The views of installed apps (plan D3, D14) for every submodel of the
  // shell, one card each. Each runs in its own sandboxed frame.
  // While auto-refresh is on, the values that change come first, as in the prototype.
  const props = defineProps<{ target: Target, shellId: string, refs: SubmodelRef[], signals: LiveSignal[] }>()
  const emit = defineEmits<{ select: [id: string] }>()

  const { t } = useI18n()
  const theme = useTheme()
  const gradient = computed(() => {
    const colors = theme.current.value.colors
    return [String(colors.secondary), String(colors.primary)]
  })
  const label = useLocalizedLabel()

  const available = computed(() => props.refs.filter(ref => ref.status === 'available' && ref.semanticId))
  const contributions = useAppContributions(() => available.value.map(ref => ref.semanticId!))

  // Every matching view; the apps shipped with Studio come first.
  const views = computed(() => available.value.flatMap(submodel => (contributions.data.value?.submodelViews ?? [])
    .filter(view => view.reason.semanticId === submodel.semanticId)
    .toSorted((a, b) => Number(b.bundled) - Number(a.bundled))
    .map(contribution => ({ submodel, contribution }) satisfies { submodel: SubmodelRef, contribution: SubmodelViewContributionInfo })))
</script>
