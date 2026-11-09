<template>
  <v-dialog max-width="560" :model-value="inspection !== null" @update:model-value="emit('cancel')">
    <DialogCard v-if="inspection" :title="t(inspection.update ? 'apps.updateTitle' : 'apps.installTitle', { name: label(inspection.title), version: inspection.version })">
      <v-alert
        v-if="inspection.verifiedPublisher"
        class="mb-4"
        :text="t('apps.verified', { publisher: inspection.verifiedPublisher })"
        type="success"
      />

      <v-alert
        v-else
        class="mb-4"
        :text="t('apps.unsignedConsent')"
        type="warning"
      />

      <v-alert
        v-if="inspection.update"
        class="mb-4"
        :text="t('apps.updateInPlace', { version: inspection.update.version })"
        type="info"
      />

      <v-list>
        <v-list-item
          prepend-icon="mdi-identifier"
          :subtitle="t('apps.by', { publisher: inspection.publisher })"
          :title="inspection.appId"
        />

        <v-list-subheader>{{ t('apps.requests') }}</v-list-subheader>

        <v-list-item
          v-for="permission in inspection.permissions"
          :key="permission"
          prepend-icon="mdi-key-outline"
          :title="permissionLabel(permission)"
        >
          <template #append>
            <div class="d-flex ga-1">
              <v-chip
                v-if="inspection.update?.permissionsAdded.includes(permission)"
                color="warning"
                size="x-small"
                :text="t('apps.new')"
              />

              <v-chip
                v-if="reservedPermissions.includes(permission) && !inspection.grantedPermissions.includes(permission)"
                v-tooltip="t('apps.notGrantedHint')"
                size="x-small"
                :text="t('apps.notGranted')"
              />
            </div>
          </template>
        </v-list-item>

        <v-list-item
          v-for="flag in sandboxFlags(inspection)"
          :key="flag"
          prepend-icon="mdi-cube-outline"
          :title="t(flag === 'webAssembly' ? 'apps.sandboxWebAssembly' : 'apps.sandboxWorkers')"
        >
          <template v-if="inspection.update?.sandboxAdded.includes(flag)" #append>
            <v-chip color="warning" size="x-small" :text="t('apps.new')" />
          </template>
        </v-list-item>

        <v-list-item
          v-for="entry in originsOf(inspection)"
          :key="`${entry.kind}:${entry.origin}`"
          :prepend-icon="originIcons[entry.kind]"
          :subtitle="t(`apps.originKind.${entry.kind}`)"
          :title="entry.origin"
        >
          <template v-if="inspection.update?.originsAdded.some(added => added.kind === entry.kind && added.origin === entry.origin)" #append>
            <v-chip color="warning" size="x-small" :text="t('apps.new')" />
          </template>
        </v-list-item>

        <template v-for="connection in inspection.connections" :key="`connection:${connection.id}`">
          <v-list-item prepend-icon="mdi-api" :subtitle="t('apps.connectionHint', { id: connection.id })" :title="label(connection.title)" />

          <v-list-item
            v-for="operation in connection.operations"
            :key="`${connection.id}:${operation.operationId}`"
            class="ps-14"
            :subtitle="operation.summary ?? operation.operationId"
            :title="`${operation.method} ${operation.path}`"
          >
            <template v-if="inspection.update?.operationsAdded.some(added => added.connection === connection.id && added.operationId === operation.operationId)" #append>
              <v-chip color="warning" size="x-small" :text="t('apps.new')" />
            </template>
          </v-list-item>
        </template>

        <v-list-item v-if="inspection.remoteCode" prepend-icon="mdi-code-braces" :title="t('apps.remoteCode')" />

        <v-list-item v-if="inspection.backend" prepend-icon="mdi-server" :title="t('apps.backendHint')">
          <template v-if="inspection.update?.backendAdded" #append>
            <v-chip color="warning" size="x-small" :text="t('apps.new')" />
          </template>
        </v-list-item>

        <v-list-item
          v-if="inspection.permissions.length === 0 && !inspection.backend && sandboxFlags(inspection).length === 0 && originsOf(inspection).length === 0 && inspection.connections.length === 0"
          prepend-icon="mdi-check"
          :title="t('apps.requestsNothing')"
        />
      </v-list>

      <p v-if="inspection.update && inspection.update.permissionsRemoved.length > 0" class="text-body-medium text-medium-emphasis mt-4">
        {{ t('apps.permissionsRemoved', { list: inspection.update.permissionsRemoved.map(permission => permissionLabel(permission)).join(', ') }) }}
      </p>

      <p v-if="inspection.update && inspection.update.originsRemoved.length > 0" class="text-body-medium text-medium-emphasis mt-4">
        {{ t('apps.originsRemoved', { list: inspection.update.originsRemoved.map(entry => entry.origin).join(', ') }) }}
      </p>

      <p v-if="inspection.update && inspection.update.operationsRemoved.length > 0" class="text-body-medium text-medium-emphasis mt-4">
        {{ t('apps.operationsRemoved', { list: inspection.update.operationsRemoved.map(entry => entry.operationId).join(', ') }) }}
      </p>

      <!-- Settings grant nothing: they are shown, with what an update changes (ADR 0048). -->
      <v-list v-if="inspection.settings.length > 0">
        <v-list-subheader>{{ t('apps.settings.declared') }}</v-list-subheader>

        <v-list-item
          v-for="setting in inspection.settings"
          :key="`setting:${setting.key}`"
          prepend-icon="mdi-tune-variant"
          :subtitle="`${setting.key} · ${t(`apps.settings.types.${setting.type}`)} · ${t(`apps.settings.scopes.${setting.scope}`)}`"
          :title="label(setting.title)"
        >
          <template v-if="inspection.update?.settingsAdded.includes(setting.key) || inspection.update?.settingsChanged.includes(setting.key)" #append>
            <v-chip size="x-small" :text="inspection.update?.settingsAdded.includes(setting.key) ? t('apps.new') : t('apps.settings.changed')" />
          </template>
        </v-list-item>
      </v-list>

      <p v-if="inspection.update && inspection.update.settingsRemoved.length > 0" class="text-body-medium text-medium-emphasis mt-4">
        {{ t('apps.settings.removed', { list: inspection.update.settingsRemoved.join(', ') }) }}
      </p>

      <p v-if="inspection.update && inspection.update.valuesDropped.length > 0" class="text-body-medium text-medium-emphasis mt-4">
        {{ t('apps.settings.dropped', { list: inspection.update.valuesDropped.join(', ') }) }}
      </p>

      <v-alert
        v-if="inspection.connections.length > 0"
        class="mt-4"
        :text="t('apps.connectionsNote')"
        type="info"
      />

      <v-alert
        v-if="originsOf(inspection).length > 0"
        class="mt-4"
        :text="t('apps.egressNote')"
        type="info"
      />

      <v-alert
        v-if="inspection.sandbox.frameOrigins.length > 0 && !installationOrigins"
        class="mt-4"
        :text="t('apps.framesOpaque')"
        type="warning"
      />

      <template #actions>
        <v-btn :text="t('apps.cancel')" @click="emit('cancel')" />
        <v-btn-primary :loading="installing" :text="t(inspection.update ? 'apps.update' : 'apps.confirmInstall')" @click="emit('install')" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { AppInstallation, AppPackageInspection, AppPermission, SandboxOriginKind } from '#shared/contract'

  // What installing or updating an app package means, for the user's
  // consent (ADR 0044): its publisher, permissions, origins, connections and
  // settings, with what an update adds. The Apps page and the App Builder
  // (ADR 0054) show the same dialog.
  defineProps<{
    inspection: AppPackageInspection | null
    installing: boolean
    /** Whether each installation has an origin of its own (ADR 0045). */
    installationOrigins: boolean
  }>()
  const emit = defineEmits<{ cancel: [], install: [] }>()

  const { t } = useI18n()
  const label = useLocalizedLabel()

  /** Permissions that need more than the manifest: the trust store has to grant them (ADR 0044). */
  const reservedPermissions: AppPermission[] = ['studio.timeseries.read']

  function permissionLabel (permission: AppPermission): string {
    return t(`apps.permission.${permission.replaceAll('.', '_')}`)
  }

  function sandboxFlags (inspection: AppPackageInspection): Array<'webAssembly' | 'workers'> {
    return (['webAssembly', 'workers'] as const).filter(flag => inspection.sandbox[flag])
  }

  /** The third-party origins a manifest declares (ADR 0045), in the order of the kinds. */
  const originKinds: SandboxOriginKind[] = ['frameOrigins', 'connectOrigins', 'imageOrigins', 'mediaOrigins']
  const originIcons: Record<SandboxOriginKind, string> = {
    frameOrigins: 'mdi-application-outline',
    connectOrigins: 'mdi-swap-horizontal',
    imageOrigins: 'mdi-image-outline',
    mediaOrigins: 'mdi-play-box-outline',
  }

  function originsOf (app: Pick<AppInstallation, 'sandbox'>): Array<{ kind: SandboxOriginKind, origin: string }> {
    return originKinds.flatMap(kind => app.sandbox[kind].map(origin => ({ kind, origin })))
  }
</script>
