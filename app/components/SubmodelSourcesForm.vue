<template>
  <div>
    <v-expansion-panels v-if="entries.length > 0" v-model="open" class="mb-3">
      <v-expansion-panel v-for="entry in entries" :key="entry.key" :value="entry.key">
        <v-expansion-panel-title>
          <v-icon class="me-2" icon="mdi-file-outline" />
          <span class="text-truncate">{{ entry.metadata.idShort || t('wizard.newSubmodel') }}</span>
        </v-expansion-panel-title>

        <v-expansion-panel-text>
          <!-- The same fields as the form of an existing submodel. -->
          <SubmodelFields v-model="entry.metadata" identifier />

          <v-btn
            class="mt-2"
            color="error"
            prepend-icon="mdi-delete-outline"
            size="small"
            :text="t('wizard.remove')"
            @click="remove(entry.key)"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <div v-else class="text-body-medium text-medium-emphasis mb-3">{{ t('wizard.noSubmodels') }}</div>

    <v-btn prepend-icon="mdi-plus" :text="t('wizard.addSubmodel')" @click="add" />
  </div>
</template>

<script lang="ts" setup>
  import type { SubmodelSource } from '#shared/contract'
  import { uniqueIdShort } from '#shared/aas/defaults'

  // The empty submodels of a new shell or an existing one: each with the same
  // fields as the form of an existing submodel. Elements are added in the tree.
  const sources = defineModel<SubmodelSource[]>({ required: true })

  interface Entry {
    key: number
    /** The submodel's own fields: idShort, ID, names, category, semantic ID, kind, qualifiers. */
    metadata: Record<string, unknown>
  }

  const { t } = useI18n()
  const entries = ref<Entry[]>([])
  const open = ref<number | undefined>()
  let counter = 0

  function add () {
    const taken = entries.value.map(entry => String(entry.metadata.idShort ?? ''))
    const entry: Entry = { key: ++counter, metadata: { idShort: uniqueIdShort('Submodel', taken), kind: 'Instance' } }
    entries.value.push(entry)
    open.value = entry.key
  }

  function remove (key: number) {
    entries.value = entries.value.filter(entry => entry.key !== key)
  }

  // The sources the entries describe, for the request.
  watch(entries, list => {
    sources.value = list.map((entry): SubmodelSource => {
      const { id, idShort, ...metadata } = entry.metadata
      return {
        source: 'empty',
        idShort: typeof idShort === 'string' && idShort ? idShort : 'Submodel',
        id: typeof id === 'string' && id ? id : undefined,
        metadata,
      }
    })
  }, { deep: true })

  // A cleared list (a closed dialog) starts over.
  watch(sources, list => {
    if (list.length === 0 && entries.value.length > 0) {
      entries.value = []
    }
  })
</script>
