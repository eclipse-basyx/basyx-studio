<template>
  <v-container>
    <PageHeader :subtitle="t('apps.subtitle')" :title="t('apps.title')">
      <template #actions>
        <v-btn
          v-tooltip="t('common.close')"
          :aria-label="t('common.close')"
          icon="mdi-close"
          @click="panel.close()"
        />
      </template>
    </PageHeader>

    <ProblemAlert
      v-if="list.error.value"
      class="mb-4"
      :error="list.error.value"
      retry
      @retry="list.refetch()"
    />

    <v-progress-linear v-if="list.isPending.value" />

    <template v-else-if="list.data.value">
      <v-alert v-if="!list.data.value.enabled" class="mb-4" :text="t('apps.disabled')" type="info" />

      <v-alert v-else-if="!appChanges" class="mb-4" :text="t('apps.installsFixed')" type="info" />

      <v-alert v-else-if="!canInstall" class="mb-4" :text="t('apps.unsignedDisabled')" type="info" />

      <v-card v-else class="mb-4" :subtitle="installHint" :title="t('apps.install')">
        <v-card-text>
          <div class="d-flex flex-wrap align-center ga-4">
            <v-file-input
              v-model="file"
              accept=".zip,application/zip"
              class="flex-grow-1"
              :disabled="checking"
              hide-details
              :label="t('apps.package')"
              prepend-icon="mdi-folder-zip-outline"
            />

            <v-file-input
              v-model="signatureFile"
              accept=".sig,.bundle,.json"
              class="flex-grow-1"
              :disabled="checking"
              hide-details
              :label="t('apps.signature')"
              prepend-icon="mdi-file-certificate-outline"
            />

            <v-btn-primary
              :disabled="!file"
              :loading="checking"
              prepend-icon="mdi-download"
              :text="t('apps.install')"
              @click="inspect"
            />
          </div>

          <v-alert
            v-if="installed"
            class="mt-4"
            closable
            :text="installed"
            type="success"
            @click:close="installed = null"
          />

          <template v-if="installError">
            <ProblemAlert class="mt-4" :error="installError" />

            <v-list v-if="findings.length > 0">
              <v-list-subheader>{{ t('apps.findings') }}</v-list-subheader>

              <v-list-item
                v-for="finding in findings"
                :key="`${finding.path}:${finding.message}`"
                prepend-icon="mdi-alert-circle-outline"
                :subtitle="finding.message"
                :title="finding.path"
              />
            </v-list>
          </template>
        </v-card-text>
      </v-card>

      <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

      <v-card>
        <template v-if="items.length > 0">
          <ListFilterBar
            v-model:search="search"
            v-model:selected="selected"
            :groups="filterGroups"
            :placeholder="t('apps.search')"
          />

          <v-divider />
        </template>

        <v-list-records v-if="filtered.length > 0">
          <template v-for="(item, index) in filtered" :key="item.id">
            <v-divider v-if="index > 0" />

            <RecordListItem icon="mdi-puzzle-outline">
              <!-- As the infrastructure rows: small chips with tooltips on the
                   title line, the permissions as text. -->
              <template #title>
                <div class="d-flex flex-wrap align-center ga-1">
                  <span class="me-1">{{ label(item.title) }}</span>

                  <v-chip
                    v-if="item.revoked"
                    v-tooltip="t(`apps.revokedHint.${item.revoked}`)"
                    color="error"
                    prepend-icon="mdi-shield-off-outline"
                    size="x-small"
                    :text="t('apps.revoked')"
                  />

                  <v-chip
                    v-else-if="item.verifiedPublisher"
                    v-tooltip="t('apps.signedHint', { publisher: item.verifiedPublisher })"
                    color="success"
                    prepend-icon="mdi-shield-check-outline"
                    size="x-small"
                    :text="item.verifiedPublisher"
                  />

                  <v-chip
                    v-if="item.trust === 'unsigned'"
                    v-tooltip="t('apps.unsignedHint')"
                    color="warning"
                    prepend-icon="mdi-alert-outline"
                    size="x-small"
                    :text="t('apps.unsigned')"
                  />

                  <v-chip
                    v-if="item.managed"
                    v-tooltip="item.trust === 'managed' ? t('apps.managedUnsignedHint') : t('apps.managedHint')"
                    prepend-icon="mdi-cog-outline"
                    size="x-small"
                    :text="t('apps.managed')"
                  />

                  <v-chip
                    v-if="item.bundled"
                    v-tooltip="t('apps.bundledHint')"
                    prepend-icon="mdi-check-decagram-outline"
                    size="x-small"
                    :text="t('apps.bundled')"
                  />

                  <v-chip
                    v-if="missingSettings(item).length > 0"
                    v-tooltip="t('apps.settings.missingHint', { list: missingSettings(item).map(setting => label(setting.title)).join(', ') })"
                    color="warning"
                    prepend-icon="mdi-tune-variant"
                    size="x-small"
                    :text="t('apps.settings.missing')"
                  />

                  <v-chip
                    v-if="item.backend"
                    v-tooltip="t('apps.backendHint')"
                    prepend-icon="mdi-server"
                    size="x-small"
                    :text="t('apps.backend')"
                  />
                </div>
              </template>

              <v-list-item-subtitle>
                {{ t('apps.by', { publisher: item.publisher }) }} · {{ item.appId }} ·
                {{ t('apps.submodelViews', item.submodelViews) }} · {{ t('apps.modules', item.modules) }}
              </v-list-item-subtitle>

              <v-list-item-subtitle v-if="item.permissions.length > 0">
                {{ t('apps.permissions', { list: item.permissions.map(permission => permissionLabel(permission)).join(', ') }) }}
              </v-list-item-subtitle>

              <v-list-item-subtitle v-if="item.revoked" class="text-error">
                {{ t(`apps.revokedHint.${item.revoked}`) }}
              </v-list-item-subtitle>

              <v-list-item-subtitle v-if="item.sandbox.webAssembly || item.sandbox.workers">
                {{ t('apps.sandbox', { list: [item.sandbox.webAssembly && t('apps.sandboxWebAssembly'), item.sandbox.workers && t('apps.sandboxWorkers')].filter(Boolean).join(', ') }) }}
              </v-list-item-subtitle>

              <!-- Services it calls through Studio where an administrator binds them (ADR 0047). -->
              <v-list-item-subtitle v-if="item.connections.length > 0" v-tooltip="t('apps.connectionsNote')">
                {{ t('apps.connections', { list: item.connections.map(connection => `${label(connection.title)} (${t('apps.operations', connection.operations.length)})`).join(', ') }) }}
              </v-list-item-subtitle>

              <!-- Values an administrator sets here or per infrastructure (ADR 0048). -->
              <v-list-item-subtitle v-if="item.settings.length > 0">
                {{ t('apps.settings.list', { list: item.settings.map(setting => label(setting.title)).join(', ') }) }}
              </v-list-item-subtitle>

              <!-- Third-party origins with the data-egress note (ADR 0045). -->
              <v-list-item-subtitle v-if="originsOf(item).length > 0" v-tooltip="t('apps.egressNote')">
                {{ originKinds.filter(kind => item.sandbox[kind].length > 0).map(kind => `${t(`apps.originKind.${kind}`)} ${item.sandbox[kind].join(', ')}`).join(' · ') }}
              </v-list-item-subtitle>

              <template #meta>
                <span class="text-body-small text-medium-emphasis text-no-wrap">{{ item.version }}</span>
              </template>

              <template #actions>
                <v-btn
                  v-if="item.settings.length > 0"
                  v-tooltip="t('apps.settings.edit')"
                  :aria-label="t('apps.settings.edit')"
                  icon="mdi-tune-variant"
                  @click="editSettings(item)"
                />

                <v-btn
                  v-if="!item.bundled && !item.managed && appChanges"
                  v-tooltip="t('apps.uninstall')"
                  :aria-label="t('apps.uninstall')"
                  icon="mdi-delete-outline"
                  @click="confirmUninstall = item"
                />
              </template>
            </RecordListItem>
          </template>
        </v-list-records>

        <v-card-text v-else-if="items.length > 0" class="text-medium-emphasis">{{ t('lists.noMatches') }}</v-card-text>

        <v-card-text v-else class="text-medium-emphasis">{{ t('apps.noApps') }}</v-card-text>
      </v-card>
    </template>

    <AppInstallDialog
      :inspection="inspection"
      :installation-origins="Boolean(list.data.value?.installationOrigins)"
      :installing="installing"
      @cancel="inspection = null"
      @install="install"
    />

    <v-dialog max-width="560" :model-value="editing !== null" @update:model-value="editing = null">
      <DialogCard v-if="editing" :title="t('apps.settings.title', { name: label(editing.title) })">
        <v-form ref="settingsForm" class="d-flex flex-column ga-3" @submit.prevent>
          <div class="text-body-small text-medium-emphasis">{{ t('apps.settings.help') }}</div>

          <AppSettingField
            v-for="setting in editing.settings"
            :key="setting.key"
            v-model="settingsValues[setting.key]"
            :fallback="setting.default"
            level="installation"
            :setting="setting"
          />

          <ProblemAlert v-if="settingsError" :error="settingsError" />

          <ul v-if="settingsViolations.length > 0" class="text-body-small my-0">
            <li v-for="violation in settingsViolations" :key="violation.path">{{ violation.path }}: {{ violation.message }}</li>
          </ul>
        </v-form>

        <template #actions>
          <v-btn :text="t('apps.cancel')" @click="editing = null" />
          <v-btn-primary :loading="savingSettings" :text="t('apps.settings.save')" @click="saveSettings" />
        </template>
      </DialogCard>
    </v-dialog>

    <v-dialog max-width="480" :model-value="confirmUninstall !== null" @update:model-value="confirmUninstall = null">
      <DialogCard :title="t('apps.uninstall')">
        {{ t('apps.uninstallConfirm', { name: confirmUninstall ? label(confirmUninstall.title) : '' }) }}

        <template #actions>
          <v-btn :text="t('apps.cancel')" @click="confirmUninstall = null" />
          <v-btn-primary color="error" :text="t('apps.uninstall')" @click="uninstall" />
        </template>
      </DialogCard>
    </v-dialog>
  </v-container>
</template>

<script lang="ts" setup>
  import type { AppInstallation, AppInstallationList, AppPackageInspection, AppPermission, AppSettingSummary, SandboxOriginKind } from '#shared/contract'
  import type { SettingFormValues } from '~/utils/app-settings'
  import type { FilterGroup } from '~/utils/records'
  import { useQuery } from '@pinia/colada'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { hasSettingValue, settingFormOf, settingValuesOf } from '~/utils/app-settings'
  import { filterRecords } from '~/utils/records'

  const { t } = useI18n()
  const session = useSessionStore()
  /** Whether the deployment lets administrators install and remove apps (STUDIO_APPS_ALLOW_INSTALL). */
  const appChanges = computed(() => session.context?.features.appInstalls ?? true)
  const api = useStudioApi()
  const invalidate = useInvalidate()
  const label = useLocalizedLabel()
  const panel = usePanel()

  const list = useQuery({
    key: ['admin', 'apps'],
    query: ({ signal }) => api<AppInstallationList>('/app-installations', { signal }),
  })

  const items = computed(() => list.data.value?.items ?? [])
  const search = ref<string | null>(null)
  const selected = ref<string[]>([])

  /** Signed packages of trusted publishers, or unsigned ones in developer mode. */
  const canInstall = computed(() => Boolean(list.data.value && (list.data.value.allowUnsigned || list.data.value.trustedPublishers.length > 0)))

  const installHint = computed(() => {
    const data = list.data.value
    if (!data || data.trustedPublishers.length === 0) {
      return t('apps.installHint')
    }
    const publishers = data.trustedPublishers.join(', ')
    return data.allowUnsigned ? t('apps.installHintSignedOrUnsigned', { publishers }) : t('apps.installHintSigned', { publishers })
  })

  const filterGroups = computed<FilterGroup[]>(() => [{
    title: t('apps.filters'),
    options: [
      { value: 'source:bundled', title: t('apps.bundled'), icon: 'mdi-check-decagram-outline' },
      { value: 'source:managed', title: t('apps.managed'), icon: 'mdi-cog-outline' },
      { value: 'source:uploaded', title: t('apps.uploaded'), icon: 'mdi-upload-outline' },
      { value: 'trust:signed', title: t('apps.signed'), icon: 'mdi-shield-check-outline' },
      { value: 'trust:unsigned', title: t('apps.unsigned'), icon: 'mdi-alert-outline' },
      { value: 'trust:revoked', title: t('apps.revoked'), icon: 'mdi-shield-off-outline' },
      { value: 'backend:yes', title: t('apps.backend'), icon: 'mdi-server' },
    ].filter(option => items.value.some(item => facetsOf(item).includes(option.value))),
  }])

  function facetsOf (item: AppInstallation): string[] {
    let source = 'source:uploaded'
    if (item.bundled) {
      source = 'source:bundled'
    } else if (item.managed) {
      source = 'source:managed'
    }
    return [
      source,
      ...(item.trust === 'signed' ? ['trust:signed'] : []),
      ...(item.trust === 'unsigned' ? ['trust:unsigned'] : []),
      ...(item.revoked ? ['trust:revoked'] : []),
      ...(item.backend ? ['backend:yes'] : []),
    ]
  }

  const filtered = computed(() => filterRecords(items.value, search.value, selected.value, item => ({
    text: [label(item.title), item.publisher, item.verifiedPublisher ?? '', item.appId],
    facets: facetsOf(item),
  })))

  function permissionLabel (permission: AppPermission): string {
    return t(`apps.permission.${permission.replaceAll('.', '_')}`)
  }

  /** The third-party origins a manifest declares (ADR 0045), in the order of the kinds. */
  const originKinds: SandboxOriginKind[] = ['frameOrigins', 'connectOrigins', 'imageOrigins', 'mediaOrigins']
  function originsOf (app: Pick<AppInstallation, 'sandbox'>): Array<{ kind: SandboxOriginKind, origin: string }> {
    return originKinds.flatMap(kind => app.sandbox[kind].map(origin => ({ kind, origin })))
  }

  const file = ref<File | null>(null)
  const signatureFile = ref<File | null>(null)
  const checking = ref(false)
  const installing = ref(false)
  const inspection = ref<AppPackageInspection | null>(null)
  const installed = ref<string | null>(null)
  const installError = ref<unknown>(null)
  const actionError = ref<unknown>(null)
  const confirmUninstall = ref<AppInstallation | null>(null)

  const findings = computed(() => installError.value instanceof StudioApiError ? (installError.value.problem?.violations ?? []) : [])

  async function refresh () {
    // Open views and modules of every page depend on the installed apps, and on their settings.
    await invalidate(['admin', 'apps'], ['app-contributions'], ['app-context'])
  }

  /**
   * Required settings without a value that applies everywhere: neither the
   * installation's nor a default. Infrastructures may still set
   * `infrastructure` ones (ADR 0048).
   */
  function missingSettings (item: AppInstallation): AppSettingSummary[] {
    return item.settings.filter(setting => setting.required && !hasSettingValue(item.settingValues[setting.key]) && !hasSettingValue(setting.default))
  }

  const editing = ref<AppInstallation | null>(null)
  const settingsValues = ref<SettingFormValues>({})
  const settingsForm = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)
  const savingSettings = ref(false)
  const settingsError = ref<unknown>(null)
  const settingsViolations = computed(() => settingsError.value instanceof StudioApiError ? (settingsError.value.problem?.violations ?? []) : [])

  function editSettings (item: AppInstallation) {
    settingsError.value = null
    settingsValues.value = settingFormOf(item.settings, item.settingValues)
    editing.value = item
  }

  /** Saves the installation's values; Studio refuses values the settings do not accept. */
  async function saveSettings () {
    const item = editing.value
    if (!item || !(await settingsForm.value?.validate())?.valid) {
      return
    }
    savingSettings.value = true
    settingsError.value = null
    try {
      await api(`/app-installations/${item.id}/settings`, { method: 'PUT', body: { values: settingValuesOf(settingsValues.value) } })
      editing.value = null
      await refresh()
    } catch (error) {
      settingsError.value = error
    } finally {
      savingSettings.value = false
    }
  }

  /** The `.sig` file's content for the header: a base64 signature, or a Sigstore bundle on one line. */
  async function signatureHeader (): Promise<Record<string, string>> {
    if (!signatureFile.value) {
      return {}
    }
    const text = (await signatureFile.value.text()).trim()
    let value = text.replaceAll(/\s+/g, '')
    if (text.startsWith('{')) {
      try {
        value = JSON.stringify(JSON.parse(text))
      } catch {
        // Studio reports what is wrong with it.
      }
    }
    return { 'Studio-App-Signature': value }
  }

  /** The bytes and signature Studio checked; the confirmation installs exactly these. */
  let inspected: { body: ArrayBuffer, headers: Record<string, string> } | null = null
  /** Counts inspections, so the answer to an outdated one is dropped. */
  let inspections = 0

  // Another file invalidates what was checked and shown for consent.
  watch([file, signatureFile], () => {
    inspections++
    inspected = null
    inspection.value = null
  })

  /** Step one (ADR 0044): Studio checks the package and says what installing it does. */
  async function inspect () {
    if (!file.value) {
      return
    }
    const run = ++inspections
    checking.value = true
    installed.value = null
    installError.value = null
    try {
      const payload = { body: await file.value.arrayBuffer(), headers: { 'Content-Type': 'application/zip', ...await signatureHeader() } }
      const result = await api<AppPackageInspection>('/app-installations', { method: 'POST', query: { inspect: 'true' }, ...payload })
      if (run === inspections) {
        inspected = payload
        inspection.value = result
      }
    } catch (error) {
      if (run === inspections) {
        installError.value = error
      }
    } finally {
      checking.value = false
    }
  }

  /** Step two: install, or update in place, after the administrator confirmed. */
  async function install () {
    const checked = inspection.value
    const payload = inspected
    if (!checked || !payload) {
      return
    }
    installing.value = true
    try {
      const installation = await api<AppInstallation>('/app-installations', { method: 'POST', ...payload })
      installed.value = t(checked.update ? 'apps.updated' : 'apps.installed', { name: label(installation.title), version: installation.version })
      file.value = null
      signatureFile.value = null
      await refresh()
    } catch (error) {
      installError.value = error
    } finally {
      installing.value = false
      inspected = null
      inspection.value = null
    }
  }

  async function uninstall () {
    const item = confirmUninstall.value
    confirmUninstall.value = null
    if (!item) {
      return
    }
    actionError.value = null
    try {
      await api(`/app-installations/${item.id}`, { method: 'DELETE' })
      await refresh()
    } catch (error) {
      actionError.value = error
    }
  }
</script>
