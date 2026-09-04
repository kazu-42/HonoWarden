import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import {
  acceptInvitedEmergencyAccess,
  confirmAcceptedEmergencyAccess,
  deleteEmergencyAccess,
  insertInvitedEmergencyAccess,
  listGrantedEmergencyAccess,
  listTrustedEmergencyAccess,
} from '../../src/repositories/emergency-access-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

const invitedRow = {
  id: 'relationship-id',
  grantorUserId: 'grantor-id',
  granteeUserId: null,
  emailNormalized: 'grantee@example.test',
  type: 0,
  status: 0,
  waitTimeDays: 7,
  createdAt: '2026-09-04T12:00:00.000Z',
  revisionDate: '2026-09-04T12:00:00.000Z',
  updatedAt: '2026-09-04T12:00:00.000Z',
  keyGeneration: null,
}

class RecordingEmergencyAccessD1 {
  readonly queries: string[] = []
  readonly boundValues: unknown[] = []
  batchCalls = 0

  constructor(private readonly mutationChanges = 1) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const statement = {
      bind: (...bindings: unknown[]) => {
        this.boundValues.push(...bindings)
        return statement as unknown as D1PreparedStatement
      },
      all: async () => this.result([invitedRow]),
      run: async () => this.result([]),
      first: async () => invitedRow,
    }
    return statement as unknown as D1PreparedStatement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchCalls += 1
    return statements.map(() => this.result([invitedRow]) as D1Result<T>)
  }

  private result<T>(results: T[]): D1Result<T> {
    return {
      success: true,
      results,
      meta: { ...fakeMeta, changes: this.mutationChanges },
    }
  }
}

describe('emergency access repository', () => {
  it('inserts invited state as a hashed proof and never binds a raw token', async () => {
    const database = new RecordingEmergencyAccessD1()
    const auditEvent = buildAuditEvent({
      name: 'emergency.invite',
      outcome: 'success',
      requestId: 'request-id',
      occurredAt: invitedRow.createdAt,
      actor: { userId: 'grantor-id' },
      target: { type: 'emergency_access', id: 'relationship-id' },
      context: { toStatus: 0 },
    })

    await expect(
      insertInvitedEmergencyAccess(
        database,
        {
          id: 'relationship-id',
          grantorUserId: 'grantor-id',
          emailNormalized: 'grantee@example.test',
          type: 0,
          waitTimeDays: 7,
          inviteTokenHash: 'hmac-sha256:v1:synthetic-invite-hash',
          inviteExpiresAt: '2026-09-09T12:00:00.000Z',
          createdAt: invitedRow.createdAt,
        },
        auditEvent,
      ),
    ).resolves.toMatchObject({ status: 'created' })
    expect(database.queries[0]).toContain('INSERT INTO emergency_access')
    expect(database.queries[0]).toContain('invite_token_hash')
    expect(database.queries[0]).not.toContain('invite_token ')
    expect(JSON.stringify(database.boundValues)).not.toContain(
      'raw-invite-token',
    )
    expect(database.queries[1]).toContain('INSERT INTO audit_events')
    expect(JSON.stringify(auditEvent)).not.toContain('raw-invite-token')
  })

  it('accepts only with a matching hashed token, recipient email, and invited status', async () => {
    const database = new RecordingEmergencyAccessD1()

    await acceptInvitedEmergencyAccess(database, {
      id: 'relationship-id',
      granteeUserId: 'grantee-id',
      emailNormalized: 'grantee@example.test',
      inviteTokenHash: 'hmac-sha256:v1:synthetic-invite-hash',
      now: '2026-09-04T13:00:00.000Z',
    })
    expect(database.queries[0]).toContain('UPDATE emergency_access')
    expect(database.queries[0]).toContain('status = 0')
    expect(database.queries[0]).toContain('email_normalized = ?')
    expect(database.queries[0]).toContain('invite_token_hash = ?')
    expect(database.queries[0]).toContain('invite_expires_at > ?')
    expect(database.queries[0]).toContain('invite_token_hash = NULL')
    expect(database.queries[0]).toContain('RETURNING')
    expect(database.queries[0]).not.toContain('key_encrypted')
  })

  it('confirms only accepted rows owned by the grantor', async () => {
    const database = new RecordingEmergencyAccessD1()

    await confirmAcceptedEmergencyAccess(database, {
      id: 'relationship-id',
      grantorUserId: 'grantor-id',
      keyEncrypted: 'opaque-wrap',
      keyGeneration: 1,
      now: '2026-09-04T14:00:00.000Z',
    })
    expect(database.queries[0]).toContain('status = 1')
    expect(database.queries[0]).toContain('grantor_user_id = ?')
    expect(database.queries[0]).toContain('key_encrypted IS NULL')
  })

  it('lists trusted and granted contacts without selecting wrapped keys or invite hashes', async () => {
    const database = new RecordingEmergencyAccessD1()

    await listTrustedEmergencyAccess(database, 'grantor-id')
    await listGrantedEmergencyAccess(database, 'grantee-id')
    expect(database.queries[0]).toContain('grantor_user_id = ?')
    expect(database.queries[1]).toContain('grantee_user_id = ?')
    expect(database.queries.join('\n')).not.toContain('key_encrypted')
    expect(database.queries.join('\n')).not.toContain('invite_token_hash')
  })

  it('deletes through grantor or bound grantee predicates', async () => {
    const database = new RecordingEmergencyAccessD1()

    await deleteEmergencyAccess(database, {
      id: 'relationship-id',
      actorUserId: 'grantor-id',
      role: 'grantor',
    })
    await deleteEmergencyAccess(database, {
      id: 'relationship-id',
      actorUserId: 'grantee-id',
      role: 'grantee',
    })
    expect(database.queries[0]).toContain('grantor_user_id')
    expect(database.queries[1]).toContain('grantee_user_id')
  })
})
