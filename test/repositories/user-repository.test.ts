import { describe, expect, it } from 'vitest'

import type { BootstrapUserRecord } from '../../src/domain/bootstrap'
import { createBootstrapUser } from '../../src/repositories/user-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('createBootstrapUser', () => {
  it('inserts a bootstrap user with normalized lookup columns', async () => {
    const database = new RecordingD1Database(1)
    const result = await createBootstrapUser(database, userRecord())

    expect(result).toEqual({
      status: 'created',
      userId: 'user-id',
    })
    expect(database.query).toContain('INSERT OR IGNORE INTO users')
    expect(database.values).toEqual([
      'user-id',
      'Person@Example.Test',
      'person@example.test',
      null,
      'pbkdf2-sha256',
      600000,
      null,
      null,
      'synthetic-master-password-hash',
      '2.synthetic-user-key',
      null,
      null,
      'security-stamp',
      '2026-07-06T00:00:00.000Z',
    ])
  })

  it('returns duplicate when D1 ignores a conflicting insert', async () => {
    await expect(
      createBootstrapUser(new RecordingD1Database(0), userRecord()),
    ).resolves.toEqual({
      status: 'duplicate',
    })
  })
})

class RecordingD1Database {
  query = ''
  values: unknown[] = []

  constructor(private readonly changes: number) {}

  prepare(query: string): D1PreparedStatement {
    this.query = query
    const setValues = (values: unknown[]) => {
      this.values = values
    }
    const getChanges = () => this.changes

    const statement = {
      bind(...values: unknown[]) {
        setValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        return null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: [],
          meta: fakeMeta,
        }
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes: getChanges(),
          },
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }
}

function userRecord(): BootstrapUserRecord {
  return {
    id: 'user-id',
    email: 'Person@Example.Test',
    emailNormalized: 'person@example.test',
    displayName: null,
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: 600000,
    kdfMemory: null,
    kdfParallelism: null,
    masterPasswordHash: 'synthetic-master-password-hash',
    userKey: '2.synthetic-user-key',
    publicKey: null,
    privateKey: null,
    securityStamp: 'security-stamp',
    revisionDate: '2026-07-06T00:00:00.000Z',
  }
}
