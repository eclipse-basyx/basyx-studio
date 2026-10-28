<template>
  <v-card
    :aria-label="t('contacts.open', { name: heading.title })"
    class="h-100"
    data-test="contact"
    @click="emit('open')"
  >
    <v-card-item>
      <template #prepend>
        <v-avatar color="primary" variant="tonal">
          <v-icon :icon="heading.named ? 'mdi-account-outline' : 'mdi-domain'" />
        </v-avatar>
      </template>

      <v-card-title class="text-wrap text-break" data-test="contact-name">{{ heading.title }}</v-card-title>

      <v-card-subtitle v-if="heading.subtitle" class="text-wrap text-break" data-test="contact-organization">{{ heading.subtitle }}</v-card-subtitle>
    </v-card-item>

    <v-card-text class="d-flex flex-column align-start ga-1 pt-0">
      <v-chip
        v-if="heading.role"
        class="mb-1"
        data-test="contact-role"
        prepend-icon="mdi-account-tie-outline"
        :text="heading.role"
      />

      <!-- The first phone number and email address, which open without the details. -->
      <v-btn-link
        v-for="row in quick"
        :key="row.key"
        data-test="detail-link"
        :prepend-icon="row.icon"
        :text="row.value"
        @click.stop="open(row.url!)"
      />
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
  import type { ContactInformation } from '@basyx/studio-app-kit/contacts'
  import { contactRows } from '@basyx/studio-app-kit/contacts'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { contactHeading } from './presentation'

  // A contact at a glance: name (or company), organization, role, and the
  // first phone number and email address; a click shows everything else
  // (ContactDialog).
  const props = defineProps<{ contact: ContactInformation, index: number }>()
  const emit = defineEmits<{ open: [] }>()

  const { t, formatLocale } = useI18n()
  const { open } = useRowActions()

  const heading = computed(() => contactHeading(t, props.contact, props.index, formatLocale.value))
  const quick = computed(() => {
    const rows = contactRows(props.contact, formatLocale.value)
    return (['phone', 'email'] as const)
      .map(key => rows.find(row => row.key === key && row.url))
      .filter(row => row !== undefined)
  })
</script>
