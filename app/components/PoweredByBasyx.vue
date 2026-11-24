<template>
  <v-btn
    :aria-label="t('about.poweredByLabel')"
    :href="project ? basyxWebsite : undefined"
    :rel="project ? 'noopener noreferrer' : undefined"
    :size="project ? 'x-large' : undefined"
    :target="project ? '_blank' : undefined"
    :to="project ? undefined : '/about'"
  >
    <v-img
      alt=""
      eager
      :height="project ? 46 : 34"
      :src="poweredByLogo"
      :width="project ? 138 : 102"
    />
  </v-btn>
</template>

<script lang="ts" setup>
  import { basyxWebsite } from '#shared/about'
  import poweredByLogo from '~/assets/powered-by-basyx.svg'

  defineProps<{ project?: boolean }>()
  const { t } = useI18n()
</script>
