import type { TargetCapabilities } from '#shared/contract'
import type { InfrastructureRecord } from '../infrastructures'
import { serviceUrl } from '#shared/contract'
import { environmentUrl } from '../infrastructures'
import { announcedFeatures } from './profiles'

/**
 * Capabilities of a live infrastructure: what its configured endpoints offer
 * and what its services announce in `/description` (MVP-4 plan, I6).
 */
export function liveCapabilities (record: Pick<InfrastructureRecord, 'endpoints' | 'template' | 'serviceProfiles' | 'security' | 'listSource'>): TargetCapabilities {
  const environment = environmentUrl(record) !== undefined
  const announced = announcedFeatures(record)
  const listSource = record.listSource === 'registry' && serviceUrl(record, 'aasRegistry') !== undefined ? 'registry' : 'repository'
  // Queries run where the list comes from, else on the other AAS service that can.
  const queryable = { registry: announced.query.aasRegistry, repository: announced.query.aasRepository }
  const other = listSource === 'registry' ? 'repository' : 'registry'
  const queryTarget = queryable[listSource] ? listSource : (queryable[other] ? other : null)
  return {
    write: true,
    writeStructure: true,
    createResources: true,
    // BaSyx Go returns named children by name; only list items keep a position.
    orderedChildren: false,
    undo: false,
    persistence: 'immediate',
    deleteShells: true,
    files: true,
    operations: true,
    conceptDescriptions: serviceUrl(record, 'conceptDescriptionRepository') !== undefined,
    conceptDescriptionSearch: announced.query.conceptDescriptionRepository ? 'query' : 'filter',
    search: queryTarget ? 'query' : 'filter',
    queryTarget,
    elementSearch: announced.query.submodelRepository,
    discovery: serviceUrl(record, 'aasDiscovery') !== undefined,
    export: environment,
    upload: environment,
    history: announced.history,
    changeFeed: announced.changeFeed,
    // Grants and rights mean something only when the target sees the user (D15).
    sharing: announced.rebac && record.security.mode === 'delegated_user',
    listSource,
  }
}

/** Desktop AASX workspaces: local editing without server-only features (D13). */
export const workspaceCapabilities: TargetCapabilities = {
  write: true,
  writeStructure: true,
  createResources: true,
  orderedChildren: true,
  undo: true,
  persistence: 'explicit_save',
  deleteShells: true,
  files: true,
  operations: false,
  conceptDescriptions: true,
  conceptDescriptionSearch: 'expression',
  search: 'expression',
  queryTarget: null,
  elementSearch: true,
  discovery: false,
  export: false,
  upload: false,
  history: false,
  changeFeed: false,
  sharing: false,
  listSource: 'repository',
}
