<template>
  <v-app>
    <v-main>
      <v-container fluid>
        <v-progress-linear v-if="loading" />

        <v-alert v-else-if="loadError" :text="loadError" type="error" />

        <template v-else-if="submodel">
          <div class="d-flex align-center ga-4 mb-4">
            <v-icon color="primary" icon="mdi-card-account-details-outline" size="40" />

            <div>
              <div class="text-h5" data-test="designation">{{ textOf('ManufacturerProductDesignation') || textOf('ManufacturerProductType') }}</div>
              <div class="text-subtitle-1 text-medium-emphasis">{{ textOf('ManufacturerName') }}</div>
            </div>

            <v-spacer />

            <v-chip v-for="marking in markings" :key="marking" prepend-icon="mdi-check-decagram-outline" :text="marking" />
          </div>

          <v-alert
            v-if="notice"
            class="mb-4"
            closable
            data-test="notice"
            :text="notice.text"
            :type="notice.type"
            @click:close="notice = null"
          />

          <v-row>
            <v-col v-for="group in groups" :key="group.title" cols="12" md="6">
              <v-card :title="group.title">
                <v-list density="compact">
                  <v-list-item
                    v-for="item in group.fields"
                    :key="item.path"
                    :data-field="item.path"
                    :subtitle="item.label"
                    :title="item.text || '—'"
                  >
                    <template v-if="canEdit && item.editable" #append>
                      <v-btn :aria-label="`Edit ${item.label}`" icon="mdi-pencil-outline" size="small" @click="startEdit(item)" />
                    </template>
                  </v-list-item>
                </v-list>
              </v-card>
            </v-col>
          </v-row>
        </template>
      </v-container>
    </v-main>

    <v-dialog max-width="480" :model-value="draft !== null" @update:model-value="draft = null">
      <v-card v-if="draft" :title="`Edit ${draft.field.label}`">
        <v-card-text>
          <v-text-field v-model="draft.value" autofocus :label="draft.field.label" />

          <v-alert
            v-if="draft.error"
            class="mt-2"
            data-test="edit-error"
            :text="draft.error"
            type="warning"
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn text="Cancel" @click="draft = null" />
          <v-btn-primary :loading="saving" text="Save" @click="save" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<script lang="ts" setup>
  import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onMounted, ref } from 'vue'
  import { humanize, langText } from '../../../shared/vuetify'

  const props = defineProps<{ client: StudioClient }>()

  interface Field {
    path: string
    label: string
    text: string
    editable: boolean
  }

  const productFields = [
    'ManufacturerProductRoot', 'ManufacturerProductFamily', 'ManufacturerProductType', 'OrderCodeOfManufacturer',
    'ProductArticleNumberOfManufacturer', 'SerialNumber', 'YearOfConstruction', 'DateOfManufacture',
    'HardwareVersion', 'FirmwareVersion', 'SoftwareVersion', 'CountryOfOrigin', 'URIOfTheProduct',
  ]
  const addressFields = ['Street', 'Zipcode', 'CityTown', 'NationalCode', 'CountryCode']

  const loading = ref(true)
  const loadError = ref<string | null>(null)
  const submodel = ref<JsonObject | null>(null)
  const notice = ref<{ type: 'success' | 'warning' | 'error', text: string } | null>(null)
  const draft = ref<{ field: Field, value: string, revision: string, error: string | null } | null>(null)
  const saving = ref(false)

  const context = ref(props.client.context)
  props.client.onContext(value => (context.value = value))
  const canEdit = computed(() => context.value.target?.write ?? false)
  const elements = computed(() => (submodel.value?.submodelElements ?? []) as JsonObject[])

  function child (parent: JsonObject[] | undefined, idShort: string): JsonObject | undefined {
    return parent?.find(element => element.idShort === idShort)
  }

  function field (parent: JsonObject[] | undefined, prefix: string, idShort: string): Field | null {
    const element = child(parent, idShort)
    if (!element) {
      return null
    }
    return {
      path: `${prefix}${idShort}`,
      label: humanize(idShort),
      text: langText(element.value, context.value.locale),
      editable: element.modelType === 'Property',
    }
  }

  function textOf (idShort: string): string {
    return langText(child(elements.value, idShort)?.value, context.value.locale)
  }

  const groups = computed(() => {
    const address = child(elements.value, 'AddressInformation')?.value as JsonObject[] | undefined
    return [
      { title: 'Product', fields: productFields.map(name => field(elements.value, '', name)).filter(item => item !== null) },
      { title: 'Manufacturer address', fields: addressFields.map(name => field(address, 'AddressInformation.', name)).filter(item => item !== null) },
    ].filter(group => group.fields.length > 0)
  })

  const markings = computed(() => ((child(elements.value, 'Markings')?.value ?? []) as JsonObject[])
    .map(marking => langText(child(marking.value as JsonObject[], 'MarkingName')?.value, context.value.locale))
    .filter(Boolean))

  function describe (error: unknown): string {
    if (!(error instanceof StudioError)) {
      return String(error)
    }
    switch (error.code) {
      case 'revision_conflict': {
        return 'Someone else changed this value in the meantime. Close the dialog and try again.'
      }
      case 'target_forbidden': {
        return 'You are not permitted to change this value.'
      }
      default: {
        return error.message
      }
    }
  }

  async function load () {
    loading.value = true
    try {
      submodel.value = await props.client.aas.getSubmodel(context.value.submodel!.id)
    } catch (error) {
      loadError.value = describe(error)
    } finally {
      loading.value = false
    }
  }

  async function startEdit (target: Field) {
    notice.value = null
    try {
      // Read the element again for the revision the write is based on.
      const snapshot = await props.client.aas.getElement(context.value.submodel!.id, target.path)
      draft.value = { field: target, value: String(snapshot.value.value ?? ''), revision: snapshot.revision, error: null }
    } catch (error) {
      notice.value = { type: 'error', text: describe(error) }
    }
  }

  async function save () {
    const current = draft.value
    if (!current) {
      return
    }
    saving.value = true
    try {
      await props.client.aas.setElementValue({ submodelId: context.value.submodel!.id, idShortPath: current.field.path, value: current.value, revision: current.revision })
      draft.value = null
      notice.value = { type: 'success', text: `${current.field.label} saved.` }
      await props.client.ui.notify(`${current.field.label} saved.`, 'success')
      await load()
    } catch (error) {
      // The draft stays, as in Studio's own editor.
      current.error = describe(error)
    } finally {
      saving.value = false
    }
  }

  onMounted(load)
</script>
