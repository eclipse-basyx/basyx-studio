<template>
  <!-- Label and value rows as the general information beside it: the system
       with its version, then the class with its name. -->
  <v-table-details data-test="classifications">
    <tbody>
      <tr v-for="entry in entries" :key="entry.classification.path" data-test="classification">
        <td class="text-medium-emphasis text-no-wrap align-top py-2">
          <v-btn-link
            v-if="entry.url"
            append-icon="mdi-open-in-new"
            data-test="classification-url"
            :text="entry.system"
            @click="open(entry.url)"
          />

          <template v-else>{{ entry.system }}</template>

          <div v-if="entry.version" class="text-body-small">{{ t('classification.version', { version: entry.version }) }}</div>
        </td>

        <td class="align-top py-2 text-break w-100">
          <div class="d-flex align-start ga-2">
            <div class="flex-grow-1">
              <div class="font-weight-medium" data-test="classification-class">{{ entry.classId }}</div>
              <div v-if="entry.className">{{ entry.className }}</div>
              <div v-if="entry.codedName && entry.codedName !== entry.className" class="text-body-small text-medium-emphasis">{{ entry.codedName }}</div>
            </div>

            <v-btn-link
              v-if="entry.area"
              append-icon="mdi-arrow-down"
              :aria-label="t('classification.showArea', { name: entry.area.title })"
              data-test="classification-area"
              :text="entry.area.title"
              @click="emit('area', entry.area.path)"
            />
          </div>
        </td>
      </tr>
    </tbody>
  </v-table-details>
</template>

<script lang="ts" setup>
  import type { Classification } from './technicalData'
  import { fieldText } from '@basyx/studio-app-kit/aas'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { httpsUrl } from './presentation'

  // The product's classes in classification systems such as ECLASS and IEC
  // CDD; the system's address opens in the browser, and the area of
  // technical properties a class refers to is a link to its rows.
  const props = defineProps<{ classifications: Classification[], areas: Array<{ path: string, title: string }> }>()
  const emit = defineEmits<{ area: [path: string] }>()

  const { t, formatLocale } = useI18n()
  const { open } = useRowActions()

  const entries = computed(() => props.classifications.map(classification => {
    const text = (field: Classification['system']) => fieldText(field, formatLocale.value)
    return {
      classification,
      system: text(classification.system),
      version: text(classification.version),
      url: httpsUrl(text(classification.url)),
      classId: text(classification.classId),
      className: text(classification.className),
      codedName: text(classification.codedName),
      area: props.areas.find(area => area.path === classification.areaPath) ?? null,
    }
  }))
</script>
