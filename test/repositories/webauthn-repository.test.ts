import { describe, expect, it } from 'vitest'

import {
  cleanupExpiredWebAuthnChallenges,
  completeWebAuthnRegistration,
  consumeWebAuthnChallenge,
  createWebAuthnCredential,
  deleteWebAuthnCredential,
  findWebAuthnCredentialByCredentialId,
  findWebAuthnCredentialForOwner,
  issueWebAuthnChallenge,
  listWebAuthnCredentialsByUser,
  recordSuccessfulWebAuthnAssertion,
  renameWebAuthnCredential,
} from '../../src/repositories/webauthn-repository'
import type {
  WebAuthnChallengeRecord,
  WebAuthnCredentialRecord,
} from '../../src/repositories/webauthn-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

const credential: WebAuthnCredentialRecord = {
  id: 'row-1',
  userId: 'user-1',
  credentialId: 'credential-id',
  publicKey: 'cHVibGljLWtleQ',
  userHandle: 'user-handle',
  signCount: 0,
  credentialType: 'public-key',
  transports: ['internal'],
  aaguid: '00000000-0000-0000-0000-000000000000',
  discoverable: true,
  backupEligible: true,
  backupState: false,
  prfSupported: true,
  encryptedUserKey: null,
  encryptedPublicKey: null,
  encryptedPrivateKey: null,
  name: 'Passkey',
  createdAt: '2026-07-06T00:00:00.000Z',
  revisionDate: '2026-07-06T00:00:00.000Z',
  lastUsedAt: null,
}

const challenge: WebAuthnChallengeRecord = {
  id: 'challenge-1',
  tokenHash: 'token-hash',
  challengeHash: 'challenge-hash',
  purpose: 'authentication',
  userId: null,
  credentialId: null,
  rpId: 'example.com',
  originPolicyVersion: 'origin-policy',
  expiresAt: '2026-07-06T00:07:00.000Z',
  consumedAt: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  retentionDeleteAfter: '2026-07-07T00:07:00.000Z',
}

describe('WebAuthn repository', () => {
  it('issues hashed purpose-bound challenges without storing plaintext', async () => {
    const database = new RecordingWebAuthnDatabase()

    await issueWebAuthnChallenge(database, challenge)

    const query = database.queries.join('\n')
    expect(query).toContain('INSERT INTO webauthn_challenges')
    expect(query).toContain('token_hash')
    expect(query).toContain('challenge_hash')
    expect(query).toContain('origin_policy_version')
    expect(database.boundValues).toContain('token-hash')
    expect(database.boundValues).toContain('challenge-hash')
    expect(database.boundValues).not.toContain('opaque-route-token')
    expect(database.boundValues).not.toContain('raw-challenge')
  })

  it('consumes an unexpired challenge once and can bind an anonymous login', async () => {
    const database = new RecordingWebAuthnDatabase({ runChanges: 1 })

    await expect(
      consumeWebAuthnChallenge(database, {
        tokenHash: 'token-hash',
        purpose: 'authentication',
        rpId: 'example.com',
        originPolicyVersion: 'origin-policy',
        userId: 'user-1',
        credentialId: null,
        consumedAt: '2026-07-06T00:01:00.000Z',
        now: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'consumed' })

    const query = database.queries.join('\n')
    expect(query).toContain('UPDATE webauthn_challenges')
    expect(query).toContain('consumed_at IS NULL')
    expect(query).toContain('expires_at > ?')
    expect(query).toContain('purpose = ?')
    expect(query).toContain('origin_policy_version = ?')

    const replay = new RecordingWebAuthnDatabase({ runChanges: 0 })
    await expect(
      consumeWebAuthnChallenge(replay, {
        tokenHash: 'token-hash',
        purpose: 'authentication',
        rpId: 'example.com',
        originPolicyVersion: 'origin-policy',
        userId: 'user-1',
        credentialId: null,
        consumedAt: '2026-07-06T00:01:01.000Z',
        now: '2026-07-06T00:01:01.000Z',
      }),
    ).resolves.toEqual({ status: 'not_consumed' })
  })

  it('creates at most five owner credentials and looks up by exact owner', async () => {
    const created = new RecordingWebAuthnDatabase({ runChanges: 1 })
    await expect(
      createWebAuthnCredential(created, credential),
    ).resolves.toEqual({ status: 'created', credential })
    expect(created.queries.join('\n')).toContain(
      'INSERT INTO webauthn_credentials',
    )
    expect(created.queries.join('\n')).toContain('COUNT(*)')
    expect(created.boundValues).toContain('credential-id')

    const limited = new RecordingWebAuthnDatabase({ runChanges: 0 })
    await expect(
      createWebAuthnCredential(limited, credential),
    ).resolves.toEqual({ status: 'limit_reached' })

    const lookup = new RecordingWebAuthnDatabase({
      credentialRow: credentialRow(credential),
    })
    await expect(
      findWebAuthnCredentialForOwner(lookup, {
        id: 'row-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual(credential)
    expect(lookup.queries.join('\n')).toContain('user_id = ?')
    expect(lookup.boundValues).toEqual(['row-1', 'user-1'])

    await expect(
      findWebAuthnCredentialByCredentialId(lookup, 'credential-id'),
    ).resolves.toEqual(credential)
  })

  it('lists a bounded owner page and ignores other accounts', async () => {
    const database = new RecordingWebAuthnDatabase({
      credentialRows: [credentialRow(credential)],
    })

    await expect(
      listWebAuthnCredentialsByUser(database, {
        userId: 'user-1',
        limit: 5,
        cursor: null,
      }),
    ).resolves.toEqual({ items: [credential], hasMore: false })
    expect(database.queries.join('\n')).toContain('FROM webauthn_credentials')
    expect(database.queries.join('\n')).toContain('user_id = ?')
    expect(database.queries.join('\n')).toContain('LIMIT ?')
    expect(database.boundValues).toContain('user-1')
    expect(database.boundValues).toContain(6)
  })

  it('updates counter and backup state only after a successful assertion', async () => {
    const advanced = new RecordingWebAuthnDatabase({ runChanges: 1 })
    await expect(
      recordSuccessfulWebAuthnAssertion(advanced, {
        id: 'row-1',
        userId: 'user-1',
        nextSignCount: 4,
        backupEligible: true,
        backupState: true,
        now: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'updated' })
    expect(advanced.queries.join('\n')).toContain('UPDATE webauthn_credentials')
    expect(advanced.queries.join('\n')).toContain('sign_count = 0 AND ? = 0')
    expect(advanced.queries.join('\n')).toContain('? > sign_count')

    const rejected = new RecordingWebAuthnDatabase({ runChanges: 0 })
    await expect(
      recordSuccessfulWebAuthnAssertion(rejected, {
        id: 'row-1',
        userId: 'user-1',
        nextSignCount: 3,
        backupEligible: true,
        backupState: false,
        now: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_updated' })
  })

  it('renames and deletes only the owning account row', async () => {
    const renamed = new RecordingWebAuthnDatabase({ runChanges: 1 })
    await expect(
      renameWebAuthnCredential(renamed, {
        id: 'row-1',
        userId: 'user-1',
        name: 'Laptop',
        revisionDate: '2026-07-06T00:02:00.000Z',
      }),
    ).resolves.toEqual({ status: 'updated' })
    expect(renamed.queries.join('\n')).toContain('UPDATE webauthn_credentials')
    expect(renamed.boundValues).toEqual([
      'Laptop',
      '2026-07-06T00:02:00.000Z',
      '2026-07-06T00:02:00.000Z',
      'row-1',
      'user-1',
    ])

    const deleted = new RecordingWebAuthnDatabase({ runChanges: 1 })
    await expect(
      deleteWebAuthnCredential(deleted, { id: 'row-1', userId: 'user-1' }),
    ).resolves.toEqual({ status: 'deleted' })
    expect(deleted.queries.join('\n')).toContain(
      'DELETE FROM webauthn_credentials',
    )
    expect(deleted.queries.join('\n')).toContain('user_id = ?')

    const missing = new RecordingWebAuthnDatabase({ runChanges: 0 })
    await expect(
      deleteWebAuthnCredential(missing, { id: 'row-1', userId: 'user-2' }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('cleans expired or consumed challenges in bounded batches without touching credentials', async () => {
    const database = new RecordingWebAuthnDatabase({ deleteChanges: 4 })

    await expect(
      cleanupExpiredWebAuthnChallenges(database, {
        expiredBefore: '2026-07-07T00:00:00.000Z',
        limit: 5,
      }),
    ).resolves.toEqual({ deletedExpiredChallenges: 4 })
    expect(database.queries.join('\n')).toContain(
      'DELETE FROM webauthn_challenges',
    )
    expect(database.queries.join('\n')).toContain('retention_delete_after <= ?')
    expect(database.queries.join('\n')).toContain('LIMIT ?')
    expect(database.queries.join('\n')).not.toContain(
      'DELETE FROM webauthn_credentials',
    )
    expect(database.boundValues).toEqual(['2026-07-07T00:00:00.000Z', 5])
  })

  it('consumes a registration challenge and inserts a credential in one batch', async () => {
    const database = new RecordingWebAuthnDatabase({
      runChanges: 1,
      credentialRows: [],
    })

    await expect(
      completeWebAuthnRegistration(database, {
        consume: {
          tokenHash: 'token-hash',
          challengeHash: 'challenge-hash',
          purpose: 'registration',
          rpId: 'example.com',
          originPolicyVersion: 'origin-policy',
          userId: 'user-1',
          credentialId: null,
          consumedAt: '2026-07-06T00:01:00.000Z',
          now: '2026-07-06T00:01:00.000Z',
        },
        credential,
      }),
    ).resolves.toEqual({ status: 'created', credential })

    const query = database.queries.join('\n')
    expect(query).toContain('UPDATE webauthn_challenges')
    expect(query).toContain('INSERT INTO webauthn_credentials')
    expect(query).toContain('challenge_hash = ?')
    expect(query).toContain('NOT EXISTS')
    expect(database.batchCount).toBe(1)
    expect(database.boundValues).toContain('challenge-hash')
    expect(database.boundValues).not.toContain('raw-challenge')
    expect(database.boundValues).not.toContain('opaque-route-token')
  })
})

function credentialRow(record: WebAuthnCredentialRecord) {
  return {
    ...record,
    discoverable: record.discoverable ? 1 : 0,
    backupEligible: record.backupEligible ? 1 : 0,
    backupState: record.backupState ? 1 : 0,
    prfSupported: record.prfSupported ? 1 : 0,
    transports: JSON.stringify(record.transports),
  }
}

class RecordingWebAuthnDatabase {
  boundValues: unknown[] = []
  queries: string[] = []
  batchCount = 0
  private remainingDeleteChanges: number

  constructor(
    private readonly options: {
      credentialRow?: unknown
      credentialRows?: unknown[]
      runChanges?: number
      deleteChanges?: number
    } = {},
  ) {
    this.remainingDeleteChanges = options.deleteChanges ?? 0
  }

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const statement = {
      bind: (...values: unknown[]) => {
        this.boundValues.push(...values)
        return statement
      },
      first: async <T = unknown>(): Promise<T | null> => {
        if (query.includes('FROM webauthn_credentials')) {
          return (this.options.credentialRow ?? null) as T | null
        }
        return null
      },
      all: async <T = unknown>(): Promise<D1Result<T>> => ({
        success: true,
        results: (this.options.credentialRows ?? []) as T[],
        meta: fakeMeta,
      }),
      run: async (): Promise<D1Result> => {
        if (query.includes('DELETE FROM webauthn_challenges')) {
          const changes = this.remainingDeleteChanges
          this.remainingDeleteChanges = 0
          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }
        return {
          success: true,
          results: [],
          meta: { ...fakeMeta, changes: this.options.runChanges ?? 1 },
        }
      },
      raw: async <T = unknown>(): Promise<T[]> => [],
    } as D1PreparedStatement
    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchCount += 1
    const results: D1Result<T>[] = []
    for (const statement of statements) {
      results.push((await statement.run()) as D1Result<T>)
    }
    return results
  }
}
