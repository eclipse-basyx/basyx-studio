<template>
  <!-- Opening a target that needs authorization goes straight to its identity
       provider. The card only shows while the desktop sign-in runs in the
       system browser, or after it failed or was cancelled. -->
  <div v-if="redirecting" class="d-flex justify-center py-16">
    <v-progress-circular :aria-label="t('target.authorizeTitle', { name: target.name })" color="primary" indeterminate />
  </div>

  <v-card v-else class="mx-auto" max-width="560">
    <v-card-item prepend-icon="mdi-account-key-outline">
      <v-card-title>{{ t('target.authorizeTitle', { name: target.name }) }}</v-card-title>
    </v-card-item>

    <v-card-text>
      <p class="my-0">{{ waiting ? t('target.waitingForBrowser') : t('target.authorizeText') }}</p>
      <ProblemAlert v-if="error ?? returnedError" class="mt-4" :error="error ?? returnedError" />
    </v-card-text>

    <v-card-actions class="px-4 pb-4">
      <!-- While waiting, it opens the sign-in again, e.g. after the browser tab was closed. -->
      <v-btn-primary
        :loading="starting"
        prepend-icon="mdi-login"
        :text="t('target.authorize')"
        @click="authorize"
      />

      <v-btn v-if="waiting" :text="t('target.cancel')" @click="stopWaiting" />
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { AuthorizationStart, Target } from '#shared/contract'
  import { StudioApiError } from '~/composables/useStudioApi'

  const props = defineProps<{ target: Target }>()
  const emit = defineEmits<{ authorized: [] }>()

  const { t } = useI18n()
  const route = useRoute()
  const api = useStudioApi()

  // A failed authorization returns here with `authError`; starting it again
  // right away would loop, so the card shows the error and waits.
  const authError = typeof route.query.authError === 'string' ? route.query.authError : null
  const returnedError = authError
    ? new StudioApiError({
      type: 'about:blank',
      title: 'Authorization failed',
      status: 400,
      code: authError === 'access_denied' ? 'forbidden' : 'target_auth_required',
      requestId: '-',
      retryable: false,
    })
    : null

  const redirecting = ref(authError === null)
  const starting = ref(false)
  const waiting = ref(false)
  const error = ref<unknown>(null)
  let poll: ReturnType<typeof setInterval> | undefined
  let deadline = 0

  function stopWaiting () {
    clearInterval(poll)
    poll = undefined
    waiting.value = false
  }

  // Desktop: the IdP login runs in the system browser and calls back to the
  // local service; this page polls until the target is authorized.
  function waitForExternalCompletion () {
    waiting.value = true
    deadline = Date.now() + 5 * 60_000
    poll = setInterval(async () => {
      if (Date.now() > deadline) {
        stopWaiting()
        return
      }
      const target = await api<Target>(`/targets/${props.target.id}`).catch(() => null)
      if (target?.authenticationState === 'authenticated') {
        stopWaiting()
        emit('authorized')
      }
    }, 2000)
  }

  async function authorize () {
    stopWaiting()
    starting.value = true
    error.value = null
    try {
      const start = await api<AuthorizationStart>(`/targets/${props.target.id}/authorization`, {
        method: 'POST',
        body: { returnTo: route.fullPath.replace(/[?&]authError=[^&]*/, '') },
      })
      if (start.mode === 'external') {
        window.open(start.authorizationUrl, '_blank', 'noopener')
        redirecting.value = false
        waitForExternalCompletion()
      } else {
        window.location.assign(start.authorizationUrl)
      }
    } catch (error_) {
      redirecting.value = false
      error.value = error_
    } finally {
      starting.value = false
    }
  }

  onMounted(() => {
    if (redirecting.value) {
      void authorize()
    }
  })
  onBeforeUnmount(stopWaiting)
</script>
