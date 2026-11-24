<template>
  <v-container max-width="960">
    <PageHeader :title="title">
      <template #actions>
        <LegalLinks about />
      </template>
    </PageHeader>

    <ProblemAlert v-if="content.error.value" :error="content.error.value" retry @retry="content.refetch()" />

    <v-card v-else-if="content.isPending.value">
      <v-skeleton-loader type="paragraph@3" />
    </v-card>

    <v-card v-else>
      <!-- Sanitised (@basyx/file-viewer/markdown): no raw HTML, no scripts,
           nothing loaded from other hosts. -->
      <v-card-text v-if="html">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="text-break" v-html="html" />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script lang="ts" setup>
  import type { LegalPage } from '#shared/branding'
  import { useQuery } from '@pinia/colada'
  import { legalPages } from '#shared/branding'

  // A legal page the deployment hosts as Markdown (ADR 0055), in the UI
  // language or the closest one. Public: the imprint and the privacy policy
  // must be readable without signing in. A page the deployment links to
  // elsewhere sends the browser there.
  const { t, locale } = useI18n()
  const route = useRoute()
  const api = useStudioApi()
  const branding = useBranding()

  const page = computed(() => String(route.params.page) as LegalPage)
  if (!(legalPages as readonly string[]).includes(page.value)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  const title = computed(() => t(`legal.pages.${page.value}`))
  useHead(() => ({ title: `${title.value} · ${branding.name.value}` }))

  const content = useQuery({
    key: () => ['legal', page.value, locale.value],
    query: ({ signal }) => api<{ markdown: string | null, url: string | null }>(`/legal/${page.value}`, { query: { language: locale.value }, signal }),
  })

  watch(() => content.data.value?.url, url => {
    if (url) {
      void navigateTo(url, { external: true })
    }
  }, { immediate: true })

  // DOMPurify needs the browser's DOM, so the page renders after hydration.
  const html = ref('')
  onMounted(() => {
    watch(() => content.data.value?.markdown, async markdown => {
      html.value = markdown ? (await import('@basyx/file-viewer/markdown')).renderMarkdown(markdown) : ''
    }, { immediate: true })
  })
</script>
