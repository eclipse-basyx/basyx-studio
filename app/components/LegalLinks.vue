<template>
  <v-btn
    v-for="link in links"
    :key="link.page"
    :href="link.href"
    :prepend-icon="link.icon"
    :rel="link.href ? 'noopener noreferrer' : undefined"
    :target="link.href ? '_blank' : undefined"
    :text="link.title"
    :to="link.to"
  />

  <v-btn v-if="about" prepend-icon="mdi-information-outline" :text="t('about.link')" to="/about" />
</template>

<script lang="ts" setup>
  // The deployment's legal pages in the UI language (ADR 0055): external
  // pages open in a new tab, hosted ones on Studio's /legal pages, which work
  // without signing in. Nothing for pages the deployment does not have.
  const props = defineProps<{ about?: boolean, externalOnly?: boolean }>()
  const { t } = useI18n()
  const branding = useBranding()
  const links = computed(() => props.externalOnly
    ? branding.legalLinks.value.filter(link => link.href)
    : branding.legalLinks.value)
</script>
