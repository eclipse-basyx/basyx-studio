<template>
  <!-- Always shown, whatever the deployment's branding (ADR 0055): users of
       a branded Studio can find the project behind it. -->
  <v-btn
    :aria-label="t('about.poweredByLabel')"
    class="text-medium-emphasis"
    size="small"
    to="/about"
  >
    <template #prepend>
      <v-img alt="" :src="basyxLogo" width="16" />
    </template>

    {{ t('about.poweredBy') }}
  </v-btn>
</template>

<script lang="ts" setup>
  import basyxLogo from '~/assets/basyx-logo.svg'

  const { t } = useI18n()
</script>
