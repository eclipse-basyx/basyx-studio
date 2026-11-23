import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TargetHttp } from '~~/server/lib/targets/http'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { policy, record } from '../support/live'

// A stand-in repository that answers every request with 412 Precondition
// Failed, with or without a precondition (issue #195).

describe('a 412 answer from the target', () => {
  let url = ''

  const server = createServer((_request, response) => {
    response.writeHead(412, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messages: [{ text: 'precondition failed' }] }))
  })

  const options = () => ({
    record: record(url, { mode: 'unsecured' as const }),
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(url),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  it('is a revision conflict when Studio sent If-Match', async () => {
    await expect(new TargetHttp(options()).request('aasRepository', '/shells/x', { method: 'DELETE', headers: { 'If-Match': '"1"' } }))
      .rejects
      .toMatchObject({ code: 'revision_conflict' })
  })

  it('is a rejected request, not someone else\'s change, when Studio sent no precondition', async () => {
    await expect(new LiveAasTarget(options()).deleteShell('urn:studio:test:aas:locked')).rejects.toMatchObject({
      code: 'target_request_rejected',
      detail: expect.stringContaining('although Studio sent no precondition'),
    })
  })
})
