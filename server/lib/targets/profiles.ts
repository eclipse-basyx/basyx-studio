import type { EndpointType, InfrastructureTemplate, ServiceProfiles, ServiceType } from '#shared/contract'
import { templateRules } from '#shared/contract'

// Optional server features, as announced in the `/description` profiles
// (MVP-4 plan, I6). Studio offers a feature only where a server announces it,
// because BaSyx Go is not the only possible backend.

/** Submodels as they were at a point in time (IDTA-01002-3, Submodel Repository SSP-007), any 3.x API version. */
const submodelHistory = /^https:\/\/admin-shell\.io\/aas\/API\/3\/\d+\/SubmodelRepositoryServiceSpecification\/SSP-007$/
/** The BaSyx Event Feed (`/events`), until the AAS API publishes event profiles. */
const eventFeed = /^https:\/\/basyx\.org\/aas\/API\/3\/\d+\/EventFeed\/1\.\d+$/
/**
 * Query operations (IDTA-01002-3: AAS Registry SSP-004, AAS Repository
 * SSP-003, Submodel Repository SSP-005), or the BaSyx profiles of version 3.2
 * and later that include them, as the BaSyx AAS Web UI detects them.
 */
const queryProfiles = {
  aasRegistry: [/^https:\/\/admin-shell\.io\/aas\/API\/3\/\d+\/AssetAdministrationShellRegistryServiceSpecification\/SSP-004$/, basyxQuery('AssetAdministrationShellRegistryServiceSpecification')],
  aasRepository: [/^https:\/\/admin-shell\.io\/aas\/API\/3\/\d+\/AssetAdministrationShellRepositoryServiceSpecification\/SSP-003$/, basyxQuery('AssetAdministrationShellRepositoryServiceSpecification')],
  submodelRepository: [/^https:\/\/admin-shell\.io\/aas\/API\/3\/\d+\/SubmodelRepositoryServiceSpecification\/SSP-005$/, basyxQuery('SubmodelRepositoryService')],
  // The IDTA query profile of the concept description repository (SSP-003), or BaSyx 3.2 and later.
  conceptDescriptionRepository: [/^https:\/\/admin-shell\.io\/aas\/API\/3\/\d+\/ConceptDescriptionRepositoryServiceSpecification\/SSP-003$/, basyxQuery('ConceptDescriptionRepositoryService')],
} as const

function basyxQuery (service: string): RegExp {
  // 3.2 and later: minor 2-9 of major 3, or a later major.
  return new RegExp(String.raw`^https:\/\/basyx\.org\/aas\/API\/(?:3\/(?:[2-9]|\d{2,})|[4-9]\/\d+)\/${service}\/`)
}

/** BaSyx relationship-based access control (`$access`). */
const rebac = /^https:\/\/basyx\.org\/aas\/API\/3\/\d+\/RelationshipBasedAccessControl\/1\.\d+$/

interface ProfiledInfrastructure {
  template: InfrastructureTemplate
  endpoints: ReadonlyArray<{ type: EndpointType }>
  serviceProfiles: ServiceProfiles
}

/** The endpoint that serves a service type: its own, else the AAS environment where the template lets it. */
function servingEndpoint (infrastructure: ProfiledInfrastructure, type: ServiceType): EndpointType | null {
  if (infrastructure.endpoints.some(endpoint => endpoint.type === type)) {
    return type
  }
  const environment = infrastructure.endpoints.some(endpoint => endpoint.type === 'aasEnvironment')
  return environment && templateRules[infrastructure.template].environmentServes.includes(type) ? 'aasEnvironment' : null
}

function announces (infrastructure: ProfiledInfrastructure, type: ServiceType, ...profiles: RegExp[]): boolean {
  const endpoint = servingEndpoint(infrastructure, type)
  return endpoint !== null && (infrastructure.serviceProfiles[endpoint] ?? []).some(entry => profiles.some(profile => profile.test(entry)))
}

export interface AnnouncedFeatures {
  /** Submodels can be read as they were at a point in time. */
  history: boolean
  /** The shell's and its submodels' changes can be read. */
  changeFeed: boolean
  /** Access to shells can be granted (ReBAC). */
  rebac: boolean
  /** Query endpoints of the services. */
  query: { aasRegistry: boolean, aasRepository: boolean, submodelRepository: boolean, conceptDescriptionRepository: boolean }
}

export function announcedFeatures (infrastructure: ProfiledInfrastructure): AnnouncedFeatures {
  return {
    history: announces(infrastructure, 'submodelRepository', submodelHistory),
    changeFeed: announces(infrastructure, 'aasRepository', eventFeed) || announces(infrastructure, 'submodelRepository', eventFeed),
    rebac: announces(infrastructure, 'aasRepository', rebac),
    query: {
      aasRegistry: announces(infrastructure, 'aasRegistry', ...queryProfiles.aasRegistry),
      aasRepository: announces(infrastructure, 'aasRepository', ...queryProfiles.aasRepository),
      submodelRepository: announces(infrastructure, 'submodelRepository', ...queryProfiles.submodelRepository),
      conceptDescriptionRepository: announces(infrastructure, 'conceptDescriptionRepository', ...queryProfiles.conceptDescriptionRepository),
    },
  }
}
