import { connect } from '@basyx/studio-sdk'
import { createApp } from 'vue'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VCard, VCardActions, VCardText } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VDialog } from 'vuetify/components/VDialog'
import { VCol, VContainer, VRow, VSpacer } from 'vuetify/components/VGrid'
import { VIcon } from 'vuetify/components/VIcon'
import { VList, VListItem } from 'vuetify/components/VList'
import { VMain } from 'vuetify/components/VMain'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { VTextField } from 'vuetify/components/VTextField'
import { createAppVuetify, followStudioTheme } from '../../../shared/vuetify'
import App from './App.vue'

const client = await connect()
const vuetify = createAppVuetify({ VAlert, VApp, VBtn, VCard, VCardActions, VCardText, VChip, VCol, VContainer, VDialog, VIcon, VList, VListItem, VMain, VProgressLinear, VRow, VSpacer, VTextField })
followStudioTheme(vuetify, client)
createApp(App, { client }).use(vuetify).mount('#app')
