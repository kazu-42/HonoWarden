import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import { fingerprintCredentialWrapper } from '../../src/domain/account-credentials'
import {
  changeAccountEmail,
  beginRecoverableAccountDeletion,
  markAccountLifecycleTokenDeliveryAccepted,
  markAccountLifecycleTokenDeliveryFailed,
  reserveAccountLifecycleToken,
  verifyAccountEmail,
} from '../../src/repositories/account-lifecycle-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

type RecordedStatement = { query: string; bindings: unknown[] }

class RecordingDatabase {
  readonly batchCalls: RecordedStatement[][] = []
  readonly runCalls: RecordedStatement[] = []
  private readonly records = new WeakMap<object, RecordedStatement>()

  constructor(
    private readonly batchChanges: number[] = [1, 1],
    private readonly runChanges = 1,
    private readonly batchRows: unknown[][] = [],
  ) {}

  prepare(query: string): D1PreparedStatement {
    const record = { query, bindings: [] as unknown[] }
    const statement = {
      bind: (...bindings: unknown[]) => {
        record.bindings = bindings
        return statement as unknown as D1PreparedStatement
      },
      run: async () => {
        this.runCalls.push(record)
        return {
          success: true,
          results: [],
          meta: { ...fakeMeta, changes: this.runChanges },
        }
      },
    }
    this.records.set(statement, record)
    return statement as unknown as D1PreparedStatement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchCalls.push(
      statements.map((statement) => {
        const record = this.records.get(statement as object)
        if (!record) throw new Error('Unrecorded statement')
        return record
      }),
    )
    return statements.map((_, index) => ({
      success: true,
      results: (this.batchRows[index] ?? []) as T[],
      meta: { ...fakeMeta, changes: this.batchChanges[index] ?? 0 },
    }))
  }
}

describe('account lifecycle repository', () => {
  it('supersedes the old purpose token and reserves only a digest for the current account generation', async () => {
    const database = new RecordingDatabase()

    await expect(
      reserveAccountLifecycleToken(database as unknown as D1Database, {
        id: 'token-id-2',
        userId: 'user-1',
        purpose: 'email_change',
        tokenDigest: 'd'.repeat(64),
        targetEmailNormalized: 'next@example.test',
        expectedCredentialGeneration: 'security-stamp-1',
        now: '2026-08-08T00:00:00.000Z',
        expiresAt: '2026-08-08T00:15:00.000Z',
      }),
    ).resolves.toEqual({ status: 'reserved' })

    expect(database.batchCalls).toHaveLength(1)
    expect(database.batchCalls[0]).toHaveLength(2)
    const [supersede, insert] = database.batchCalls[0] ?? []
    expect(supersede?.query).toContain('UPDATE account_lifecycle_tokens')
    expect(supersede?.query).toContain('superseded_at = ?')
    expect(insert?.query).toContain('INSERT INTO account_lifecycle_tokens')
    expect(insert?.query).toContain('FROM users')
    expect(insert?.query).toContain('security_stamp = ?')
    expect(insert?.query).toContain('disabled_at IS NULL')
    expect(insert?.query).toContain('email_normalized <> ?')
    expect(insert?.query).toContain('NOT EXISTS')
    expect(insert?.bindings).toContain('d'.repeat(64))
    expect(JSON.stringify(database.batchCalls)).not.toContain('raw-token')
  })

  it('returns a generic unavailable result when the generation or target guard rejects reservation', async () => {
    const database = new RecordingDatabase([0, 0])

    await expect(
      reserveAccountLifecycleToken(database as unknown as D1Database, {
        id: 'token-id',
        userId: 'user-1',
        purpose: 'email_change',
        tokenDigest: 'd'.repeat(64),
        targetEmailNormalized: 'taken@example.test',
        expectedCredentialGeneration: 'stale-stamp',
        now: '2026-08-08T00:00:00.000Z',
        expiresAt: '2026-08-08T00:15:00.000Z',
      }),
    ).resolves.toEqual({ status: 'unavailable' })
  })

  it('marks accepted delivery once and makes failed delivery unusable', async () => {
    const acceptedDatabase = new RecordingDatabase()
    const failedDatabase = new RecordingDatabase()

    await expect(
      markAccountLifecycleTokenDeliveryAccepted(
        acceptedDatabase as unknown as D1Database,
        'token-id',
        '2026-08-08T00:00:01.000Z',
      ),
    ).resolves.toEqual({ status: 'updated' })
    expect(acceptedDatabase.runCalls[0]?.query).toContain(
      "delivery_state = 'accepted'",
    )
    expect(acceptedDatabase.runCalls[0]?.query).toContain(
      "delivery_state = 'pending'",
    )

    await expect(
      markAccountLifecycleTokenDeliveryFailed(
        failedDatabase as unknown as D1Database,
        'token-id',
        '2026-08-08T00:00:01.000Z',
      ),
    ).resolves.toEqual({ status: 'updated' })
    expect(failedDatabase.runCalls[0]?.query).toContain(
      "delivery_state = 'failed'",
    )
    expect(failedDatabase.runCalls[0]?.query).toContain('superseded_at = ?')
  })

  it('changes email, credential generation, sessions, linked membership email, token, and audit in one guarded batch', async () => {
    const oldWrapperSha256 = await fingerprintCredentialWrapper(
      'old-wrapped-user-key',
    )
    const nextWrapperSha256 = await fingerprintCredentialWrapper(
      'next-wrapped-user-key',
    )
    const database = new RecordingDatabase([1, 2, 1, 2, 3, 4, 1, 1], 1, [
      [{ id: 'user-1' }],
      [
        { wrapperKind: 'user_key', wrapperSha256: oldWrapperSha256 },
        { wrapperKind: 'user_key', wrapperSha256: nextWrapperSha256 },
      ],
    ])
    const auditEvent = buildAuditEvent({
      name: 'account.email.change',
      outcome: 'success',
      requestId: 'request-1',
      occurredAt: '2026-08-08T00:00:01.000Z',
      actor: { userId: 'user-1', deviceIdentifier: 'device-1' },
      target: { type: 'account', id: 'user-1' },
      context: { d1SessionsRevoked: true },
    })

    await expect(
      changeAccountEmail(database as unknown as D1Database, {
        userId: 'user-1',
        expectedEmailNormalized: 'old@example.test',
        expectedMasterPasswordHash: 'current-hash',
        expectedUserKey: 'old-wrapped-user-key',
        expectedSecurityStamp: 'security-stamp-1',
        expectedRevisionDate: '2026-08-08T00:00:00.000Z',
        tokenDigest: 'd'.repeat(64),
        tokenCredentialGeneration: 'security-stamp-1',
        nextEmail: 'Next@Example.Test',
        nextEmailNormalized: 'next@example.test',
        nextMasterPasswordHash: 'next-hash',
        nextUserKey: 'next-wrapped-user-key',
        nextSecurityStamp: 'security-stamp-2',
        nextRevisionDate: '2026-08-08T00:00:01.000Z',
        auditEventId: 'audit-1',
        auditEvent,
      }),
    ).resolves.toEqual({
      status: 'changed',
      revokedDeviceCount: 3,
      revokedRefreshTokenCount: 4,
      invalidatedAuthRequestCount: 1,
      updatedOrganizationMembershipCount: 2,
    })

    expect(database.batchCalls[0]).toHaveLength(8)
    const queries = database.batchCalls[0]?.map((statement) => statement.query)
    expect(queries?.[0]).toContain('UPDATE users')
    expect(queries?.[0]).toContain('email_verified_at = ?')
    expect(queries?.[0]).toContain('account_lifecycle_tokens')
    expect(queries?.[1]).toContain('user_key_rotation_wrapper_history')
    expect(queries?.[2]).toContain("purpose = 'email_change'")
    expect(queries?.[2]).toContain('consumed_at = ?')
    expect(queries?.[3]).toContain('UPDATE organization_users')
    expect(queries?.[4]).toContain('UPDATE devices')
    expect(queries?.[5]).toContain('UPDATE refresh_tokens')
    expect(queries?.[6]).toContain('UPDATE auth_requests')
    expect(queries?.[7]).toContain('INSERT INTO audit_events')
    expect(JSON.stringify(database.batchCalls)).not.toContain('raw-token')
  })

  it('returns conflict without downstream mutation when email token generation is stale', async () => {
    const database = new RecordingDatabase([0, 0, 0, 0, 0, 0, 0, 0])
    const auditEvent = buildAuditEvent({
      name: 'account.email.change',
      outcome: 'success',
      requestId: 'request-1',
      occurredAt: '2026-08-08T00:00:01.000Z',
    })

    await expect(
      changeAccountEmail(database as unknown as D1Database, {
        userId: 'user-1',
        expectedEmailNormalized: 'old@example.test',
        expectedMasterPasswordHash: 'current-hash',
        expectedUserKey: 'old-wrapped-user-key',
        expectedSecurityStamp: 'security-stamp-1',
        expectedRevisionDate: '2026-08-08T00:00:00.000Z',
        tokenDigest: 'd'.repeat(64),
        tokenCredentialGeneration: 'security-stamp-1',
        nextEmail: 'Next@Example.Test',
        nextEmailNormalized: 'next@example.test',
        nextMasterPasswordHash: 'next-hash',
        nextUserKey: 'next-wrapped-user-key',
        nextSecurityStamp: 'security-stamp-2',
        nextRevisionDate: '2026-08-08T00:00:01.000Z',
        auditEventId: 'audit-1',
        auditEvent,
      }),
    ).resolves.toEqual({ status: 'conflict' })
  })

  it('verifies email by consuming one accepted generation-bound token with audit', async () => {
    const database = new RecordingDatabase([1, 1, 1], 1, [[{ id: 'user-1' }]])
    const auditEvent = buildAuditEvent({
      name: 'account.email.verify',
      outcome: 'success',
      requestId: 'verify-request',
      occurredAt: '2026-08-08T00:00:01.000Z',
      target: { type: 'account', id: 'user-1' },
    })

    await expect(
      verifyAccountEmail(database as unknown as D1Database, {
        userId: 'user-1',
        credentialGeneration: 'security-stamp-1',
        tokenDigest: 'e'.repeat(64),
        now: '2026-08-08T00:00:01.000Z',
        auditEventId: 'audit-verify',
        auditEvent,
      }),
    ).resolves.toEqual({ status: 'verified' })

    expect(database.batchCalls[0]?.map((statement) => statement.query)).toEqual(
      [
        expect.stringContaining('email_verified_at = ?'),
        expect.stringContaining("purpose = 'email_verify'"),
        expect.stringContaining('INSERT INTO audit_events'),
      ],
    )
    expect(JSON.stringify(database.batchCalls)).not.toContain('raw-token')
  })

  it('atomically disables a non-last-owner account without deleting personal or organization data', async () => {
    const database = new RecordingDatabase([0, 1, 1, 0, 2, 2, 1, 1], 1, [
      [{ lastOwnerCount: 0 }],
      [{ id: 'user-1' }],
    ])
    const auditEvent = buildAuditEvent({
      name: 'account.deletion.request',
      outcome: 'success',
      requestId: 'delete-request',
      occurredAt: '2026-08-08T00:00:01.000Z',
      actor: { userId: 'user-1', deviceIdentifier: 'device-1' },
      target: { type: 'account', id: 'user-1' },
      context: { recoveryWindowDays: 30 },
    })

    await expect(
      beginRecoverableAccountDeletion(database as unknown as D1Database, {
        userId: 'user-1',
        expectedMasterPasswordHash: 'current-hash',
        expectedSecurityStamp: 'security-stamp-1',
        expectedRevisionDate: '2026-08-08T00:00:00.000Z',
        tokenDigest: null,
        lifecycleGeneration: 'deletion-generation-1',
        nextSecurityStamp: 'security-stamp-2',
        now: '2026-08-08T00:00:01.000Z',
        recoverUntil: '2026-09-07T00:00:01.000Z',
        auditEventId: 'delete-audit',
        auditEvent,
      }),
    ).resolves.toEqual({
      status: 'recoverable',
      lifecycleGeneration: 'deletion-generation-1',
      recoverUntil: '2026-09-07T00:00:01.000Z',
      revokedDeviceCount: 2,
      revokedRefreshTokenCount: 2,
      invalidatedAuthRequestCount: 1,
    })

    const sql = database.batchCalls[0]?.map((statement) => statement.query)
    expect(sql).toHaveLength(8)
    expect(sql?.[0]).toContain('lastOwnerCount')
    expect(sql?.[1]).toContain('disabled_at = ?')
    expect(sql?.[1]).toContain('other_owner')
    expect(sql?.[2]).toContain('INSERT INTO account_deletions')
    expect(sql?.[3]).toContain('UPDATE account_lifecycle_tokens')
    expect(sql?.join('\n')).not.toContain('DELETE FROM users')
    expect(sql?.join('\n')).not.toContain('DELETE FROM ciphers')
  })

  it('rejects the last confirmed organization owner without partial disablement', async () => {
    const database = new RecordingDatabase([0, 0, 0, 0, 0, 0, 0, 0], 1, [
      [{ lastOwnerCount: 1 }],
      [],
    ])
    const auditEvent = buildAuditEvent({
      name: 'account.deletion.request',
      outcome: 'success',
      requestId: 'delete-request',
      occurredAt: '2026-08-08T00:00:01.000Z',
    })

    await expect(
      beginRecoverableAccountDeletion(database as unknown as D1Database, {
        userId: 'user-1',
        expectedMasterPasswordHash: 'current-hash',
        expectedSecurityStamp: 'security-stamp-1',
        expectedRevisionDate: '2026-08-08T00:00:00.000Z',
        tokenDigest: null,
        lifecycleGeneration: 'deletion-generation-1',
        nextSecurityStamp: 'security-stamp-2',
        now: '2026-08-08T00:00:01.000Z',
        recoverUntil: '2026-09-07T00:00:01.000Z',
        auditEventId: 'delete-audit',
        auditEvent,
      }),
    ).resolves.toEqual({ status: 'last_owner' })
  })
})
