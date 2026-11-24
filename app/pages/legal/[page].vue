<template>
  <v-container class="d-flex flex-column h-100 pb-0" max-width="960">
    <div class="d-flex flex-column flex-sm-row flex-shrink-0 ga-2">
      <v-tabs
        :aria-label="t('legal.navigation')"
        class="flex-grow-1 overflow-hidden"
        :model-value="page"
        show-arrows
      >
        <v-tab
          v-for="link in hostedLinks"
          :id="`legal-tab-${link.page}`"
          :key="link.page"
          aria-controls="legal-document"
          :text="link.title"
          :to="link.to"
          :value="link.page"
        />
      </v-tabs>

      <v-btn
        class="align-self-start align-self-sm-center"
        prepend-icon="mdi-information-outline"
        :text="t('about.link')"
        to="/about"
      />
    </div>

    <div v-if="hasExternalLinks" class="d-flex flex-wrap flex-shrink-0 ga-1 py-2">
      <LegalLinks external-only />
    </div>

    <v-divider />

    <v-sheet class="flex-shrink-0" color="transparent" height="2">
      <v-progress-linear
        :active="loading"
        :aria-label="t('legal.navigation')"
        height="2"
      />
    </v-sheet>

    <article
      id="legal-document"
      :key="displayedPage"
      :aria-busy="loading"
      :aria-labelledby="`legal-tab-${page}`"
      class="flex-grow-1 overflow-y-auto py-4"
      role="tabpanel"
      tabindex="0"
    >
      <template v-if="content.error.value">
        <PageHeader :title="title" />

        <ProblemAlert :error="content.error.value" retry @retry="content.refetch()" />
      </template>

      <v-card v-else-if="!canRender || (!visibleDocument && content.isPending.value)">
        <v-skeleton-loader type="paragraph@3" />
      </v-card>

      <v-card v-else>
        <!-- Sanitised (@basyx/file-viewer/markdown): no raw HTML, no scripts,
             nothing loaded from other hosts. -->
        <v-card-text>
          <h1 v-if="!hasDocumentTitle" class="text-headline-medium mt-2 mb-4">{{ title }}</h1>

          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="text-break" v-html="html" />
        </v-card-text>
      </v-card>
    </article>
  </v-container>
</template>

<script lang="ts" setup>
  import type { LegalPage } from '#shared/branding'
  import { useQuery } from '@pinia/colada'
  import { legalPages } from '#shared/branding'

  definePageMeta({
    key: 'legal-document',
    validate: route => typeof route.params.page === 'string' && (legalPages as readonly string[]).includes(route.params.page),
  })

  interface LegalContent {
    page: LegalPage
    markdown: string | null
    url: string | null
  }

  // A legal page the deployment hosts as Markdown (ADR 0055), in the UI
  // language or the closest one. Public: the imprint and the privacy policy
  // must be readable without signing in. A page the deployment links to
  // elsewhere sends the browser there.
  const { t, locale } = useI18n()
  const route = useRoute()
  const api = useStudioApi()
  const branding = useBranding()
  const hostedLinks = computed(() => branding.legalLinks.value.filter(link => link.to))
  const hasExternalLinks = computed(() => branding.legalLinks.value.some(link => link.href))

  const page = computed(() => route.params.page as LegalPage)

  const content = useQuery({
    key: () => ['legal', page.value, locale.value],
    query: ({ signal }) => api<LegalContent>(`/legal/${page.value}`, { query: { language: locale.value }, signal }),
  })
  const loading = computed(() => content.isPending.value && content.isLoading.value)

  // Keep the last document during tab changes, including when the user
  // selects another tab before the previous request has completed.
  const visibleDocument = computed<LegalContent | undefined>(previous => content.data.value?.markdown ? content.data.value : previous)
  const displayedPage = computed(() => content.error.value ? page.value : visibleDocument.value?.page ?? page.value)
  const title = computed(() => t(`legal.pages.${displayedPage.value}`))

  // DOMPurify needs the browser's DOM. Keep the SSR fallback through hydration.
  const canRender = ref(import.meta.client && !useNuxtApp().isHydrating)
  onMounted(() => {
    canRender.value = true
  })

  // When opening the legal view, wait for the document and its renderer.
  const [, markdown] = await Promise.all([
    content.refresh(),
    import.meta.client ? import('@basyx/file-viewer/markdown') : null,
  ])
  const html = computed(() => canRender.value && markdown && visibleDocument.value?.markdown
    ? markdown.renderMarkdown(visibleDocument.value.markdown)
    : '')
  const hasDocumentTitle = computed(() => /^<h1[\s>]/.test(html.value))

  useHead(() => ({ title: `${title.value} · ${branding.name.value}` }))
  watch(() => content.data.value?.url, url => {
    if (url) {
      void navigateTo(url, { external: true })
    }
  }, { immediate: true })
</script>
