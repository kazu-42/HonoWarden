import { describe, expect, it } from 'vitest'

import {
  approveAuthRequest,
  consumeAuthRequest,
  createAuthRequest,
  deleteRetainedAuthRequests,
  denyAuthRequest,
  expireAuthRequests,
  findAuthRequestVerifierById,
  listPendingAuthRequests,
} from '../../src/repositories/auth-request-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

class RecordingDatabase {
  readonly queries: string[] = []
  readonly bindings: unknown[][] = []

  constructor(
    private readonly firstResult: unknown | null = null,
    private readonly allResults: unknown[] = [],
    private readonly changes = 1,
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const { bindings, firstResult, allResults, changes } = this
    let values: unknown[] = []
    const statement = {
      bind(...boundValues: unknown[]) {
        values = boundValues
        bindings.push(boundValues)
        return statement as unknown as D1PreparedStatement
      },
      async run(): Promise<D1Result> {
        return {
          success: true,
          results: [],
          meta: { ...fakeMeta, changes },
        }
      },
      async first<T = unknown>(): Promise<T | null> {
        void values
        return firstResult as T | null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: allResults as T[],
          meta: fakeMeta,
        }
      },
    }
    return statement as unknown as D1PreparedStatement
  }
}

describe('auth request repository', () => {
  it('creates pending state with hashes and opaque public material only', async () => {
    const database = new RecordingDatabase()

    await createAuthRequest(database as unknown as D1Database, {
      id: 'request-1',
      userId: 'user-1',
      emailHash: 'email-hash',
      requestType: 0,
      requestDeviceIdentifier: 'requester-device',
      requestDeviceType: 8,
      requestPublicKey: 'opaque-public-key',
      accessCodeHash: 'access-code-hash',
      createdAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-11T00:15:00.000Z',
      retentionDeleteAfter: '2026-08-10T00:00:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('INSERT INTO auth_requests')
    expect(database.bindings.flat()).toContain('access-code-hash')
    expect(database.bindings.flat()).toContain('opaque-public-key')
    expect(database.bindings.flat()).not.toContain('plain-access-code')
    expect(database.queries.join('\n')).not.toContain('private_key')
  })

  it('lists only unexpired pending requests for the authenticated owner', async () => {
    const database = new RecordingDatabase(null, [authRequestRow])

    const requests = await listPendingAuthRequests(
      database as unknown as D1Database,
      'user-1',
      '2026-07-11T00:05:00.000Z',
    )

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ id: 'request-1', status: 'pending' })
    expect(database.queries.join('\n')).toContain("status = 'pending'")
    expect(database.queries.join('\n')).toContain('user_id = ?')
    expect(database.bindings[0]).toEqual(['user-1', '2026-07-11T00:05:00.000Z'])
  })

  it('approves once from a different owner device before expiry', async () => {
    const database = new RecordingDatabase(null, [], 1)

    const result = await approveAuthRequest(database as unknown as D1Database, {
      id: 'request-1',
      userId: 'user-1',
      approvingDeviceIdentifier: 'approver-device',
      encryptedResponseKey: 'opaque-encrypted-key',
      now: '2026-07-11T00:05:00.000Z',
    })

    expect(result).toEqual({ status: 'updated' })
    expect(database.queries.join('\n')).toContain("status = 'approved'")
    expect(database.queries.join('\n')).toContain("status = 'pending'")
    expect(database.queries.join('\n')).toContain(
      'request_device_identifier <> ?',
    )
  })

  it('denies without accepting encrypted response material', async () => {
    const database = new RecordingDatabase(null, [], 1)

    const result = await denyAuthRequest(database as unknown as D1Database, {
      id: 'request-1',
      userId: 'user-1',
      approvingDeviceIdentifier: 'approver-device',
      now: '2026-07-11T00:05:00.000Z',
    })

    expect(result).toEqual({ status: 'updated' })
    expect(database.queries.join('\n')).toContain("status = 'denied'")
    expect(database.queries.join('\n')).toContain(
      'encrypted_response_key = NULL',
    )
  })

  it('loads the internal verifier by request id without exposing it publicly', async () => {
    const database = new RecordingDatabase({
      ...authRequestRow,
      accessCodeHash: 'access-code-hash',
    })

    const request = await findAuthRequestVerifierById(
      database as unknown as D1Database,
      'request-1',
      '2026-07-11T00:05:00.000Z',
    )

    expect(request?.id).toBe('request-1')
    expect(request?.accessCodeHash).toBe('access-code-hash')
    expect(database.queries.join('\n')).toContain(
      'access_code_hash as accessCodeHash',
    )
    expect(database.queries.join('\n')).not.toContain('email_normalized')
    expect(database.bindings[0]).toEqual([
      'request-1',
      '2026-07-11T00:05:00.000Z',
    ])
  })

  it('atomically consumes one approved unexpired request for its requester device', async () => {
    const database = new RecordingDatabase(null, [], 1)

    const result = await consumeAuthRequest(database as unknown as D1Database, {
      id: 'request-1',
      accessCodeHash: 'access-code-hash',
      requestDeviceIdentifier: 'requester-device',
      now: '2026-07-11T00:05:00.000Z',
    })

    expect(result).toEqual({ status: 'updated' })
    expect(database.queries.join('\n')).toContain("status = 'consumed'")
    expect(database.queries.join('\n')).toContain("status = 'approved'")
    expect(database.queries.join('\n')).toContain('access_code_hash = ?')
    expect(database.queries.join('\n')).toContain(
      'request_device_identifier = ?',
    )
  })

  it('does not disclose why a compare-and-set transition was rejected', async () => {
    const database = new RecordingDatabase(null, [], 0)

    const result = await approveAuthRequest(database as unknown as D1Database, {
      id: 'request-1',
      userId: 'user-1',
      approvingDeviceIdentifier: 'requester-device',
      encryptedResponseKey: 'opaque-encrypted-key',
      now: '2026-07-11T00:16:00.000Z',
    })

    expect(result).toEqual({ status: 'not_updated' })
  })

  it('expires pending and approved requests in bounded batches', async () => {
    const database = new RecordingDatabase(null, [], 2)

    const changes = await expireAuthRequests(
      database as unknown as D1Database,
      '2026-07-11T00:16:00.000Z',
      100,
    )

    expect(changes).toBe(2)
    expect(database.queries.join('\n')).toContain(
      "status IN ('pending', 'approved')",
    )
    expect(database.queries.join('\n')).toContain('expires_at <= ?')
    expect(database.bindings[0]).toEqual([
      '2026-07-11T00:16:00.000Z',
      '2026-07-11T00:16:00.000Z',
      100,
    ])
  })

  it('deletes only terminal requests past retention in bounded batches', async () => {
    const database = new RecordingDatabase(null, [], 3)

    const changes = await deleteRetainedAuthRequests(
      database as unknown as D1Database,
      '2026-08-11T00:00:00.000Z',
      100,
    )

    expect(changes).toBe(3)
    expect(database.queries.join('\n')).toContain(
      "status IN ('denied', 'consumed', 'expired')",
    )
    expect(database.queries.join('\n')).toContain('retention_delete_after <= ?')
    expect(database.bindings[0]).toEqual(['2026-08-11T00:00:00.000Z', 100])
  })
})

const authRequestRow = {
  id: 'request-1',
  userId: 'user-1',
  requestType: 0,
  requestDeviceIdentifier: 'requester-device',
  requestDeviceType: 8,
  requestPublicKey: 'opaque-public-key',
  status: 'pending',
  requestApproved: null,
  approvingDeviceIdentifier: null,
  encryptedResponseKey: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  responseAt: null,
  consumedAt: null,
  expiresAt: '2026-07-11T00:15:00.000Z',
}
