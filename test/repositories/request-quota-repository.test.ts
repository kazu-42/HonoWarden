import { describe, expect, it } from 'vitest'

import {
  cleanupExpiredRequestQuotaBuckets,
  recordRequestQuotaHit,
} from '../../src/repositories/request-quota-repository'

describe('request quota repository', () => {
  it('atomically advances request quota buckets without plaintext client addresses', async () => {
    const database = new RecordingRequestQuotaD1Database({
      bucketKey: 'request:anonymous:hashed-bucket',
      scope: 'anonymous',
      requestCount: 1,
      windowStartedAt: '2026-07-09T00:00:00.000Z',
      blockedUntil: null,
      updatedAt: '2026-07-09T00:00:00.000Z',
    })

    await expect(
      recordRequestQuotaHit(database, {
        bucketKey: 'request:anonymous:hashed-bucket',
        scope: 'anonymous',
        limit: 120,
        windowSeconds: 60,
        blockSeconds: 60,
        now: '2026-07-09T00:00:00.000Z',
      }),
    ).resolves.toEqual({
      bucketKey: 'request:anonymous:hashed-bucket',
      scope: 'anonymous',
      requestCount: 1,
      windowStartedAt: '2026-07-09T00:00:00.000Z',
      blockedUntil: null,
      updatedAt: '2026-07-09T00:00:00.000Z',
    })

    const query = database.queries.join('\n')
    expect(query).toContain('INSERT INTO request_quota_buckets')
    expect(query).toContain('ON CONFLICT(bucket_key) DO UPDATE')
    expect(query).toContain('request_quota_buckets.request_count + 1')
    expect(database.boundValues).toContain('request:anonymous:hashed-bucket')
    expect(database.boundValues).not.toContain('203.0.113.10')
  })

  it('cleans up expired request quota buckets in bounded slices', async () => {
    const database = new CleanupRequestQuotaD1Database(3)

    await expect(
      cleanupExpiredRequestQuotaBuckets(database, {
        expiredBefore: '2026-07-09T00:00:00.000Z',
        now: '2026-07-09T00:10:00.000Z',
        limit: 5,
      }),
    ).resolves.toBe(3)

    const query = database.queries.join('\n')
    expect(query).toContain('DELETE FROM request_quota_buckets')
    expect(query).toContain('ORDER BY updated_at ASC')
    expect(query).toContain('LIMIT ?')
    expect(database.boundValues).toContain('2026-07-09T00:00:00.000Z')
    expect(database.boundValues).toContain(5)
  })
})

type RequestQuotaBucket = {
  bucketKey: string
  scope: string
  requestCount: number
  windowStartedAt: string
  blockedUntil: string | null
  updatedAt: string
}

class RecordingRequestQuotaD1Database {
  readonly boundValues: unknown[] = []
  readonly queries: string[] = []

  constructor(private readonly bucket: RequestQuotaBucket | null) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    let values: unknown[] = []

    return {
      bind: (...boundValues: unknown[]) => {
        values = boundValues
        this.boundValues.push(...boundValues)
        return this.prepareBound(query, values)
      },
    } as unknown as D1PreparedStatement
  }

  private prepareBound(query: string, values: unknown[]): D1PreparedStatement {
    return {
      run: async () =>
        ({
          success: true,
          results: [],
          meta: fakeMeta(1),
        }) satisfies D1Result,
      first: async <T = unknown>() => {
        if (query.includes('FROM request_quota_buckets')) {
          return this.bucket as T
        }

        return null
      },
      bind: (...nextValues: unknown[]) => {
        values.splice(0, values.length, ...nextValues)
        this.boundValues.push(...nextValues)
        return this.prepareBound(query, values)
      },
    } as unknown as D1PreparedStatement
  }
}

class CleanupRequestQuotaD1Database {
  readonly boundValues: unknown[] = []
  readonly queries: string[] = []

  constructor(private changes: number) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)

    return {
      bind: (...boundValues: unknown[]) => {
        this.boundValues.push(...boundValues)

        return {
          run: async () => {
            const changes = this.changes
            this.changes = 0

            return {
              success: true,
              results: [],
              meta: fakeMeta(changes),
            } satisfies D1Result
          },
        }
      },
    } as unknown as D1PreparedStatement
  }
}

function fakeMeta(changes: number): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  }
}
