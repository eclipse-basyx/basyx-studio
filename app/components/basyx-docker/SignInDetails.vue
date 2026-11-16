<template>
  <v-card data-test="sign-in">
    <v-card-text class="d-flex flex-column ga-4">
      <p class="text-body-medium ma-0">{{ t('signIn.text') }}</p>

      <v-progress-linear v-if="!details && !error" />

      <ErrorAlert v-else-if="error" :error="error">
        <template #actions>
          <v-btn :text="t('problem.retry')" @click="load" />
        </template>
      </ErrorAlert>

      <template v-else-if="details">
        <CredentialTable :users="details.users" @copy="copy" />

        <v-alert v-if="sharing && stack.spec?.aasxFiles.length" class="my-2" :text="t('signIn.sharingHint')" type="info" />

        <v-divider />

        <section class="d-flex flex-column ga-3" data-test="console-sign-in">
          <div class="d-flex align-center ga-2">
            <h2 class="text-title-small font-weight-medium flex-grow-1 ma-0">{{ t('signIn.console') }}</h2>

            <v-btn-widget-icon
              v-tooltip="t('signIn.console')"
              :aria-label="t('signIn.console')"
              icon="mdi-open-in-new"
              @click="client.ui.openExternal(details.console.url)"
            />
          </div>

          <CredentialTable :users="consoleUsers" @copy="copy" />
        </section>
      </template>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
  import type { Stack, StackSignIn } from '@basyx/studio-sdk'
  import { computed, onMounted, ref } from 'vue'
  import CredentialTable from './CredentialTable.vue'
  import ErrorAlert from './ErrorAlert.vue'
  import { useI18n } from './i18n'
  import { useClient } from './support'

  const props = defineProps<{ stack: Stack }>()
  const { t } = useI18n()
  const client = useClient()

  const details = ref<StackSignIn | null>(null)
  const error = ref<unknown | null>(null)
  const sharing = computed(() => props.stack.spec?.security.mode === 'keycloak' && props.stack.spec.security.access === 'sharing')
  const consoleUsers = computed<StackSignIn['users']>(() => details.value
    ? [{ username: details.value.console.username, password: details.value.console.password, role: 'admin' }]
    : [])

  async function copy (value: string) {
    error.value = null
    try {
      await client.ui.copyText(value)
      await client.ui.notify(t('card.copied'), 'success')
    } catch (error_) {
      error.value = error_
    }
  }

  async function load () {
    error.value = null
    try {
      details.value = await client.containers.getSignIn(props.stack.id)
    } catch (error_) {
      error.value = error_
    }
  }

  onMounted(load)
</script>
