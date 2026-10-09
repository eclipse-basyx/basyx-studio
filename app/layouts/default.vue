<template>
  <v-app>
    <v-app-bar>
      <template #prepend>
        <v-btn :active="false" class="text-none" to="/">
          <template #prepend>
            <v-img :alt="t('app.name')" :src="basyxLogo" width="28" />
          </template>

          <span class="text-title-medium font-weight-bold">{{ t('app.name') }}</span>
        </v-btn>
      </template>

      <div v-if="!session.needsLogin" class="d-flex ga-1 ms-4">
        <v-btn exact prepend-icon="mdi-database-search-outline" :text="t('app.browse')" to="/" />

        <v-btn
          v-if="session.isAdmin"
          prepend-icon="mdi-server-network"
          :text="t('app.infrastructures')"
          to="/admin/infrastructures"
        />

        <v-btn
          v-if="session.isAdmin"
          prepend-icon="mdi-puzzle-outline"
          :text="t('app.apps')"
          to="/admin/apps"
        />

        <v-menu v-if="moduleLinks.length > 0">
          <template #activator="{ props }">
            <v-btn v-bind="props" append-icon="mdi-menu-down" prepend-icon="mdi-view-grid-plus-outline" :text="t('app.appModules')" />
          </template>

          <v-list density="compact" min-width="220">
            <v-list-item
              v-for="link in moduleLinks"
              :key="link.key"
              :prepend-icon="link.icon"
              :title="link.title"
              :to="link.to"
            />
          </v-list>
        </v-menu>
      </div>

      <template #append>
        <v-btn :aria-label="t('app.toggleTheme')" icon="mdi-theme-light-dark" @click="theme.cycle()" />

        <v-menu v-if="session.session">
          <template #activator="{ props }">
            <v-btn v-bind="props" class="me-2 text-none">
              <template #prepend>
                <v-avatar color="primary" size="28" :text="initials" />
              </template>
              {{ session.isDesktop ? t('app.localUser') : session.session.user.name }}
            </v-btn>
          </template>

          <v-list density="compact" min-width="220">
            <v-list-item
              :subtitle="session.isAdmin ? t('app.administrator') : undefined"
              :title="session.session.user.name"
            />

            <template v-if="!session.isDesktop">
              <v-divider />
              <v-list-item prepend-icon="mdi-logout" :title="t('app.signOut')" @click="session.logout()" />
            </template>
          </v-list>
        </v-menu>
      </template>
    </v-app-bar>

    <v-main>
      <slot />
    </v-main>

    <v-snackbar-queue v-model="notifications.queue" />
  </v-app>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'
  import basyxLogo from '~/assets/basyx-logo.svg'

  const { t } = useI18n()
  const theme = useTheme()
  const session = useSessionStore()
  const notifications = useNotificationsStore()
  const route = useRoute()
  const label = useLocalizedLabel()

  // Modules of installed apps, for the current context (MVP-3): global ones
  // always, target ones inside a target, shell ones while a shell is open.
  const contributions = useAppContributions()
  const moduleLinks = computed(() => {
    const targetId = typeof route.params.targetId === 'string' ? route.params.targetId : null
    const shellKey = typeof route.params.shellKey === 'string'
      ? route.params.shellKey
      : (typeof route.query.shell === 'string' ? route.query.shell : null)
    return (contributions.data.value?.modules ?? []).flatMap(module => {
      const path = `apps/${module.installationId}/${module.route}`
      let to: string | { path: string, query: Record<string, string> }
      if (module.context === 'global') {
        to = `/${path}`
      } else if (targetId && (module.context === 'target' || shellKey)) {
        to = module.context === 'shell' ? { path: `/targets/${targetId}/${path}`, query: { shell: shellKey! } } : `/targets/${targetId}/${path}`
      } else {
        return []
      }
      return [{ key: `${module.installationId}:${module.id}`, title: label(module.title), icon: module.icon ?? 'mdi-puzzle-outline', to }]
    })
  })

  const initials = computed(() => {
    const name = session.isDesktop ? t('app.localUser') : (session.session?.user.name ?? '')
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('')
  })
</script>
