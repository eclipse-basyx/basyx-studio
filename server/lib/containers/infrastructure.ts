import type { EndpointInput, InfrastructureInput, StackSpec } from '#shared/contract'
import { defaultSyncSettings } from '#shared/contract'
import { issuerOfSpec, urlsOf } from './plan'
import { studioClientId } from './security'

/**
 * The infrastructure Studio creates for a running stack (plan I1): `mono-all`
 * for one environment, `mono-repo` with separate registries and discovery,
 * and Keycloak sign-in as the user for secured stacks.
 */
export function infrastructureInputOf (name: string, spec: StackSpec): InfrastructureInput {
  const urls = urlsOf(spec)
  const endpoints: EndpointInput[] = [{ type: 'aasEnvironment', url: urls.environment! }]
  if (spec.topology === 'separate') {
    endpoints.push(
      { type: 'aasRegistry', url: urls.aasRegistry! },
      { type: 'submodelRegistry', url: urls.submodelRegistry! },
      { type: 'aasDiscovery', url: urls.discovery! },
    )
  }
  const issuer = issuerOfSpec(spec)
  return {
    name,
    description: 'Local BaSyx instance, started from Local Servers.',
    template: spec.topology === 'separate' ? 'mono-repo' : 'mono-all',
    endpoints,
    listSource: spec.features.registrySync ? 'registry' : 'repository',
    sync: { ...defaultSyncSettings, serverSyncsRegistry: spec.features.registrySync, serverSyncsDiscovery: spec.features.discoverySync },
    security: issuer
      ? { mode: 'delegated_user', issuer, clientId: studioClientId, scopes: ['openid', 'profile'], desktopLoopbackHost: '127.0.0.1' }
      : { mode: 'unsecured' },
    allowPrivateNetwork: true,
  }
}
