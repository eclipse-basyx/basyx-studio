import type { EndpointInput, InfrastructureTemplate, ListSource, SecuritySummary, ServiceProfiles } from '#shared/contract'
import { describe, expect, it } from 'vitest'
import { liveCapabilities, workspaceCapabilities } from '~~/server/lib/targets/capabilities'
import { infrastructureInputSchema, serviceUrl } from '#shared/contract'

const history = 'https://admin-shell.io/aas/API/3/2/SubmodelRepositoryServiceSpecification/SSP-007'
const eventFeed = 'https://basyx.org/aas/API/3/2/EventFeed/1.0'
const rebac = 'https://basyx.org/aas/API/3/2/RelationshipBasedAccessControl/1.0'
const registryQuery = 'https://admin-shell.io/aas/API/3/2/AssetAdministrationShellRegistryServiceSpecification/SSP-004'
const repositoryQuery = 'https://admin-shell.io/aas/API/3/2/AssetAdministrationShellRepositoryServiceSpecification/SSP-003'
const submodelQuery = 'https://basyx.org/aas/API/3/2/SubmodelRepositoryService/1.0'

const unsecured: SecuritySummary = { mode: 'unsecured' }

function infrastructure (template: InfrastructureTemplate, endpoints: EndpointInput[], serviceProfiles: ServiceProfiles = {}, security = unsecured, listSource: ListSource = 'repository') {
  return { template, endpoints, serviceProfiles, security, listSource }
}

const environment = infrastructure('mono-all', [{ type: 'aasEnvironment', url: 'http://env/' }])
const separate = infrastructure('full', [
  { type: 'aasRegistry', url: 'http://registry' },
  { type: 'aasRepository', url: 'http://aas/' },
  { type: 'submodelRepository', url: 'http://sm' },
])

describe('infrastructure templates', () => {
  it('resolves services from their own endpoint or the AAS environment the template names', () => {
    expect(serviceUrl(environment, 'submodelRepository')).toBe('http://env')
    expect(serviceUrl(environment, 'aasDiscovery')).toBe('http://env')
    const monoRepo = infrastructure('mono-repo', [{ type: 'aasEnvironment', url: 'http://env' }, { type: 'aasRegistry', url: 'http://registry' }])
    expect(serviceUrl(monoRepo, 'aasRepository')).toBe('http://env')
    expect(serviceUrl(monoRepo, 'aasRegistry')).toBe('http://registry')
    // In mono-repo, registries and discovery come only from their own endpoints.
    expect(serviceUrl(monoRepo, 'submodelRegistry')).toBeUndefined()
    expect(serviceUrl(separate, 'aasRepository')).toBe('http://aas')
    expect(serviceUrl(separate, 'conceptDescriptionRepository')).toBeUndefined()
  })

  it('accepts only the endpoints of the chosen template', () => {
    const base = { name: 'Test', security: { mode: 'unsecured' } }
    const issues = (input: object) => {
      const result = infrastructureInputSchema.safeParse({ ...base, ...input })
      return result.success ? [] : result.error.issues.map(issue => issue.message)
    }
    expect(issues({ template: 'mono-all', endpoints: [{ type: 'aasEnvironment', url: 'http://env' }] })).toEqual([])
    expect(issues({ template: 'mono-all', endpoints: [{ type: 'aasEnvironment', url: 'http://env' }, { type: 'aasRegistry', url: 'http://r' }] }))
      .toEqual(['the template mono-all has no aasRegistry endpoint'])
    expect(issues({ template: 'full', endpoints: [{ type: 'aasRegistry', url: 'http://r' }] }))
      .toEqual(['the template full needs submodelRepository or submodelRegistry'])
    expect(issues({ template: 'identifiable', endpoints: [{ type: 'aasRepository', url: 'http://aas' }] })).toEqual([])
    expect(issues({ endpoints: [{ type: 'aasRepository', url: 'http://aas' }, { type: 'aasRepository', url: 'http://aas2' }, { type: 'submodelRepository', url: 'http://sm' }] }))
      .toContain('each endpoint type may occur only once')
  })
})

describe('target capabilities', () => {
  it('derives environment operations and services from the configuration', () => {
    expect(liveCapabilities(separate)).toMatchObject({ export: false, upload: false, search: 'filter', conceptDescriptions: false, discovery: false })
    expect(liveCapabilities(environment)).toMatchObject({ export: true, upload: true, search: 'filter', conceptDescriptions: true, discovery: true })
  })

  it('searches where a query profile is announced, preferring the list source', () => {
    const all = [registryQuery, repositoryQuery, submodelQuery]
    expect(liveCapabilities(infrastructure('mono-all', environment.endpoints, { aasEnvironment: all })))
      .toMatchObject({ search: 'query', queryTarget: 'repository', elementSearch: true })
    const profiles = { aasRegistry: [registryQuery], aasRepository: [repositoryQuery] }
    expect(liveCapabilities(infrastructure('full', separate.endpoints, profiles, unsecured, 'registry')))
      .toMatchObject({ search: 'query', queryTarget: 'registry', elementSearch: false, listSource: 'registry' })
    // Without a query profile on the list source, the other AAS service answers.
    expect(liveCapabilities(infrastructure('full', separate.endpoints, { aasRepository: [repositoryQuery] }, unsecured, 'registry')))
      .toMatchObject({ queryTarget: 'repository' })
    // BaSyx profiles before 3.2 do not include queries.
    expect(liveCapabilities(infrastructure('full', separate.endpoints, { aasRepository: ['https://basyx.org/aas/API/3/1/AssetAdministrationShellRepositoryServiceSpecification/SSP-001'] })))
      .toMatchObject({ search: 'filter', queryTarget: null })
  })

  it('searches concept descriptions where their repository announces queries', () => {
    expect(liveCapabilities(environment).conceptDescriptionSearch).toBe('filter')
    const basyx = infrastructure('mono-all', environment.endpoints, { aasEnvironment: ['https://basyx.org/aas/API/3/2/ConceptDescriptionRepositoryService/1.0'] })
    expect(liveCapabilities(basyx).conceptDescriptionSearch).toBe('query')
    const idta = infrastructure('mono-all', environment.endpoints, { aasEnvironment: ['https://admin-shell.io/aas/API/3/2/ConceptDescriptionRepositoryServiceSpecification/SSP-003'] })
    expect(liveCapabilities(idta).conceptDescriptionSearch).toBe('query')
    expect(workspaceCapabilities.conceptDescriptionSearch).toBe('expression')
  })

  it('offers history, the change feed and sharing only where the services announce them', () => {
    expect(liveCapabilities(environment)).toMatchObject({ history: false, changeFeed: false, sharing: false })
    const announcing = infrastructure('mono-all', environment.endpoints, { aasEnvironment: [history, eventFeed, rebac] })
    expect(liveCapabilities(announcing)).toMatchObject({ history: true, changeFeed: true, sharing: false })
    const asUser = infrastructure('mono-all', environment.endpoints, { aasEnvironment: [rebac] }, {
      mode: 'delegated_user',
      issuer: 'http://idp',
      clientId: 'studio',
      scopes: [],
      clientSecret: null,
      desktopLoopbackHost: '127.0.0.1',
    })
    expect(liveCapabilities(asUser).sharing).toBe(true)
    // Profiles count only for the endpoint that serves the service.
    const elsewhere = infrastructure('full', separate.endpoints, { aasRegistry: [history, eventFeed] })
    expect(liveCapabilities(elsewhere)).toMatchObject({ history: false, changeFeed: false })
    // Any 3.x API version of a profile counts.
    const older = infrastructure('full', separate.endpoints, { submodelRepository: [history.replace('/3/2/', '/3/3/')] })
    expect(liveCapabilities(older).history).toBe(true)
  })

  it('offers no server-only features on workspaces', () => {
    expect(workspaceCapabilities).toMatchObject({ operations: false, upload: false, history: false, sharing: false, deleteShells: true, files: true })
  })
})
