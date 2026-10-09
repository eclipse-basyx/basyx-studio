import type { AppContributions } from '#shared/contract'
import type { AppInstallationRecord } from './store'

/** The URL of a file of an installation on the app origin. */
export function appFileUrl (baseUrl: string, installationId: string, path: string): string {
  return `${baseUrl}${installationId}/${path}`
}

/**
 * The contributions of the installed apps. Modules are returned always; the
 * UI shows them for their context. Submodel views are returned only for a
 * submodel's semantic ID, matched exactly (as in the BaSyx AAS Web UI), with
 * the matching ID as the reason.
 */
export function contributionsFor (installations: AppInstallationRecord[], baseUrl: string, semanticId: string | undefined): AppContributions {
  const result: AppContributions = { submodelViews: [], modules: [] }
  for (const installation of installations) {
    const { manifest } = installation
    const base = {
      installationId: installation.id,
      appId: installation.appId,
      appTitle: manifest.title,
      permissions: manifest.permissions,
      unsigned: installation.unsigned,
    }
    if (semanticId) {
      for (const view of manifest.contributes.submodelViews ?? []) {
        if (view.semanticIds.includes(semanticId)) {
          result.submodelViews.push({
            kind: 'submodelView',
            ...base,
            id: view.id,
            title: view.title,
            entryUrl: appFileUrl(baseUrl, installation.id, view.entry),
            reason: { semanticId },
          })
        }
      }
    }
    for (const module of manifest.contributes.modules ?? []) {
      result.modules.push({
        kind: 'module',
        ...base,
        id: module.id,
        title: module.title,
        icon: module.icon ?? null,
        route: module.route,
        context: module.context,
        entryUrl: appFileUrl(baseUrl, installation.id, module.entry),
      })
    }
  }
  return result
}
