<template>
  <AppModuleView
    :installation-id="String(route.params.installationId)"
    :route="String(route.params.route)"
    :shell-key="typeof route.query.shell === 'string' ? route.query.shell : null"
    :sub-path="subPath"
    :target-id="String(route.params.targetId)"
  />
</template>

<script lang="ts" setup>
  const route = useRoute()
  const subPath = computed(() => [route.params.subPath ?? []].flat().join('/'))
</script>
