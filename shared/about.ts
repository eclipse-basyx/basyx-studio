// The About page's facts about Eclipse BaSyx (ADR 0055): the developer team,
// the organisations behind BaSyx and the project's channels. Kept here, apart
// from the page, so updating the team needs no change to the UI. Photos
// and logos ship in public/about-assets with their source notices.

export interface TeamMember {
  name: string
  organisation: string
  email: string
  photo?: string
  github?: string
  linkedin?: string
}

/** The BaSyx developer team, as on go.basyx.org. */
export const basyxTeam: readonly TeamMember[] = [
  { name: 'Aaron Zielstorff', organisation: 'Fraunhofer IESE', email: 'Aaron.Zielstorff@iese.fraunhofer.de', photo: 'aaron-zielstorff.jpg', github: 'https://github.com/aaronzi', linkedin: 'https://www.linkedin.com/in/aaron-zielstorff' },
  { name: 'Jannik Oliver Fried', organisation: 'Fraunhofer IESE', email: 'Jannik.Fried@iese.fraunhofer.de', photo: 'jannik-fried.jpg', github: 'https://github.com/FriedJannik', linkedin: 'https://www.linkedin.com/in/friedjannik/' },
  { name: 'Frank Schnicke', organisation: 'Fraunhofer IESE', email: 'Frank.Schnicke@iese.fraunhofer.de', photo: 'frank-schnicke.jpg', github: 'https://github.com/FrankSchnicke', linkedin: 'https://www.linkedin.com/in/frank-schnicke' },
  { name: 'Tagline Treichel', organisation: 'Fraunhofer IESE', email: 'Tagline.Treichel@iese.fraunhofer.de', github: 'https://github.com/ttreichel', linkedin: 'https://www.linkedin.com/in/tagline-treichel/' },
  { name: 'Martin Stemmer', organisation: 'Fraunhofer IESE', email: 'Martin.Stemmer@iese.fraunhofer.de', photo: 'martin-stemmer.jpeg', github: 'https://github.com/Martin187187', linkedin: 'https://www.linkedin.com/in/martin-stemmer/' },
  { name: 'Christoph Antes', organisation: 'Fraunhofer IESE', email: 'Christoph.Antes@iese.fraunhofer.de', github: 'https://github.com/antesch' },
  { name: 'Christian Koort', organisation: 'Fraunhofer IESE', email: 'Christian.Koort@iese.fraunhofer.de', github: 'https://github.com/christian-koort', linkedin: 'https://www.linkedin.com/in/christian-koort/' },
]

export interface Organisation {
  name: string
  url: string
  logo: { light: string, dark: string }
}

/** Organisations involved in BaSyx, as the BaSyx Web UI lists them. */
export const basyxOrganisations: readonly Organisation[] = [
  { name: 'Fraunhofer IESE', url: 'https://www.iese.fraunhofer.de/', logo: { light: 'IESE_Logo_light.svg', dark: 'IESE_Logo_dark.svg' } },
  { name: 'Industrial Digital Twin Association (IDTA)', url: 'https://industrialdigitaltwin.org/', logo: { light: 'IDTA_Logo.png', dark: 'IDTA_Logo.png' } },
  { name: 'HTW Berlin', url: 'https://www.htw-berlin.de/', logo: { light: 'HTW_Logo_light.svg', dark: 'HTW_Logo_dark.svg' } },
  { name: 'DFKI', url: 'https://www.dfki.de/', logo: { light: 'DFKI_Logo_light.png', dark: 'DFKI_Logo_dark.png' } },
  { name: 'HARTING Technology Group', url: 'https://www.harting.com/', logo: { light: 'HARTING_Logo_light.png', dark: 'HARTING_Logo_dark.png' } },
  { name: 'ARENA2036', url: 'https://arena2036.de/', logo: { light: 'ARENA2036_Logo_light.svg', dark: 'ARENA2036_Logo_dark.svg' } },
  { name: 'Roche', url: 'https://www.roche.com/', logo: { light: 'Roche_Logo.svg', dark: 'Roche_Logo.svg' } },
]

export interface ProjectLink {
  /** Key of the link's label in `about.links`. */
  key: 'website' | 'basyxOrg' | 'go' | 'wiki' | 'github' | 'docker' | 'mail' | 'openHour'
  group: 'featured' | 'project' | 'community'
  icon: string
  url: string
}

export const basyxWebsite = 'https://basyx.org/'

/** Where to find Eclipse BaSyx. */
export const basyxLinks: readonly ProjectLink[] = [
  { key: 'website', group: 'project', icon: 'mdi-web', url: 'https://eclipse.dev/basyx/' },
  { key: 'basyxOrg', group: 'project', icon: 'mdi-web', url: basyxWebsite },
  { key: 'go', group: 'project', icon: 'mdi-language-go', url: 'https://go.basyx.org/' },
  { key: 'wiki', group: 'featured', icon: 'mdi-book-open-variant-outline', url: 'https://wiki.basyx.org/' },
  { key: 'github', group: 'featured', icon: 'mdi-github', url: 'https://github.com/eclipse-basyx' },
  { key: 'docker', group: 'project', icon: 'mdi-docker', url: 'https://hub.docker.com/u/eclipsebasyx' },
  { key: 'mail', group: 'community', icon: 'mdi-email-outline', url: 'mailto:basyx-dev@eclipse.org' },
  { key: 'openHour', group: 'community', icon: 'mdi-calendar-clock-outline', url: 'https://www.iese.fraunhofer.de/en/customers_industries/digitalisierung-produktion/industrie40/basyx_open_hour.html' },
]

/** Studio's source code and its licence. */
export const studioLinks = {
  source: 'https://github.com/eclipse-basyx/basyx-studio',
  license: 'https://github.com/eclipse-basyx/basyx-studio/blob/main/LICENSE.md',
} as const
