<template>
  <FileDropZone
    class="h-100"
    :disabled="!target.canImport.value"
    :text="t('upload.dropTypes')"
    :title="t('upload.dropHere', { name: target.data.value?.name ?? '' })"
    @file="ui.openUpload($event)"
  >
    <!-- Files dropped on the welcome page are imported into the target.
         The drawers register with the app layout from inside the page. -->
    <ShellListDrawer :active-key="null" :target-id="targetId" />

    <v-container class="fill-height" max-width="720">
      <ProblemAlert v-if="target.error.value" :error="target.error.value" retry @retry="target.refetch()" />

      <TargetAuthorization
        v-else-if="target.data.value && target.needsAuthorization.value"
        :target="target.data.value"
        @authorized="invalidate(['targets', targetId])"
      />

      <!-- A link with a global asset ID (QR codes, other tools) opens the asset's shell. -->
      <template v-else-if="globalAssetId">
        <v-progress-linear v-if="lookup.isLoading.value" />
        <ProblemAlert v-else-if="lookup.error.value" :error="lookup.error.value" retry @retry="lookup.refetch()" />

        <v-alert v-else-if="matches.length === 0" type="info">{{ t('viewer.assetNotFound', { assetId: globalAssetId }) }}</v-alert>

        <v-card v-else :subtitle="globalAssetId" :title="t('viewer.assetShells')">
          <v-list>
            <v-list-item
              v-for="shell in matches"
              :key="shell.key"
              prepend-icon="$aas"
              :subtitle="shell.id"
              :title="langText(shell.displayName) ?? shell.idShort ?? shell.id"
              :to="`/targets/${targetId}/shells/${shell.key}`"
            />
          </v-list>
        </v-card>
      </template>

      <template v-else>
        <v-empty-state
          :headline="t('viewer.headline')"
          :text="t('viewer.text')"
          :title="t('viewer.title')"
        >
          <template #media>
            <v-avatar class="mb-4" color="primary" size="96" variant="tonal">
              <v-icon icon="$aas" size="48" />
            </v-avatar>
          </template>

          <template #actions>
            <v-btn-primary
              v-if="!mdAndUp"
              prepend-icon="mdi-format-list-bulleted"
              :text="t('viewer.browse')"
              @click="ui.listDrawer = true"
            />

            <v-btn prepend-icon="mdi-magnify" :text="t('viewer.search')" variant="tonal" @click="ui.commandOpen = true" />

            <v-btn
              v-if="target.canImport.value"
              prepend-icon="mdi-tray-arrow-up"
              :text="t('upload.action')"
              variant="tonal"
              @click="ui.openUpload()"
            />
          </template>
        </v-empty-state>

        <div v-if="recent.length > 0" class="w-100 text-center">
          <div class="text-label-large text-medium-emphasis mb-2">{{ t('viewer.recent') }}</div>

          <!-- A wrapping row, centred like the rest of the empty state (a chip group stays left-aligned). -->
          <div class="d-flex flex-wrap justify-center ga-2">
            <v-chip
              v-for="entry in recent"
              :key="entry.key"
              prepend-icon="mdi-history"
              :text="entry.title ?? decodeResourceKey(entry.key) ?? entry.key"
              :to="`/targets/${targetId}/shells/${entry.key}`"
              variant="outlined"
            />
          </div>
        </div>
      </template>
    </v-container>
  </FileDropZone>
</template>

<script lang="ts" setup>
  import type { ShellSummary } from '#shared/contract'
  import { useQuery } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { decodeResourceKey, langText } from '~/utils/aas'

  const { t } = useI18n()
  const route = useRoute()
  const ui = useUiStore()
  const invalidate = useInvalidate()
  const preferences = usePreferences()
  const { mdAndUp } = useDisplay()

  const targetId = computed(() => String(route.params.targetId))
  const target = useTarget(targetId)
  const recent = computed(() => preferences.recent(targetId.value).slice(0, 5))

  const api = useStudioApi()
  const router = useRouter()
  const globalAssetId = computed(() => typeof route.query.globalAssetId === 'string' ? route.query.globalAssetId : null)
  const lookup = useQuery({
    key: () => ['targets', targetId.value, 'lookup', globalAssetId.value ?? ''],
    query: ({ signal }) => api<{ items: ShellSummary[] }>(`/targets/${targetId.value}/lookup`, { query: { assetId: globalAssetId.value! }, signal }),
    enabled: () => globalAssetId.value !== null && target.data.value !== undefined && !target.needsAuthorization.value,
  })
  const matches = computed(() => lookup.data.value?.items ?? [])
  // One shell: open it right away, without keeping the lookup in the history.
  watch(matches, items => {
    if (items.length === 1) {
      void router.replace(`/targets/${targetId.value}/shells/${items[0]!.key}`)
    }
  }, { immediate: true })
</script>
