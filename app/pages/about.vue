<template>
  <v-container max-width="960">
    <PageHeader :subtitle="t('about.subtitle')" :title="t('about.title', { name: branding.name.value })" />

    <v-row>
      <!-- This deployment: who runs it, which version, its legal pages. -->
      <v-col cols="12">
        <v-card>
          <v-card-item>
            <template #prepend>
              <v-avatar rounded="0" size="48">
                <v-img :alt="branding.name.value" height="48" :src="branding.mark.value" width="48" />
              </v-avatar>
            </template>

            <v-card-title>{{ branding.name.value }}</v-card-title>
            <v-card-subtitle v-if="product">{{ t('settings.version', { version: product.version }) }}</v-card-subtitle>
          </v-card-item>

          <v-card-text class="d-flex flex-column ga-1 text-body-medium">
            <span v-if="branding.organisation.value">{{ t('about.runBy', { organisation: branding.organisation.value }) }}</span>

            <span v-if="product?.commit || product?.buildDate" class="text-body-small text-medium-emphasis">
              {{ [product.commit ? t('settings.commit', { commit: product.commit.slice(0, 7) }) : null, product.buildDate ? t('settings.built', { date: new Date(product.buildDate).toLocaleDateString(locale) }) : null].filter(Boolean).join(' · ') }}
            </span>

            <span v-if="features?.readOnly" class="text-body-small text-medium-emphasis">{{ t('settings.readOnly') }}</span>
            <span v-if="branding.organisation.value" class="text-body-small text-medium-emphasis">© {{ branding.organisation.value }}</span>
          </v-card-text>

          <v-card-actions class="flex-wrap">
            <v-btn
              v-if="branding.supportUrl.value"
              :href="branding.supportUrl.value"
              prepend-icon="mdi-lifebuoy"
              rel="noopener noreferrer"
              target="_blank"
              :text="t('about.support')"
            />

            <v-btn
              v-if="branding.helpUrl.value"
              :href="branding.helpUrl.value"
              prepend-icon="mdi-help-circle-outline"
              rel="noopener noreferrer"
              target="_blank"
              :text="t('about.help')"
            />

            <LegalLinks />
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Eclipse BaSyx: the same in every deployment. -->
      <v-col cols="12" md="7">
        <v-card height="100%">
          <v-card-item>
            <template #prepend>
              <v-avatar rounded="0" size="48">
                <v-img alt="" height="48" :src="basyxLogo" width="48" />
              </v-avatar>
            </template>

            <v-card-title>{{ t('about.basyxTitle') }}</v-card-title>
            <v-card-subtitle>{{ t('about.poweredBy') }}</v-card-subtitle>
          </v-card-item>

          <v-card-text class="text-body-medium">
            <p class="mb-3">{{ t('about.basyxText') }}</p>
            <p class="mb-0">{{ t('about.studioText') }}</p>
          </v-card-text>

          <v-list>
            <v-list-item
              v-for="link in basyxLinks"
              :key="link.key"
              :href="link.url"
              :prepend-icon="link.icon"
              :rel="link.url.startsWith('mailto:') ? undefined : 'noopener noreferrer'"
              :subtitle="link.url.replace(/^(?:https:\/\/|mailto:)/, '').replace(/\/$/, '')"
              :target="link.url.startsWith('mailto:') ? undefined : '_blank'"
              :title="t(`about.links.${link.key}`)"
            />

            <v-list-item
              :href="studioLinks.license"
              prepend-icon="mdi-license"
              rel="noopener noreferrer"
              :subtitle="t('about.licenseText')"
              target="_blank"
              :title="t('about.license')"
            />
          </v-list>
        </v-card>
      </v-col>

      <v-col cols="12" md="5">
        <v-card class="mb-4">
          <v-card-item prepend-icon="mdi-account-group-outline">
            <v-card-title>{{ t('about.team') }}</v-card-title>
            <v-card-subtitle class="text-wrap">{{ t('about.teamSubtitle') }}</v-card-subtitle>
          </v-card-item>

          <v-list>
            <v-list-item v-for="member in basyxTeam" :key="member.name" :subtitle="member.organisation" :title="member.name">
              <template #prepend>
                <v-avatar color="primary" :text="initialsOf(member.name)" variant="tonal" />
              </template>

              <template #append>
                <v-btn
                  v-if="member.github"
                  v-tooltip="t('about.github', { name: member.name })"
                  :aria-label="t('about.github', { name: member.name })"
                  :href="member.github"
                  icon="mdi-github"
                  rel="noopener noreferrer"
                  size="small"
                  target="_blank"
                />

                <v-btn
                  v-if="member.linkedin"
                  v-tooltip="t('about.linkedin', { name: member.name })"
                  :aria-label="t('about.linkedin', { name: member.name })"
                  :href="member.linkedin"
                  icon="mdi-linkedin"
                  rel="noopener noreferrer"
                  size="small"
                  target="_blank"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card>

        <v-card>
          <v-card-item prepend-icon="mdi-domain">
            <v-card-title>{{ t('about.organisations') }}</v-card-title>
          </v-card-item>

          <v-list>
            <v-list-item
              v-for="organisation in basyxOrganisations"
              :key="organisation.name"
              append-icon="mdi-open-in-new"
              :href="organisation.url"
              rel="noopener noreferrer"
              target="_blank"
              :title="organisation.name"
            />
          </v-list>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
  import { basyxLinks, basyxOrganisations, basyxTeam, studioLinks } from '#shared/about'
  import basyxLogo from '~/assets/basyx-logo.svg'

  // About this Studio and Eclipse BaSyx (ADR 0055). Public, like the legal
  // pages: it names who runs the deployment. Nothing on it loads from other
  // hosts.
  const { t, locale } = useI18n()
  const session = useSessionStore()
  const branding = useBranding()
  const product = computed(() => session.context?.product)
  const features = computed(() => session.context?.features)

  useHead(() => ({ title: `${t('about.link')} · ${branding.name.value}` }))

  function initialsOf (name: string): string {
    const parts = name.split(/\s+/).filter(Boolean)
    return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts.at(-1)![0] : ''}`.toUpperCase()
  }
</script>
