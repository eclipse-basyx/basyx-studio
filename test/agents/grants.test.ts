import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileGrantStore } from '~~/server/lib/desktop/grants'
import { isFileGrantKind, isSaveKind } from '#shared/file-grant-kinds'

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('App Builder file grants (ADR 0054, plan B8)', () => {
  it('grants a signing key to read and a package to save, once each', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'app-grants-'))
    temporary.push(folder)
    writeFileSync(join(folder, 'signing.pem'), 'key')
    const grants = new FileGrantStore()

    const key = await grants.grant(join(folder, 'signing.pem'), 'signing-key')
    expect(key.fileName).toBe('signing.pem')
    expect(() => grants.take(key.handle, 'app-package')).toThrow()
    const again = await grants.grant(join(folder, 'signing.pem'), 'signing-key')
    expect(grants.take(again.handle, 'signing-key')).toBe(join(folder, 'signing.pem'))
    expect(() => grants.take(again.handle, 'signing-key')).toThrow()

    const target = await grants.grant(join(folder, 'local.a-0.1.0.zip'), 'app-package')
    expect(grants.take(target.handle, 'app-package')).toBe(join(folder, 'local.a-0.1.0.zip'))
    await expect(grants.grant(join(folder, 'signing.txt'), 'signing-key')).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(grants.grant(join(folder, 'missing.pem'), 'signing-key')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('knows which kinds pick files and which save them', () => {
    expect(isFileGrantKind('signing-key')).toBe(true)
    expect(isFileGrantKind('anything')).toBe(false)
    expect(isSaveKind('app-package')).toBe(true)
    expect(isSaveKind('signing-key')).toBe(false)
    expect(isSaveKind('stack-export')).toBe(true)
  })
})
