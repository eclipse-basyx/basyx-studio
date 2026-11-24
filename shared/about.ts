// The About page's facts about Eclipse BaSyx (ADR 0055): the developer team,
// the organisations behind BaSyx and the project's channels. Kept here, apart
// from the page, so updating the team needs no change to the UI. Everyone
// listed agreed to it; their links are public profiles. No photos are
// loaded from other hosts: avatars show initials, so opening the page sends
// nothing to GitHub or LinkedIn.

export interface TeamMember {
  name: string
  organisation: string
  github?: string
  linkedin?: string
}

/** The BaSyx developer team, as on go.basyx.org. */
export const basyxTeam: readonly TeamMember[] = [
  { name: 'Tagline Treichel', organisation: 'Fraunhofer IESE', github: 'https://github.com/ttreichel', linkedin: 'https://www.linkedin.com/in/tagline-treichel/' },
  { name: 'Frank Schnicke', organisation: 'Fraunhofer IESE', github: 'https://github.com/FrankSchnicke', linkedin: 'https://www.linkedin.com/in/frank-schnicke' },
  { name: 'Aaron Zielstorff', organisation: 'Fraunhofer IESE', github: 'https://github.com/aaronzi', linkedin: 'https://www.linkedin.com/in/aaron-zielstorff' },
  { name: 'Jannik Oliver Fried', organisation: 'Fraunhofer IESE', github: 'https://github.com/FriedJannik', linkedin: 'https://www.linkedin.com/in/friedjannik/' },
  { name: 'Christoph Antes', organisation: 'Fraunhofer IESE', github: 'https://github.com/antesch' },
  { name: 'Martin Stemmer', organisation: 'Fraunhofer IESE', github: 'https://github.com/Martin187187', linkedin: 'https://www.linkedin.com/in/martin-stemmer/' },
  { name: 'Christian Koort', organisation: 'Fraunhofer IESE', github: 'https://github.com/christian-koort', linkedin: 'https://www.linkedin.com/in/christian-koort/' },
]

export interface Organisation {
  name: string
  url: string
}

/** Organisations involved in BaSyx, as the BaSyx Web UI lists them. */
export const basyxOrganisations: readonly Organisation[] = [
  { name: 'Fraunhofer IESE', url: 'https://www.iese.fraunhofer.de/' },
  { name: 'Industrial Digital Twin Association (IDTA)', url: 'https://industrialdigitaltwin.org/' },
  { name: 'HTW Berlin', url: 'https://www.htw-berlin.de/' },
  { name: 'DFKI', url: 'https://www.dfki.de/' },
  { name: 'HARTING Technology Group', url: 'https://www.harting.com/' },
  { name: 'ARENA2036', url: 'https://arena2036.de/' },
  { name: 'Roche', url: 'https://www.roche.com/' },
]

export interface ProjectLink {
  /** Key of the link's label in `about.links`. */
  key: 'website' | 'basyxOrg' | 'go' | 'wiki' | 'github' | 'docker' | 'mail' | 'openHour'
  icon: string
  url: string
}

/** Where to find Eclipse BaSyx. */
export const basyxLinks: readonly ProjectLink[] = [
  { key: 'website', icon: 'mdi-web', url: 'https://eclipse.dev/basyx/' },
  { key: 'basyxOrg', icon: 'mdi-web', url: 'https://basyx.org/' },
  { key: 'go', icon: 'mdi-language-go', url: 'https://go.basyx.org/' },
  { key: 'wiki', icon: 'mdi-book-open-variant-outline', url: 'https://wiki.basyx.org/' },
  { key: 'github', icon: 'mdi-github', url: 'https://github.com/eclipse-basyx' },
  { key: 'docker', icon: 'mdi-docker', url: 'https://hub.docker.com/u/eclipsebasyx' },
  { key: 'mail', icon: 'mdi-email-outline', url: 'mailto:basyx-dev@eclipse.org' },
  { key: 'openHour', icon: 'mdi-calendar-clock-outline', url: 'https://www.iese.fraunhofer.de/en/customers_industries/digitalisierung-produktion/industrie40/basyx_open_hour.html' },
]

/** Studio's source code and its licence. */
export const studioLinks = {
  source: 'https://github.com/eclipse-basyx/basyx-studio',
  license: 'https://github.com/eclipse-basyx/basyx-studio/blob/main/LICENSE.md',
} as const
