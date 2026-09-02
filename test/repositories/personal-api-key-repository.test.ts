import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import {
  createPersonalApiKey,
  findPersonalApiKeyMetadata,
  findPersonalApiKeyVerifier,
  markPersonalApiKeyUsed,
  rotatePersonalApiKey,
} from '../../src/repositories/personal-api-key-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

const metadataRow = {
  userId: 'user-id',
  createdAt: '2026-07-17T00:00:00.000Z',
  rotatedAt: null,
  lastUsedAt: null,
  revisionDate: '2026-07-17T00:00:00.000Z',
}

describe('personal API-key repository', () => {
  it('reads lifecycle metadata without selecting the verifier', async () => {
    const database = new RecordingPersonalApiKeyD1({ metadataRow })

    await expect(
      findPersonalApiKeyMetadata(database, 'user-id'),
    ).resolves.toEqual(metadataRow)
    expect(database.queries[0]).toContain('FROM personal_api_keys')
    expect(database.queries[0]).not.toContain('secret_verifier')
    expect(database.boundValues).toEqual(['user-id'])
  })

  it('reads the verifier only for a grant lookup', async () => {
    const verifierRow = {
      userId: 'user-id',
      secretVerifier: 'hmac-sha256:v1:synthetic-verifier',
      revisionDate: '2026-07-17T00:00:00.000Z',
    }
    const database = new RecordingPersonalApiKeyD1({ verifierRow })

    await expect(
      findPersonalApiKeyVerifier(database, 'user-id'),
    ).resolves.toEqual(verifierRow)
    expect(database.queries[0]).toContain('secret_verifier as secretVerifier')
    expect(database.boundValues).toEqual(['user-id'])
  })

  it('creates a verifier record without accepting raw secret material', async () => {
    const database = new RecordingPersonalApiKeyD1({ mutationChanges: 1 })

    await expect(
      createPersonalApiKey(database, {
        userId: 'user-id',
        secretVerifier: 'hmac-sha256:v1:synthetic-verifier',
        createdAt: '2026-07-17T00:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'created' })
    expect(database.queries[0]).toContain('INSERT INTO personal_api_keys')
    expect(database.queries[0]).toContain('ON CONFLICT(user_id) DO NOTHING')
    expect(database.boundValues).toEqual([
      'user-id',
      'hmac-sha256:v1:synthetic-verifier',
      '2026-07-17T00:00:00.000Z',
      '2026-07-17T00:00:00.000Z',
    ])
    expect(JSON.stringify(database.boundValues)).not.toContain(
      'raw-personal-api-key',
    )
  })

  it('reports an existing record without overwriting its verifier', async () => {
    const database = new RecordingPersonalApiKeyD1({ mutationChanges: 0 })

    await expect(
      createPersonalApiKey(database, {
        userId: 'user-id',
        secretVerifier: 'hmac-sha256:v1:new-verifier',
        createdAt: '2026-07-17T00:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'exists' })
  })

  it('batches a successful create with an audit guarded by the mutation result', async () => {
    const database = new RecordingPersonalApiKeyD1({ mutationChanges: 1 })
    const auditEvent = buildAuditEvent({
      name: 'auth.api_key_create',
      outcome: 'success',
      requestId: 'api-key-create-request',
      occurredAt: '2026-07-17T00:00:00.000Z',
      actor: { userId: 'user-id' },
      target: { type: 'account', id: 'user-id' },
    })

    await expect(
      createPersonalApiKey(
        database,
        {
          userId: 'user-id',
          secretVerifier: 'hmac-sha256:v1:synthetic-verifier',
          createdAt: '2026-07-17T00:00:00.000Z',
        },
        auditEvent,
      ),
    ).resolves.toEqual({ status: 'created' })
    expect(database.batchCalls).toBe(1)
    expect(database.queries).toHaveLength(2)
    expect(database.queries[1]).toContain('INSERT INTO audit_events')
    expect(database.queries[1]).toContain('WHERE changes() = 1')
  })

  it('rotates only an existing owner verifier and records its revision', async () => {
    const database = new RecordingPersonalApiKeyD1({ mutationChanges: 1 })

    await expect(
      rotatePersonalApiKey(database, {
        userId: 'user-id',
        secretVerifier: 'hmac-sha256:v1:rotated-verifier',
        rotatedAt: '2026-07-17T01:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'rotated' })
    expect(database.queries[0]).toContain('UPDATE personal_api_keys')
    expect(database.queries[0]).toContain('WHERE user_id = ?')
    expect(database.boundValues).toEqual([
      'hmac-sha256:v1:rotated-verifier',
      '2026-07-17T01:00:00.000Z',
      '2026-07-17T01:00:00.000Z',
      'user-id',
    ])
  })

  it('does not create a key implicitly during rotation', async () => {
    const database = new RecordingPersonalApiKeyD1({ mutationChanges: 0 })

    await expect(
      rotatePersonalApiKey(database, {
        userId: 'missing-user-id',
        secretVerifier: 'hmac-sha256:v1:rotated-verifier',
        rotatedAt: '2026-07-17T01:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('marks use only while the verified generation is still current', async () => {
    const current = new RecordingPersonalApiKeyD1({ mutationChanges: 1 })
    const stale = new RecordingPersonalApiKeyD1({ mutationChanges: 0 })
    const input = {
      userId: 'user-id',
      expectedVerifier: 'hmac-sha256:v1:verified-generation',
      usedAt: '2026-07-17T02:00:00.000Z',
    }

    await expect(markPersonalApiKeyUsed(current, input)).resolves.toBe(true)
    await expect(markPersonalApiKeyUsed(stale, input)).resolves.toBe(false)
    expect(current.queries[0]).toContain('last_used_at = ?')
    expect(current.queries[0]).toContain('secret_verifier = ?')
    expect(current.boundValues).toEqual([
      '2026-07-17T02:00:00.000Z',
      'user-id',
      'hmac-sha256:v1:verified-generation',
    ])
  })
})

type RecordingOptions = {
  metadataRow?: unknown
  verifierRow?: unknown
  mutationChanges?: number
}

class RecordingPersonalApiKeyD1 {
  readonly queries: string[] = []
  readonly boundValues: unknown[] = []
  batchCalls = 0

  constructor(private readonly options: RecordingOptions) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const options = this.options
    const boundValues = this.boundValues
    const statement = {
      bind(...values: unknown[]) {
        boundValues.push(...values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        return (
          query.includes('secret_verifier')
            ? options.verifierRow
            : (options.metadataRow ?? null)
        ) as T | null
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes: options.mutationChanges ?? 1,
          },
        }
      },
    }

    return statement as D1PreparedStatement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchCalls += 1
    return Promise.all(statements.map((statement) => statement.run<T>()))
  }
}
