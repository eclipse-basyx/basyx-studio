<template>
  <v-app>
    <v-main>
      <v-container fluid>
        <v-alert v-if="error" class="mb-4" :text="error" type="error" />

        <!-- Shell context: the shell selected in Studio. -->
        <template v-if="context.contribution.id === 'shell-summary'">
          <h2 class="text-h6 mb-2" data-test="heading">Submodels of {{ context.shell?.id }}</h2>
          <SubmodelList v-if="context.shell" :key="context.shell.id" :client="client" :shell-id="context.shell.id" />
        </template>

        <!-- Nested route shells/<id>: one shell. -->
        <template v-else-if="shellId">
          <v-btn class="mb-2" prepend-icon="mdi-arrow-left" text="All shells" @click="client.ui.navigate('')" />
          <h2 class="text-h6 mb-2" data-test="heading">{{ shellId }}</h2>
          <SubmodelList :key="shellId" :client="client" :shell-id="shellId" />
        </template>

        <template v-else>
          <h2 class="text-h6 mb-2" data-test="heading">Shells of {{ context.target?.name }}</h2>
          <v-progress-linear v-if="loading" />

          <v-card v-else>
            <v-list data-test="shells" density="compact">
              <v-list-item
                v-for="shell in shells"
                :key="shell.id"
                prepend-icon="mdi-cube-outline"
                :subtitle="shell.id"
                :title="shell.idShort ?? shell.id"
                @click="client.ui.navigate(`shells/${encode(shell.id)}`)"
              />
            </v-list>
          </v-card>

          <v-btn v-if="nextCursor" class="mt-2" text="Load more" @click="load(nextCursor)" />
        </template>
      </v-container>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import type { ShellSummary, StudioClient } from '@basyx/studio-sdk'
  import { computed, onMounted, ref } from 'vue'
  import SubmodelList from './SubmodelList.vue'

  const props = defineProps<{ client: StudioClient }>()

  const context = ref(props.client.context)
  props.client.onContext(value => (context.value = value))

  const shells = ref<ShellSummary[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  function encode (id: string): string {
    return btoa(String.fromCodePoint(...new TextEncoder().encode(id))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  }

  function decode (key: string): string {
    const binary = atob(key.replaceAll('-', '+').replaceAll('_', '/'))
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.codePointAt(0)!))
  }

  // The module's sub-path is its own nested route: `` or `shells/<id>`.
  const shellId = computed(() => {
    const match = /^shells\/([\w-]+)$/.exec(context.value.subPath)
    return match ? decode(match[1]!) : null
  })

  async function load (cursor?: string) {
    loading.value = !cursor
    try {
      const page = await props.client.aas.listShells({ limit: 50, cursor })
      shells.value = cursor ? [...shells.value, ...page.items] : page.items
      nextCursor.value = page.page.nextCursor
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    if (context.value.contribution.id === 'explorer') {
      void load()
    }
  })
</script>
