<template>
  <!-- A target in the grid of the targets page, as a shadcn card: identity
       on top, the status beside one main action below. The card itself opens
       the target's overview, which also lists the features. -->
  <v-card class="d-flex flex-column h-100" :to="`/targets/${target.id}`">
    <v-card-item>
      <template #prepend>
        <v-avatar :color="target.workspace ? 'secondary' : 'primary'" variant="tonal">
          <v-icon :icon="targetIcon(target)" />
        </v-avatar>
      </template>

      <v-card-title class="text-title-medium">{{ target.name }}</v-card-title>
      <v-card-subtitle>{{ targetSubtitle(target, t('landing.subtitle')) }}</v-card-subtitle>
    </v-card-item>

    <v-spacer />

    <v-divider />

    <v-card-actions>
      <TargetChips class="ps-2" :target="target" />

      <v-spacer />

      <v-btn-primary
        v-if="target.authenticationState === 'required'"
        prepend-icon="mdi-key-outline"
        :text="t('target.authorize')"
        @click.stop.prevent="navigateTo(`/targets/${target.id}/shells`)"
      />

      <v-btn-primary
        v-else
        append-icon="mdi-arrow-right"
        :text="t('landing.openViewer')"
        @click.stop.prevent="navigateTo(`/targets/${target.id}/shells`)"
      />
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { targetIcon, targetSubtitle } from '~/utils/aas'

  defineProps<{ target: Target }>()
  const { t } = useI18n()
</script>
