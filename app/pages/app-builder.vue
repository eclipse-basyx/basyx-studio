<template>
  <AppBuilderApp v-if="session.isDesktop" />

  <v-container v-else>
    <PageHeader :title="t('nav.appBuilder')" />

    <v-empty-state
      icon="mdi-monitor-off"
      :text="t('nav.appBuilderDesktopOnly')"
      :title="t('nav.appBuilder')"
    />
  </v-container>
</template>

<script lang="ts" setup>
  import AppBuilderApp from '~/components/app-builder/App.vue'

  const { t } = useI18n()
  const session = useSessionStore()
</script>
