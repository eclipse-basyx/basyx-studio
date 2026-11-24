<template>
  <v-container class="pa-4 pa-sm-6" max-width="1200">
    <PageHeader :subtitle="t('about.subtitle')" :title="t('about.title', { name: branding.name.value })" />

    <v-card class="mb-6 pa-5 pa-sm-6">
      <div class="d-flex align-center ga-4">
        <v-img
          :alt="branding.name.value"
          class="flex-grow-0"
          eager
          height="56"
          :src="branding.mark.value"
          width="56"
        />

        <div>
          <h2 class="text-title-large my-0">{{ branding.name.value }}</h2>
          <p v-if="buildDetails.length > 0" class="text-body-small text-medium-emphasis mt-1 mb-0">{{ buildDetails.join(' · ') }}</p>
        </div>
      </div>

      <div v-if="branding.organisation.value || features?.readOnly" class="d-flex flex-wrap align-center ga-3 mt-4 text-body-medium">
        <span v-if="branding.organisation.value">{{ t('about.runBy', { organisation: branding.organisation.value }) }}</span>
        <span v-if="branding.organisation.value" class="text-medium-emphasis">© {{ branding.organisation.value }}</span>
        <span v-if="features?.readOnly">{{ t('settings.readOnly') }}</span>
      </div>

      <v-divider v-if="hasDeploymentLinks" class="mt-4 mb-2" />

      <div v-if="hasDeploymentLinks" class="d-flex flex-wrap align-center ga-1">
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
      </div>
    </v-card>

    <v-card class="mb-8">
      <div class="pa-5 pa-sm-6">
        <div class="d-flex flex-wrap justify-space-between align-center ga-2 mb-3">
          <h2 class="text-headline-small my-0">{{ t('about.basyxTitle') }}</h2>
          <PoweredByBasyx project />
        </div>

        <p class="text-body-large my-0">{{ t('about.basyxText') }}</p>
        <p class="text-body-medium text-medium-emphasis mt-2 mb-4">{{ t('about.studioText') }}</p>

        <div class="d-flex flex-wrap ga-2">
          <component
            :is="index === 0 ? 'VBtnPrimary' : 'VBtnSecondary'"
            v-for="(link, index) in featuredLinks"
            :key="link.key"
            :href="link.url"
            :prepend-icon="link.icon"
            rel="noopener noreferrer"
            target="_blank"
            :text="t(`about.links.${link.key}`)"
          />
        </div>
      </div>

      <v-divider />

      <v-sheet class="px-5 px-sm-6 py-4" color="surface-light">
        <v-row>
          <v-col v-for="group in linkGroups" :key="group.title" cols="12" sm="4">
            <h3 class="text-title-small font-weight-semibold mt-0 mb-1">{{ t(group.title) }}</h3>

            <v-list>
              <v-list-item
                v-for="link in group.links"
                :key="link.url"
                :href="link.url"
                :prepend-icon="link.icon"
                :rel="link.external ? 'noopener noreferrer' : undefined"
                :target="link.external ? '_blank' : undefined"
              >
                <template #title>
                  <span class="text-wrap">{{ t(link.label) }}</span>
                </template>
              </v-list-item>
            </v-list>
          </v-col>
        </v-row>
      </v-sheet>
    </v-card>

    <section aria-labelledby="about-team" class="mb-8">
      <h2 id="about-team" class="text-headline-small mt-0 mb-1">{{ t('about.team') }}</h2>
      <p class="text-body-medium text-medium-emphasis mt-0 mb-4">{{ t('about.teamSubtitle') }}</p>

      <v-row>
        <v-col
          v-for="member in basyxTeam"
          :key="member.name"
          cols="12"
          lg="3"
          sm="6"
        >
          <v-card class="d-flex flex-column pa-4" height="100%">
            <div class="d-flex align-center ga-3">
              <v-avatar v-if="member.photo" size="52">
                <v-img alt="" cover :src="studioUrl.page(`/about-assets/people/${member.photo}`)" />
              </v-avatar>

              <v-avatar
                v-else
                color="primary"
                size="52"
                :text="initialsOf(member.name)"
                variant="tonal"
              />

              <div>
                <h3 class="text-title-medium my-0">{{ member.name }}</h3>
                <p class="text-body-small text-medium-emphasis my-0">{{ member.organisation }}</p>
              </div>
            </div>

            <a class="text-primary text-body-small text-break mt-3" :href="`mailto:${member.email}`">{{ member.email }}</a>

            <div class="d-flex ga-1 mt-3">
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
            </div>
          </v-card>
        </v-col>
      </v-row>
    </section>

    <section aria-labelledby="about-organisations">
      <h2 id="about-organisations" class="text-headline-small mt-0 mb-4">{{ t('about.organisations') }}</h2>

      <v-row>
        <v-col
          v-for="organisation in basyxOrganisations"
          :key="organisation.name"
          cols="6"
          lg="3"
          sm="4"
        >
          <v-card
            class="d-flex flex-column align-center text-center ga-3 pa-3 pa-sm-4"
            height="100%"
            :href="organisation.url"
            rel="noopener noreferrer"
            target="_blank"
          >
            <v-sheet
              class="w-100 d-flex align-center justify-center px-2"
              :color="mode === 'dark' && organisation.logo.light === organisation.logo.dark ? 'white' : 'transparent'"
              height="72"
              max-width="156"
              rounded="sm"
            >
              <v-img
                alt=""
                height="60"
                :src="studioUrl.page(`/about-assets/organisations/${organisation.logo[mode]}`)"
              />
            </v-sheet>

            <span class="text-body-small d-flex align-center justify-center ga-1">
              {{ organisation.name }}
              <v-icon aria-hidden="true" icon="mdi-open-in-new" size="14" />
            </span>
          </v-card>
        </v-col>
      </v-row>
    </section>
  </v-container>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'
  import { basyxLinks, basyxOrganisations, basyxTeam, studioLinks } from '#shared/about'

  const { t, locale } = useI18n()
  const session = useSessionStore()
  const branding = useBranding()
  const studioUrl = useStudioUrl()
  const theme = useTheme()
  const mode = computed(() => theme.current.value.dark ? 'dark' : 'light')
  const product = computed(() => session.context?.product)
  const features = computed(() => session.context?.features)
  const hasDeploymentLinks = computed(() => Boolean(branding.supportUrl.value || branding.helpUrl.value || branding.legalLinks.value.length > 0))
  const buildDetails = computed(() => {
    const info = product.value
    return [
      info && t('settings.version', { version: info.version }),
      info?.commit && t('settings.commit', { commit: info.commit.slice(0, 7) }),
      info?.buildDate && t('settings.built', { date: new Date(info.buildDate).toLocaleDateString(locale.value) }),
    ].filter(Boolean)
  })

  const featuredLinks = basyxLinks.filter(link => link.group === 'featured')
  const projectLinks = basyxLinks.filter(link => link.group === 'project' || link.group === 'community').map(link => ({
    ...link,
    label: `about.links.${link.key}`,
    external: !link.url.startsWith('mailto:'),
  }))
  const linkGroups = [
    { title: 'about.projectResources', links: projectLinks.filter(link => link.group === 'project') },
    { title: 'about.community', links: projectLinks.filter(link => link.group === 'community') },
    {
      title: 'about.licences',
      links: [
        { label: 'about.licenseText', url: studioLinks.license, icon: 'mdi-license', external: true },
        { label: 'about.thirdPartyNotices', url: studioUrl.page('/third-party-notices.txt'), icon: 'mdi-file-document-outline', external: false },
      ],
    },
  ]

  useHead(() => ({ title: `${t('about.link')} · ${branding.name.value}` }))

  function initialsOf (name: string): string {
    const parts = name.split(/\s+/).filter(Boolean)
    return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts.at(-1)![0] : ''}`.toUpperCase()
  }
</script>
