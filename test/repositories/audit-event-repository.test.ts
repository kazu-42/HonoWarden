import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import {
  auditEventRetentionPolicy,
  cleanupExpiredAuditEvents,
  persistAuditEvent,
} from '../../src/repositories/audit-event-repository'
import { FakeD1Database } from '../support/fake-d1'

describe('audit event repository', () => {
  it('persists sanitized audit events into explicit D1 columns', async () => {
    const database = new FakeD1Database(null, [])
    const event = buildAuditEvent({
      name: 'auth.password_grant',
      outcome: 'failure',
      requestId: 'audit-persist-request',
      occurredAt: '2026-07-09T00:00:00.000Z',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      target: {
        type: 'account',
        id: 'user-id',
      },
      context: {
        reason: 'invalid_grant',
        failedCount: 2,
        password: 'synthetic-master-password-hash',
        tokenHash: 'synthetic-token-hash',
        encryptedPayload: '2.encrypted-vault-payload',
        requestBody: '{"password":"secret"}',
      },
    })

    const persisted = await persistAuditEvent(database, event)

    expect(persisted.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(database.auditEventInserts).toHaveLength(1)
    expect(database.auditEventInserts[0]).toMatchObject({
      id: persisted.id,
      schemaVersion: 1,
      name: 'auth.password_grant',
      outcome: 'failure',
      requestId: 'audit-persist-request',
      occurredAt: '2026-07-09T00:00:00.000Z',
      actorUserId: 'user-id',
      actorDeviceIdentifier: 'fixture-device',
      targetType: 'account',
      targetId: 'user-id',
      contextJson: JSON.stringify({
        reason: 'invalid_grant',
        failedCount: 2,
      }),
    })
    const serializedInsert = JSON.stringify(database.auditEventInserts[0])
    expect(serializedInsert).not.toContain('synthetic-master-password-hash')
    expect(serializedInsert).not.toContain('synthetic-token-hash')
    expect(serializedInsert).not.toContain('2.encrypted-vault-payload')
    expect(serializedInsert).not.toContain('requestBody')
  })

  it('deletes expired audit events in bounded retention slices', async () => {
    const database = new FakeD1Database(null, [])

    const deleted = await cleanupExpiredAuditEvents(database, {
      expiredBefore: '2025-07-09T00:00:00.000Z',
      limit: auditEventRetentionPolicy.maxRowsPerCleanup,
    })

    expect(deleted).toBe(1)
    expect(database.auditEventCleanupDeletes).toEqual([
      {
        expiredBefore: '2025-07-09T00:00:00.000Z',
        limit: 100,
      },
    ])
    expect(auditEventRetentionPolicy.retentionDays).toBe(365)
    expect(auditEventRetentionPolicy.maxRowsPerCleanup).toBe(100)
  })
})
