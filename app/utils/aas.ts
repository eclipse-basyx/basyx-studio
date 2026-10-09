import type { EditableModelType, LangString, Target } from '#shared/contract'
import { editableModelTypes } from '#shared/contract'

const modelTypeIcons: Record<string, string> = {
  Submodel: 'mdi-file-tree-outline',
  SubmodelElementCollection: 'mdi-folder-outline',
  SubmodelElementList: 'mdi-format-list-numbered',
  Property: 'mdi-tag-outline',
  MultiLanguageProperty: 'mdi-translate',
  Range: 'mdi-arrow-expand-horizontal',
  File: 'mdi-file-outline',
  Blob: 'mdi-file-code-outline',
  ReferenceElement: 'mdi-link-variant',
  RelationshipElement: 'mdi-relation-many-to-many',
  AnnotatedRelationshipElement: 'mdi-relation-many-to-many',
  Entity: 'mdi-cube-outline',
  Operation: 'mdi-cog-outline',
  OperationVariables: 'mdi-variable',
  Capability: 'mdi-lightning-bolt-outline',
  BasicEventElement: 'mdi-bell-outline',
}

export function modelTypeIcon (modelType: string): string {
  return modelTypeIcons[modelType] ?? 'mdi-shape-outline'
}

/** Picks the text for the UI language, falling back to English and then the first entry. */
export function langText (strings: LangString[], language = 'en'): string | null {
  const match = strings.find(entry => entry.language.toLowerCase().startsWith(language))
    ?? strings.find(entry => entry.language.toLowerCase().startsWith('en'))
    ?? strings[0]
  return match?.text ?? null
}

export const securityModeIcons: Record<string, string> = {
  unsecured: 'mdi-lock-open-variant-outline',
  deployment_client_credentials: 'mdi-shield-key-outline',
  delegated_user: 'mdi-account-key-outline',
}

/** Icon of a target: its security mode, or a package for local workspaces. */
export function targetIcon (target: Target): string {
  return target.securityMode ? securityModeIcons[target.securityMode]! : 'mdi-package-variant-closed'
}

export function isEditableModelType (modelType: unknown): modelType is EditableModelType {
  return (editableModelTypes as readonly unknown[]).includes(modelType)
}

/** The AAS identifier behind a resource key (base64url), or `null` if malformed. */
export function decodeResourceKey (key: string): string | null {
  try {
    const base64 = key.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.codePointAt(0)!))
  } catch {
    return null
  }
}
