import { describe, expect, it } from 'vitest'

import {
  consumeTotpChallenge,
  createTotpChallenge,
  enableTotpSetup,
  findActiveTotpChallengeByHash,
  findTotpSetupByUserId,
  recordAcceptedTotpStep,
  upsertPendingTotpSetup,
} from '../../src/repositories/totp-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('totp repository', () => {
  it('upserts pending setup with only encrypted secret material', async () => {
    const database = new RecordingTotpD1Database()

    await upsertPendingTotpSetup(database, {
      userId: 'user-id',
      encryptedSecret: 'v1.encrypted-secret',
      now: '2026-07-06T00:00:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('INSERT INTO user_totp')
    expect(database.queries.join('\n')).toContain(
      'ON CONFLICT(user_id) DO UPDATE',
    )
    expect(database.boundValues).toContain('v1.encrypted-secret')
    expect(database.boundValues).not.toContain(
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    )
  })

  it('finds setup state for a user', async () => {
    const database = new RecordingTotpD1Database({
      userId: 'user-id',
      encryptedSecret: 'v1.encrypted-secret',
      enabled: 1,
      verifiedAt: '2026-07-06T00:01:00.000Z',
      lastAcceptedStep: 59440320,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:01:00.000Z',
    })

    await expect(findTotpSetupByUserId(database, 'user-id')).resolves.toEqual({
      userId: 'user-id',
      encryptedSecret: 'v1.encrypted-secret',
      enabled: true,
      verifiedAt: '2026-07-06T00:01:00.000Z',
      lastAcceptedStep: 59440320,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:01:00.000Z',
    })
    expect(database.boundValues).toContain('user-id')
  })

  it('enables a verified setup and reports missing rows', async () => {
    await expect(
      enableTotpSetup(new RecordingTotpD1Database(null, null, 1), {
        userId: 'user-id',
        verifiedAt: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toBe(true)

    await expect(
      enableTotpSetup(new RecordingTotpD1Database(null, null, 0), {
        userId: 'missing-user-id',
        verifiedAt: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toBe(false)
  })

  it('atomically records only newer accepted time steps', async () => {
    const acceptedDatabase = new RecordingTotpD1Database(null, null, 1)

    await expect(
      recordAcceptedTotpStep(acceptedDatabase, {
        userId: 'user-id',
        acceptedStep: 59440320,
        now: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toBe(true)

    const query = acceptedDatabase.queries.join('\n')
    expect(query).toContain('UPDATE user_totp')
    expect(query).toContain('last_accepted_step IS NULL')
    expect(query).toContain('? > last_accepted_step')
    expect(acceptedDatabase.boundValues).toContain(59440320)

    await expect(
      recordAcceptedTotpStep(new RecordingTotpD1Database(null, null, 0), {
        userId: 'user-id',
        acceptedStep: 59440320,
        now: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toBe(false)
  })

  it('creates hashed login challenges', async () => {
    const database = new RecordingTotpD1Database()

    await createTotpChallenge(database, {
      id: 'challenge-id',
      userId: 'user-id',
      challengeHash: 'hashed-challenge',
      deviceIdentifier: 'device-id',
      expiresAt: '2026-07-06T00:05:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('INSERT INTO totp_challenges')
    expect(database.boundValues).toContain('hashed-challenge')
    expect(database.boundValues).not.toContain('plaintext-challenge')
  })

  it('finds only active login challenges by hash', async () => {
    const database = new RecordingTotpD1Database(null, {
      id: 'challenge-id',
      userId: 'user-id',
      challengeHash: 'hashed-challenge',
      deviceIdentifier: 'device-id',
      expiresAt: '2026-07-06T00:05:00.000Z',
      consumedAt: null,
      createdAt: '2026-07-06T00:00:00.000Z',
    })

    await expect(
      findActiveTotpChallengeByHash(
        database,
        'hashed-challenge',
        '2026-07-06T00:01:00.000Z',
      ),
    ).resolves.toEqual({
      id: 'challenge-id',
      userId: 'user-id',
      challengeHash: 'hashed-challenge',
      deviceIdentifier: 'device-id',
      expiresAt: '2026-07-06T00:05:00.000Z',
      consumedAt: null,
      createdAt: '2026-07-06T00:00:00.000Z',
    })

    const query = database.queries.join('\n')
    expect(query).toContain('FROM totp_challenges')
    expect(query).toContain('consumed_at IS NULL')
    expect(query).toContain('expires_at > ?')
    expect(database.boundValues).toContain('hashed-challenge')
  })

  it('consumes login challenges once', async () => {
    await expect(
      consumeTotpChallenge(new RecordingTotpD1Database(null, null, 1), {
        challengeId: 'challenge-id',
        consumedAt: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toBe(true)

    const replayDatabase = new RecordingTotpD1Database(null, null, 0)
    await expect(
      consumeTotpChallenge(replayDatabase, {
        challengeId: 'challenge-id',
        consumedAt: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toBe(false)

    expect(replayDatabase.queries.join('\n')).toContain('consumed_at IS NULL')
  })
})

class RecordingTotpD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  constructor(
    private readonly setupRow: unknown = null,
    private readonly challengeRow: unknown = null,
    private readonly runChanges = 1,
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)

    const statement = {
      bind: (...values: unknown[]) => {
        this.boundValues.push(...values)

        return statement
      },
      first: async <T = unknown>(): Promise<T | null> => {
        if (query.includes('FROM user_totp')) {
          return this.setupRow as T | null
        }

        if (query.includes('FROM totp_challenges')) {
          return this.challengeRow as T | null
        }

        return null
      },
      all: async <T = unknown>(): Promise<D1Result<T>> => ({
        success: true,
        results: [],
        meta: fakeMeta,
      }),
      run: async (): Promise<D1Result> => ({
        success: true,
        results: [],
        meta: {
          ...fakeMeta,
          changes: this.runChanges,
        },
      }),
      raw: async <T = unknown>(): Promise<T[]> => [],
    } as D1PreparedStatement

    return statement
  }
}
