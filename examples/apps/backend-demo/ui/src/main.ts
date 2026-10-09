import { connect } from '@basyx/studio-sdk'
import { createApp } from 'vue'
import { VAlert } from 'vuetify/components/VAlert'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VCard, VCardText } from 'vuetify/components/VCard'
import { VChip } from 'vuetify/components/VChip'
import { VContainer } from 'vuetify/components/VGrid'
import { VMain } from 'vuetify/components/VMain'
import { createAppVuetify, followStudioTheme } from '../../../shared/vuetify'
import App from './App.vue'

const client = await connect()
const vuetify = createAppVuetify({ VAlert, VApp, VBtn, VCard, VCardText, VChip, VContainer, VMain })
followStudioTheme(vuetify, client)
createApp(App, { client }).use(vuetify).mount('#app')
