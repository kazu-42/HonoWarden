import { describe, expect, it } from 'vitest'

import {
  buildDeviceId,
  createPasswordGrantSession,
  findAuthUserByEmail,
} from '../../src/repositories/auth-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('auth repository', () => {
  it('looks up auth users by normalized email', async () => {
    const database = new RecordingAuthD1Database({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      privateKey: null,
      securityStamp: 'security-stamp',
      disabledAt: null,
    })

    await expect(
      findAuthUserByEmail(database, 'person@example.test'),
    ).resolves.toEqual({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      privateKey: null,
      securityStamp: 'security-stamp',
      disabledAt: null,
    })
    expect(database.boundValues).toContain('person@example.test')
  })

  it('upserts a device and stores only the refresh token hash', async () => {
    const database = new RecordingAuthD1Database(null)

    await createPasswordGrantSession(database, {
      userId: 'user-id',
      deviceIdentifier: 'device-identifier',
      deviceName: 'Desktop',
      deviceType: 9,
      refreshTokenId: 'refresh-token-id',
      refreshTokenHash: 'hashed-refresh-token',
      refreshTokenExpiresAt: '2026-08-05T00:00:00.000Z',
      now: '2026-07-06T00:00:00.000Z',
    })

    expect(database.batchStatements).toHaveLength(3)
    expect(database.boundValues).toContain(
      buildDeviceId('user-id', 'device-identifier'),
    )
    expect(database.boundValues).toContain('hashed-refresh-token')
    expect(database.boundValues).not.toContain('plaintext-refresh-token')
  })
})

class RecordingAuthD1Database {
  boundValues: unknown[] = []
  batchStatements: D1PreparedStatement[] = []

  constructor(private readonly userRow: unknown) {}

  prepare(query: string): D1PreparedStatement {
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
    }
    const getUserRow = () => this.userRow

    const statement = {
      bind(...values: unknown[]) {
        pushValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        if (query.includes('FROM users')) {
          return getUserRow() as T | null
        }

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
          meta: fakeMeta,
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchStatements = statements

    return statements.map(() => ({
      success: true,
      results: [],
      meta: fakeMeta,
    }))
  }
}
