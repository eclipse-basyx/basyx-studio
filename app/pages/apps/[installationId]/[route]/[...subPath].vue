<template>
  <AppModuleView
    :installation-id="String(route.params.installationId)"
    :route="String(route.params.route)"
    :shell-key="null"
    :sub-path="subPath"
    :target-id="null"
  />
</template>

<script lang="ts" setup>
  const route = useRoute()
  const subPath = computed(() => [route.params.subPath ?? []].flat().join('/'))
</script>
