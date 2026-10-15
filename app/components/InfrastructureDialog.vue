<template>
  <v-dialog v-model="open" :fullscreen="xs" max-width="720" scrollable>
    <DialogCard :title="existing ? t('admin.edit') : t('admin.add')">
      <!-- Sections as in the BaSyx AAS Web UI, fields 12 px apart. -->
      <v-form ref="form" class="d-flex flex-column ga-3" @submit.prevent="save">
        <v-text-field v-model="model.name" :label="t('admin.name')" :rules="[required]" />
        <v-text-field v-model="model.description" :label="t('admin.description')" />

        <v-divider />
        <div class="text-title-small">{{ t('admin.deployment') }}</div>

        <v-select
          v-model="model.template"
          :hint="t(`admin.templates.${model.template}.help`)"
          :item-props="item => ({ subtitle: t(`admin.templates.${item.value}.short`) })"
          :items="templates"
          :label="t('admin.template')"
          persistent-hint
        />

        <v-text-field
          v-for="endpointType in endpointFields"
          :key="endpointType"
          v-model="model.urls[endpointType]"
          :hint="t(`admin.endpointHints.${endpointType}`)"
          :label="t(`admin.endpointTypes.${endpointType}`)"
          persistent-hint
          :placeholder="endpointType === endpointFields[0] ? exampleUrl : undefined"
          :rules="rulesFor(endpointType)"
        />

        <v-checkbox v-model="model.allowPrivateNetwork" :label="t('admin.allowPrivateNetwork')" />

        <template v-if="registryAndRepository">
          <v-divider />
          <div class="text-title-small">{{ t('admin.listSource') }}</div>

          <div>
            <v-btn-toggle v-model="model.listSource" class="d-flex" mandatory>
              <v-btn class="flex-grow-1" :text="t('admin.listSources.registry')" value="registry" />
              <v-btn class="flex-grow-1" :text="t('admin.listSources.repository')" value="repository" />
            </v-btn-toggle>

            <div class="text-body-small text-medium-emphasis mt-2">{{ t(`admin.listSourceHelp.${model.listSource}`) }}</div>
          </div>
        </template>

        <template v-if="hasRegistry || hasDiscovery">
          <v-divider />
          <div class="text-title-small">{{ t('admin.sync') }}</div>

          <div>
            <v-checkbox v-if="hasRegistry" v-model="model.sync.serverSyncsRegistry" :label="t('admin.serverSyncsRegistry')" />
            <v-checkbox v-if="hasDiscovery" v-model="model.sync.serverSyncsDiscovery" :label="t('admin.serverSyncsDiscovery')" />
          </div>

          <template v-if="studioSyncs">
            <v-select
              v-model="model.sync.studioDefault"
              :hint="t('admin.studioDefaultHint')"
              :items="syncModeItems"
              :label="t('admin.studioDefault')"
              persistent-hint
            />

            <v-checkbox v-model="model.sync.userOverride" :label="t('admin.userOverride')" />
          </template>
        </template>

        <v-divider />
        <div class="text-title-small">{{ t('admin.ids') }}</div>

        <v-select
          v-model="model.sync.idScheme"
          :hint="t('admin.idSchemeHint')"
          :items="idSchemeItems"
          :label="t('admin.idScheme')"
          persistent-hint
        />

        <v-text-field
          v-if="model.sync.idScheme === 'iri'"
          v-model="model.sync.idPrefix"
          :label="t('admin.idPrefix')"
        />

        <v-divider />
        <div class="text-title-small">{{ t('admin.security') }}</div>

        <v-select
          v-model="model.mode"
          :hint="t(`admin.modeHelp.${model.mode}`)"
          :items="modes"
          :label="t('admin.securityMode')"
          persistent-hint
        />

        <v-alert
          v-if="model.mode === 'deployment_client_credentials'"
          density="compact"
          :text="t('admin.sharingNote')"
          type="info"
        />

        <template v-if="model.mode !== 'unsecured'">
          <v-text-field v-model="model.issuer" :label="t('admin.issuer')" :rules="[required, httpUrl]" />
          <v-text-field v-model="model.clientId" :label="t('admin.clientId')" :rules="[required]" />
          <v-text-field v-model="model.scopes" :hint="t('admin.scopesHint')" :label="t('admin.scopes')" persistent-hint />

          <v-text-field
            v-if="session.isDesktop"
            v-model="model.secretValue"
            :hint="t('admin.clientSecretValueHint')"
            :label="t('admin.clientSecretValue')"
            persistent-hint
            type="password"
          />

          <v-text-field
            v-else
            v-model="model.secretRef"
            :hint="t('admin.clientSecretRefHint')"
            :label="t('admin.clientSecretRef')"
            persistent-hint
            placeholder="env:AAS_CLIENT_SECRET"
          />

          <v-select
            v-if="model.mode === 'delegated_user'"
            v-model="model.loopbackHost"
            :hint="t('admin.loopbackHostHint')"
            :items="['127.0.0.1', 'localhost']"
            :label="t('admin.loopbackHost')"
            persistent-hint
          />
        </template>

        <v-divider />
        <div class="text-title-small">{{ t('admin.clientCertificate') }}</div>
        <div class="text-body-small text-medium-emphasis">{{ t('admin.clientCertificateHelp') }}</div>

        <v-list-item
          v-if="storedCertificate"
          border
          prepend-icon="mdi-certificate-outline"
          :subtitle="t('admin.clientCertificateIssuer', { issuer: storedCertificate.issuer, date: certificateExpiry })"
          :title="storedCertificate.subject"
        >
          <template #append>
            <v-btn
              :aria-label="t('admin.clientCertificateRemove')"
              icon="mdi-delete-outline"
              @click="model.removeCertificate = true"
            />
          </template>
        </v-list-item>

        <template v-if="session.isDesktop">
          <v-file-input
            v-model="model.certificateFile"
            accept=".p12,.pfx,application/x-pkcs12"
            :hint="t(storedCertificate ? 'admin.clientCertificateFileReplaceHint' : 'admin.clientCertificateFileHint')"
            :label="t('admin.clientCertificateFile')"
            persistent-hint
            prepend-icon=""
            prepend-inner-icon="mdi-certificate-outline"
            :rules="[certificateSize]"
          />

          <v-text-field
            v-if="model.certificateFile"
            v-model="model.certificatePassphrase"
            autocomplete="off"
            :label="t('admin.clientCertificatePassphrase')"
            type="password"
          />
        </template>

        <template v-else>
          <v-text-field
            v-model="model.certificateRef"
            :hint="t('admin.clientCertificateRefHint')"
            :label="t('admin.clientCertificateRef')"
            persistent-hint
            placeholder="file:/run/secrets/client.p12"
          />

          <v-text-field
            v-if="model.certificateRef.trim()"
            v-model="model.certificatePassphraseRef"
            :hint="t('admin.clientCertificatePassphraseRefHint')"
            :label="t('admin.clientCertificatePassphraseRef')"
            persistent-hint
            placeholder="env:CLIENT_CERTIFICATE_PASSPHRASE"
          />
        </template>

        <ProblemAlert v-if="error" :error="error" />

        <ul v-if="violations.length > 0" class="text-body-small my-0">
          <li v-for="violation in violations" :key="violation.path">{{ violation.path }}: {{ violation.message }}</li>
        </ul>
      </v-form>

      <template #actions>
        <v-btn :text="t('admin.cancel')" @click="open = false" />
        <v-btn-primary :loading="saving" :text="t('admin.save')" @click="save" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { EndpointType, Infrastructure, InfrastructureInput, InfrastructureTemplate, ListSource, SecurityMode, SyncSettings } from '#shared/contract'
  import { useDisplay } from 'vuetify'
  import { defaultSyncSettings, endpointTypes, infrastructureTemplates, maxClientCertificateLength, securityModes, serviceUrl, syncModes, templateRules } from '#shared/contract'
  import { StudioApiError } from '~/composables/useStudioApi'

  const props = defineProps<{ existing: Infrastructure | null }>()
  const emit = defineEmits<{ saved: [Infrastructure] }>()
  const open = defineModel<boolean>({ required: true })

  const { t, locale } = useI18n()
  const api = useStudioApi()
  const session = useSessionStore()
  const { xs } = useDisplay()

  const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)
  const saving = ref(false)
  const error = ref<unknown>(null)

  function emptyModel () {
    return {
      name: '',
      description: '',
      template: 'mono-all' as InfrastructureTemplate,
      urls: Object.fromEntries(endpointTypes.map(type => [type, ''])) as Record<EndpointType, string>,
      listSource: 'registry' as ListSource,
      sync: { ...defaultSyncSettings } as SyncSettings,
      allowPrivateNetwork: false,
      mode: 'unsecured' as SecurityMode,
      issuer: '',
      clientId: '',
      scopes: 'openid',
      secretRef: '',
      secretValue: '',
      loopbackHost: '127.0.0.1' as '127.0.0.1' | 'localhost',
      certificateFile: null as File | null,
      certificatePassphrase: '',
      certificateRef: '',
      certificatePassphraseRef: '',
      removeCertificate: false,
    }
  }
  const model = ref(emptyModel())

  watch(open, isOpen => {
    if (!isOpen) {
      return
    }
    error.value = null
    const existing = props.existing
    model.value = emptyModel()
    if (existing) {
      for (const endpoint of existing.endpoints) {
        model.value.urls[endpoint.type] = endpoint.url
      }
      Object.assign(model.value, {
        name: existing.name,
        description: existing.description ?? '',
        template: existing.template,
        listSource: existing.listSource,
        sync: { ...existing.sync },
        allowPrivateNetwork: existing.allowPrivateNetwork,
        mode: existing.security.mode,
      })
      if (existing.security.mode !== 'unsecured') {
        Object.assign(model.value, {
          issuer: existing.security.issuer,
          clientId: existing.security.clientId,
          scopes: existing.security.scopes.join(' '),
        })
      }
      if (existing.security.mode === 'delegated_user') {
        model.value.loopbackHost = existing.security.desktopLoopbackHost
      }
    }
  })

  const modes = computed(() => securityModes.map(mode => ({ value: mode, title: t(`security.${mode}`) })))
  const templates = computed(() => infrastructureTemplates.map(template => ({ value: template, title: t(`admin.templates.${template}.title`) })))
  const idSchemeItems = computed(() => [
    { value: 'iri', title: t('admin.idSchemes.iri') },
    { value: 'uuid', title: t('admin.idSchemes.uuid') },
  ])
  const syncModeItems = computed(() => syncModes.map(mode => ({ value: mode, title: t(`admin.syncModes.${mode}`) })))

  // A constant: vue-tsc 3.3 garbles `//` inside bound template expressions.
  const exampleUrl = 'https://aas.example.com'

  // The endpoints the template takes, and what they add up to with the current URLs.
  const endpointFields = computed(() => templateRules[model.value.template].allowed)
  const filled = computed(() => ({
    template: model.value.template,
    endpoints: endpointFields.value.filter(type => model.value.urls[type].trim()).map(type => ({ type, url: model.value.urls[type].trim() })),
  }))
  const hasRegistry = computed(() => serviceUrl(filled.value, 'aasRegistry') !== undefined || serviceUrl(filled.value, 'submodelRegistry') !== undefined)
  const hasDiscovery = computed(() => serviceUrl(filled.value, 'aasDiscovery') !== undefined)
  const registryAndRepository = computed(() => serviceUrl(filled.value, 'aasRegistry') !== undefined && serviceUrl(filled.value, 'aasRepository') !== undefined)
  const studioSyncs = computed(() => (hasRegistry.value && !model.value.sync.serverSyncsRegistry) || (hasDiscovery.value && !model.value.sync.serverSyncsDiscovery))

  /** A field is required alone, or as one of a group of alternatives (e.g. AAS repository or registry). */
  function rulesFor (type: EndpointType) {
    const group = templateRules[model.value.template].required.find(entry => entry.includes(type))
    const rules: Array<(value: string) => true | string> = [optionalHttpUrl]
    if (group?.length === 1) {
      rules.unshift(required)
    } else if (group) {
      rules.unshift(() => group.some(other => model.value.urls[other].trim()) || t('admin.oneOf', { types: group.map(other => t(`admin.endpointTypes.${other}`)).join(' / ') }))
    }
    return rules
  }
  /** The saved certificate, until it is removed or replaced. */
  const storedCertificate = computed(() => model.value.removeCertificate ? null : props.existing?.clientCertificate ?? null)

  const certificateExpiry = computed(() => storedCertificate.value
    ? new Date(storedCertificate.value.notAfter).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' })
    : '')

  // The server's limit is on the base64 text, which is a third larger than the file.
  const maxCertificateBytes = Math.floor(maxClientCertificateLength * 3 / 4)
  const certificateSize = (file: File | null) => !file || file.size <= maxCertificateBytes || t('admin.clientCertificateTooLarge')

  /** The file's content as base64, read in the renderer: the Studio Service never sees the user's file system. */
  function readBase64 (file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve(String(reader.result).replace(/^data:[^,]*,/, '')))
      reader.addEventListener('error', () => reject(reader.error))
      reader.readAsDataURL(file)
    })
  }

  /** A new certificate, `null` to remove the saved one, or `undefined` to keep it. */
  async function certificateInput (): Promise<InfrastructureInput['clientCertificate']> {
    const m = model.value
    if (session.isDesktop && m.certificateFile) {
      return { value: await readBase64(m.certificateFile), passphrase: m.certificatePassphrase }
    }
    if (!session.isDesktop && m.certificateRef.trim()) {
      return { ref: m.certificateRef.trim(), passphraseRef: m.certificatePassphraseRef.trim() || undefined }
    }
    return m.removeCertificate ? null : undefined
  }

  const violations = computed(() => error.value instanceof StudioApiError ? error.value.problem?.violations ?? [] : [])

  const required = (value: string) => !!value.trim() || 'Required'
  const httpUrl = (value: string) => /^https?:\/\/\S+$/.test(value.trim()) || 'http(s) URL required'
  const optionalHttpUrl = (value: string) => !value.trim() || httpUrl(value)

  async function toInput (): Promise<InfrastructureInput> {
    const m = model.value
    const endpoints: InfrastructureInput['endpoints'] = filled.value.endpoints
    let security: InfrastructureInput['security'] = { mode: 'unsecured' }
    if (m.mode !== 'unsecured') {
      const secret = session.isDesktop
        ? (m.secretValue ? { value: m.secretValue } : undefined)
        : (m.secretRef.trim() ? { ref: m.secretRef.trim() } : undefined)
      const oidc = {
        issuer: m.issuer.trim(),
        clientId: m.clientId.trim(),
        scopes: m.scopes.split(/\s+/).filter(Boolean),
        clientSecret: secret,
      }
      security = m.mode === 'delegated_user'
        ? { mode: 'delegated_user', ...oidc, desktopLoopbackHost: m.loopbackHost }
        : { mode: 'deployment_client_credentials', ...oidc }
    }
    return {
      name: m.name.trim(),
      description: m.description.trim() || undefined,
      template: m.template,
      endpoints,
      listSource: m.listSource,
      sync: m.sync,
      security,
      clientCertificate: await certificateInput(),
      allowPrivateNetwork: m.allowPrivateNetwork,
    }
  }

  async function save () {
    if (!(await form.value?.validate())?.valid) {
      return
    }
    saving.value = true
    error.value = null
    try {
      const existing = props.existing
      const body = await toInput()
      const saved = existing
        ? await api<Infrastructure>(`/infrastructures/${existing.id}`, {
          method: 'PUT',
          body,
          headers: { 'If-Match': `"${existing.revision}"` },
        })
        : await api<Infrastructure>('/infrastructures', { method: 'POST', body })
      emit('saved', saved)
      open.value = false
    } catch (error_) {
      error.value = error_
    } finally {
      saving.value = false
    }
  }
</script>
