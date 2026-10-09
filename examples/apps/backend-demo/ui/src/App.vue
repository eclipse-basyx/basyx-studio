<template>
  <v-app>
    <v-main>
      <v-container fluid>
        <p class="text-body-1 mb-4">
          The summary of <strong>{{ client.context.target?.name }}</strong> is computed by this app's backend, an isolated Deno
          process that reads AAS data through Studio with your rights.
        </p>

        <div class="d-flex flex-wrap ga-2 mb-4">
          <v-btn-primary :loading="busy === 'summarize'" prepend-icon="mdi-play" text="Summarize target" @click="run('summarize')" />
          <v-btn :loading="busy === 'isolation'" prepend-icon="mdi-shield-check-outline" text="Check isolation" @click="run('isolation')" />
        </div>

        <v-alert
          v-if="error"
          class="mb-4"
          data-test="error"
          :text="error"
          type="error"
        />

        <v-card v-if="summary" class="mb-4" title="Summary">
          <v-card-text data-test="summary">
            <div class="text-h4">{{ summary.shells }} shells</div>

            <div class="d-flex flex-wrap ga-1 mt-2">
              <v-chip v-for="(count, kind) in summary.assetKinds" :key="kind" :text="`${kind}: ${count}`" />
            </div>

            <div class="text-caption text-medium-emphasis mt-2">{{ summary.runtime }}</div>
          </v-card-text>
        </v-card>

        <v-card v-if="isolation" title="Isolation">
          <v-card-text class="d-flex flex-wrap ga-1" data-test="isolation">
            <v-chip
              v-for="(outcome, name) in isolation"
              :key="name"
              :color="outcome === 'denied' ? 'success' : 'error'"
              :text="`${name}: ${outcome}`"
            />
          </v-card-text>
        </v-card>
      </v-container>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import type { StudioClient } from '@basyx/studio-sdk'
  import { ref } from 'vue'

  const props = defineProps<{ client: StudioClient }>()

  const busy = ref<string | null>(null)
  const error = ref<string | null>(null)
  const summary = ref<{ shells: number, assetKinds: Record<string, number>, runtime: string } | null>(null)
  const isolation = ref<Record<string, string> | null>(null)

  async function run (method: 'summarize' | 'isolation') {
    busy.value = method
    error.value = null
    try {
      if (method === 'summarize') {
        summary.value = await props.client.backend.call('summarize')
      } else {
        isolation.value = await props.client.backend.call('isolation')
      }
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      busy.value = null
    }
  }
</script>
