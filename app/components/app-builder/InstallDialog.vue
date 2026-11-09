<template>
  <v-dialog max-width="600" :model-value="project !== null" @update:model-value="open => { if (!open) close() }">
    <v-card v-if="project" data-test="app-builder-install" :title="t('install.title', { name: project.name })">
      <v-card-text>
        <v-progress-linear v-if="!info && !error" />

        <ProblemAlert v-if="error" class="mb-4" :error="error" />

        <template v-if="info">
          <v-list>
            <v-list-item prepend-icon="mdi-identifier" :subtitle="t('install.version', { version: info.version })" :title="info.appId" />

            <v-list-item
              :prepend-icon="info.installed ? 'mdi-package-variant-closed-check' : 'mdi-package-variant-closed'"
              :subtitle="info.installed ? t(`installTrust.${info.installed.trust}`) : undefined"
              :title="info.installed ? t('install.installed', { version: info.installed.version }) : t('install.notInstalled')"
            />
          </v-list>

          <div class="text-label-large mt-2">{{ t('install.versionHeading') }}</div>

          <v-radio-group v-model="bump" data-test="app-builder-install-version" hide-details>
            <v-radio v-if="info.newVersion" :label="t('install.keep', { version: info.version })" value="none" />
            <v-radio :label="t('install.patch', { version: info.patch })" value="patch" />
            <v-radio :label="t('install.minor', { version: info.minor })" value="minor" />
          </v-radio-group>

          <div v-if="!info.newVersion" class="text-body-small text-medium-emphasis">{{ t('install.mustRaise', { version: info.installed?.version ?? '' }) }}</div>

          <div class="text-label-large mt-4">{{ t('install.signingHeading') }}</div>

          <v-radio-group v-model="signing" data-test="app-builder-install-signing" hide-details>
            <v-radio :disabled="!info.machineKeyApplies" :label="t('install.machine')" value="machine" />
            <v-radio :label="t('install.own')" value="own" />
            <v-radio :label="t('install.unsigned')" value="unsigned" />
          </v-radio-group>

          <div v-if="signing === 'machine'" class="text-body-small text-medium-emphasis mt-1">
            {{ info.machineKey ? t('install.machineKey', { fingerprint: info.machineKey.fingerprint.slice(7, 23) }) : t('install.machineKeyNew') }}
            <v-btn class="ms-1" data-test="app-builder-copy-key" :text="t('install.copyKey')" @click="copyKey" />
          </div>

          <div v-else-if="!info.machineKeyApplies" class="text-body-small text-medium-emphasis mt-1">{{ t('install.machineOnlyLocal') }}</div>

          <div v-if="signing === 'own'" class="d-flex flex-column ga-2 mt-2">
            <div class="d-flex align-center ga-2">
              <v-btn-secondary data-test="app-builder-choose-key" prepend-icon="mdi-key-outline" :text="keyName ?? t('install.chooseKey')" @click="chooseKey" />
              <span class="text-body-small text-medium-emphasis">{{ t('install.keyHint') }}</span>
            </div>

            <v-text-field
              v-model="passphrase"
              autocomplete="off"
              hide-details
              :label="t('install.passphrase')"
              type="password"
            />
          </div>

          <div v-if="signing === 'unsigned'" class="text-body-small text-medium-emphasis mt-1">{{ t('install.unsignedHint') }}</div>
        </template>
      </v-card-text>

      <template #actions>
        <v-btn-secondary :text="t('install.cancel')" @click="close" />

        <v-btn
          v-if="prepared"
          data-test="app-builder-export"
          prepend-icon="mdi-content-save-outline"
          :text="t('install.export')"
          @click="exportPackage"
        />

        <v-btn-primary
          data-test="app-builder-install-check"
          :disabled="!info || (signing === 'own' && !keyHandle)"
          :loading="checking"
          :text="t('install.check')"
          @click="check"
        />
      </template>
    </v-card>
  </v-dialog>

  <AppInstallDialog
    :inspection="inspection"
    :installation-origins="false"
    :installing="installing"
    @cancel="inspection = null"
    @install="install"
  />
</template>

<script lang="ts" setup>
  import type { AppPackageInspection, AppProject, ReleaseInfo, ReleaseSigning } from '#shared/contract'
  import { ref, watch } from 'vue'
  import { useI18n } from './i18n'

  // Installing a project's app (ADR 0054, plan B5–B8): the version, how it is
  // signed, then Studio builds it and the Apps page's consent dialog follows.
  const props = defineProps<{ project: AppProject | null }>()
  const emit = defineEmits<{ close: [], installed: [text: string] }>()
  const { t } = useI18n()
  const client = useAppBuilderClient()
  const desktop = useDesktopBridge()
  const notifications = useNotificationsStore()

  const info = ref<ReleaseInfo | null>(null)
  const error = ref<unknown>(null)
  const bump = ref<'none' | 'patch' | 'minor'>('none')
  const signing = ref<ReleaseSigning>('machine')
  const keyHandle = ref<string | null>(null)
  const keyName = ref<string | null>(null)
  const passphrase = ref('')
  const checking = ref(false)
  const installing = ref(false)
  const inspection = ref<AppPackageInspection | null>(null)
  const prepared = ref<{ digest: string, version: string } | null>(null)

  watch(() => props.project, async project => {
    info.value = null
    error.value = null
    inspection.value = null
    prepared.value = null
    keyHandle.value = null
    keyName.value = null
    passphrase.value = ''
    if (!project) {
      return
    }
    try {
      const loaded = await client.call('getReleaseInfo', { projectId: project.id })
      info.value = loaded
      bump.value = loaded.newVersion ? 'none' : 'patch'
      signing.value = loaded.machineKeyApplies ? 'machine' : 'unsigned'
    } catch (error_) {
      error.value = error_
    }
  }, { immediate: true })

  function close () {
    emit('close')
  }

  async function chooseKey () {
    if (!desktop?.chooseStackFiles) {
      return
    }
    const [grant] = await desktop.chooseStackFiles('signing-key')
    if (grant) {
      keyHandle.value = grant.handle
      keyName.value = grant.fileName
    }
  }

  async function copyKey () {
    try {
      const key = await client.call('getMachineKey', {})
      await navigator.clipboard.writeText(key.publicKey)
      notifications.notify({ text: t('install.keyCopied'), color: 'success' })
      if (info.value && !info.value.machineKey) {
        info.value = { ...info.value, machineKey: key }
      }
    } catch (error_) {
      error.value = error_
    }
  }

  async function check () {
    if (!props.project) {
      return
    }
    checking.value = true
    error.value = null
    try {
      const result = await client.call('inspectRelease', {
        projectId: props.project.id,
        bump: bump.value,
        signing: signing.value,
        ...(signing.value === 'own' && keyHandle.value ? { keyHandle: keyHandle.value } : {}),
        ...(signing.value === 'own' && passphrase.value ? { passphrase: passphrase.value } : {}),
      })
      // The key grant is used up; the version may now be raised.
      keyHandle.value = null
      keyName.value = null
      bump.value = 'none'
      info.value = await client.call('getReleaseInfo', { projectId: props.project.id })
      prepared.value = { digest: result.digest, version: result.version }
      inspection.value = result.inspection
    } catch (error_) {
      error.value = error_
    }
    checking.value = false
  }

  async function install () {
    if (!props.project || !prepared.value) {
      return
    }
    installing.value = true
    try {
      const installation = await client.call('installRelease', { projectId: props.project.id, digest: prepared.value.digest })
      inspection.value = null
      prepared.value = null
      emit('installed', t('install.done', { name: props.project.name, version: installation.version }))
    } catch (error_) {
      inspection.value = null
      error.value = error_
    }
    installing.value = false
  }

  async function exportPackage () {
    if (!props.project || !prepared.value || !desktop?.chooseStackFiles) {
      return
    }
    const [grant] = await desktop.chooseStackFiles('app-package', `${info.value?.appId ?? 'app'}-${prepared.value.version}`)
    if (!grant) {
      return
    }
    try {
      const saved = await client.call('exportRelease', { projectId: props.project.id, digest: prepared.value.digest, fileHandle: grant.handle })
      notifications.notify({ text: t('install.exported', { file: saved.fileName }), color: 'success' })
    } catch (error_) {
      error.value = error_
    }
  }
</script>
