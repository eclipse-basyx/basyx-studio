import { mountApp } from '@basyx/studio-app-kit'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VCard, VCardItem, VCardSubtitle, VCardText, VCardTitle } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VDivider } from 'vuetify/components/VDivider'
import { VCol, VRow, VSpacer } from 'vuetify/components/VGrid'
import { VIcon } from 'vuetify/components/VIcon'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VSheet } from 'vuetify/components/VSheet'
import { VTable } from 'vuetify/components/VTable'
import { VTextField } from 'vuetify/components/VTextField'
import { VTooltip } from 'vuetify/components/VTooltip'
import App from './App.vue'

await mountApp(App, {
  VAlert,
  VApp,
  VBtn,
  VCard,
  VCardItem,
  VCardSubtitle,
  VCardText,
  VCardTitle,
  VChip,
  VCol,
  VDivider,
  VIcon,
  VProgressLinear,
  VRow,
  VSheet,
  VSpacer,
  VTable,
  VTextField,
  VTooltip,
})
