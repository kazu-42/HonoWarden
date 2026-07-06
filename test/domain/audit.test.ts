import { describe, expect, it } from 'vitest'

import {
  buildAuditEvent,
  isAuditLoggingEnabled,
  serializeAuditEvent,
} from '../../src/domain/audit'

describe('audit domain', () => {
  it('builds stable, secret-safe audit events', () => {
    const event = buildAuditEvent({
      name: 'auth.password_grant',
      outcome: 'failure',
      requestId: 'request-id',
      occurredAt: '2026-07-06T00:00:00.000Z',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      context: {
        reason: 'invalid_grant',
        password: 'synthetic-master-password-hash',
        refreshToken: 'synthetic-refresh-token',
        encryptedPayload: '2.encrypted-value',
        failedCount: 1,
      },
    })

    expect(event).toEqual({
      object: 'auditEvent',
      schemaVersion: 1,
      name: 'auth.password_grant',
      outcome: 'failure',
      requestId: 'request-id',
      occurredAt: '2026-07-06T00:00:00.000Z',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      context: {
        reason: 'invalid_grant',
        failedCount: 1,
      },
    })
    expect(serializeAuditEvent(event)).not.toContain(
      'synthetic-master-password-hash',
    )
    expect(serializeAuditEvent(event)).not.toContain('synthetic-refresh-token')
    expect(serializeAuditEvent(event)).not.toContain('2.encrypted-value')
  })

  it('keeps audit logging opt-in', () => {
    expect(isAuditLoggingEnabled(undefined)).toBe(false)
    expect(isAuditLoggingEnabled('false')).toBe(false)
    expect(isAuditLoggingEnabled('true')).toBe(true)
  })
})
