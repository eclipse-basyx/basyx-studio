<template>
  <v-table density="compact">
    <thead>
      <tr>
        <th class="w-25" scope="col">{{ t('signIn.user') }}</th>
        <th class="w-25" scope="col">{{ t('signIn.role') }}</th>
        <th scope="col">{{ t('signIn.password') }}</th>
      </tr>
    </thead>

    <tbody>
      <tr v-for="user in users" :key="user.username" :data-test="`credential-${user.username}`">
        <td class="text-mono">{{ user.username }}</td>
        <td>{{ t(roleKeys[user.role]) }}</td>

        <td>
          <div class="d-flex align-center ga-1">
            <span class="text-mono" data-test="password">{{ shown.has(user.username) ? user.password : '••••••••••••' }}</span>

            <v-btn-group>
              <v-btn
                v-tooltip="t(shown.has(user.username) ? 'signIn.hidePassword' : 'signIn.showPassword', { user: user.username })"
                :aria-label="t(shown.has(user.username) ? 'signIn.hidePassword' : 'signIn.showPassword', { user: user.username })"
                :aria-pressed="shown.has(user.username)"
                data-test="toggle-password"
                :icon="shown.has(user.username) ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
                @click="toggle(user.username)"
              />

              <v-btn
                v-tooltip="t('signIn.copyPassword', { user: user.username })"
                :aria-label="t('signIn.copyPassword', { user: user.username })"
                icon="mdi-content-copy"
                @click="emit('copy', user.password)"
              />
            </v-btn-group>
          </div>
        </td>
      </tr>
    </tbody>
  </v-table>
</template>

<script lang="ts" setup>
  import type { StackSignIn } from '@basyx/studio-sdk'
  import { reactive } from 'vue'
  import { useI18n } from './i18n'

  defineProps<{ users: StackSignIn['users'] }>()
  const emit = defineEmits<{ copy: [password: string] }>()
  const { t } = useI18n()
  const shown = reactive(new Set<string>())
  const roleKeys = { admin: 'signIn.roleAdmin', viewer: 'signIn.roleViewer', user: 'signIn.roleUser' } as const

  function toggle (username: string) {
    if (shown.has(username)) {
      shown.delete(username)
    } else {
      shown.add(username)
    }
  }
</script>
