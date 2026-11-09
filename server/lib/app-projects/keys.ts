import type { TrustedPublisher, TrustStore } from '../apps/trust'
import type { StudioDeps } from '../deps'
import { generateKeyPairSync } from 'node:crypto'
import { parsePublicKey, signPackage } from '@basyx/studio-app-kit/signature'
import { eq } from 'drizzle-orm'
import { machineSigningKeys } from '../../database/schema'

// The App Builder's signing key of this computer (ADR 0054, plan B7): a
// P-256 key, created on first use, whose private key is encrypted with
// Studio's data key. Studio trusts it as the publisher *This computer* for
// `local.*` app IDs, with no reserved permissions and no remote code, next
// to the deployment's own trust store (STUDIO_APPS_TRUSTED_PUBLISHERS).

export const machinePublisherName = 'This computer'
export const machineAppIds = ['local.*']
const keyId = 'default'
const purpose = 'app-builder-signing-key'

export interface MachineKey {
  publicKey: string
  fingerprint: string
}

/** The trust store entry of the machine key. */
export function machinePublisher (publicKey: string): TrustedPublisher {
  return { name: machinePublisherName, keys: [parsePublicKey(publicKey)], appIds: [...machineAppIds], permissions: [], remoteCode: false }
}

/**
 * Adds the machine key to the trust store Studio uses, once. The store is
 * read from the deployment's file at start; this entry lives only in memory
 * and comes back from the database at every start.
 */
export function trustMachineKey (trustStore: TrustStore, publicKey: string): void {
  const publisher = machinePublisher(publicKey)
  const known = trustStore.publishers.some(entry => entry.keys.some(key => key.fingerprint === publisher.keys[0]!.fingerprint))
  if (!known) {
    trustStore.publishers.push(publisher)
  }
}

export async function findMachineKey (deps: Pick<StudioDeps, 'db'>): Promise<MachineKey | null> {
  const [row] = await deps.db.select({ publicKey: machineSigningKeys.publicKey, fingerprint: machineSigningKeys.fingerprint }).from(machineSigningKeys).where(eq(machineSigningKeys.id, keyId))
  return row ?? null
}

/** The machine key, created on first use and trusted from then on. */
export async function ensureMachineKey (deps: Pick<StudioDeps, 'db' | 'cipher' | 'config'>): Promise<MachineKey> {
  const existing = await findMachineKey(deps)
  if (existing) {
    trustMachineKey(deps.config.apps.trustStore, existing.publicKey)
    return existing
  }
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const { fingerprint } = parsePublicKey(publicPem)
  await deps.db.insert(machineSigningKeys)
    .values({ id: keyId, publicKey: publicPem, privateKeyCiphertext: deps.cipher.encrypt(privatePem, purpose), fingerprint })
    .onConflictDoNothing()
  // Another request may have created it first: use what is stored.
  const stored = (await findMachineKey(deps))!
  trustMachineKey(deps.config.apps.trustStore, stored.publicKey)
  return stored
}

/** Signs a package with the machine key: the content of its `.sig` file. */
export async function signWithMachineKey (deps: Pick<StudioDeps, 'db' | 'cipher' | 'config'>, bytes: Uint8Array): Promise<string> {
  await ensureMachineKey(deps)
  const [row] = await deps.db.select({ ciphertext: machineSigningKeys.privateKeyCiphertext }).from(machineSigningKeys).where(eq(machineSigningKeys.id, keyId))
  return signPackage(bytes, deps.cipher.decrypt(row!.ciphertext, purpose))
}
