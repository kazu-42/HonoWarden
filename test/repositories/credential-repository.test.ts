import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import { rotateAccountSecurityStamp } from '../../src/repositories/credential-repository'
import { FakeD1Database } from '../support/fake-d1'

const rotationInput = {
  userId: 'user-id',
  expectedMasterPasswordHash: 'synthetic-authentication-hash',
  expectedSecurityStamp: 'old-security-stamp',
  expectedRevisionDate: '2026-07-19T00:00:00.000Z',
  nextSecurityStamp: 'next-security-stamp',
  nextRevisionDate: '2026-07-19T00:00:01.000Z',
  auditEventId: 'audit-event-id',
  auditEvent: buildAuditEvent({
    name: 'account.security_stamp.rotate',
    outcome: 'success',
    requestId: 'credential-rotation-request',
    occurredAt: '2026-07-19T00:00:01.000Z',
    actor: {
      userId: 'user-id',
      deviceIdentifier: 'fixture-device',
    },
    target: {
      type: 'account',
      id: 'user-id',
    },
    context: {
      allSessionsRevoked: true,
    },
  }),
} as const

describe('credential repository', () => {
  it('rotates one generation, revokes every owner session, and inserts one audit event', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)

    await expect(
      rotateAccountSecurityStamp(database, rotationInput),
    ).resolves.toEqual({
      status: 'rotated',
      securityStamp: 'next-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
      revokedDeviceCount: 2,
      revokedRefreshTokenCount: 2,
      auditEventId: 'audit-event-id',
    })

    expect(state.authUser).toMatchObject({
      securityStamp: 'next-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
      updatedAt: '2026-07-19T00:00:01.000Z',
    })
    expect(state.devices.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-id',
          revokedAt: '2026-07-19T00:00:01.000Z',
        }),
        expect.objectContaining({
          userId: 'user-id',
          revokedAt: '2026-07-19T00:00:01.000Z',
        }),
      ]),
    )
    expect(state.devices[2]).not.toHaveProperty('revokedAt')
    expect(state.refreshTokens.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-id',
          revokedAt: '2026-07-19T00:00:01.000Z',
        }),
        expect.objectContaining({
          userId: 'user-id',
          revokedAt: '2026-07-19T00:00:01.000Z',
        }),
      ]),
    )
    expect(state.refreshTokens[2]).not.toHaveProperty('revokedAt')
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        id: 'audit-event-id',
        name: 'account.security_stamp.rotate',
        outcome: 'success',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'account',
        targetId: 'user-id',
        contextJson: JSON.stringify({ allSessionsRevoked: true }),
      }),
    ])
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'synthetic-authentication-hash',
    )
  })

  it('leaves every table unchanged when the expected generation is stale', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)
    const before = structuredClone(state)

    await expect(
      rotateAccountSecurityStamp(database, {
        ...rotationInput,
        expectedSecurityStamp: 'stale-security-stamp',
      }),
    ).resolves.toEqual({ status: 'conflict' })

    expect(state).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
  })

  it.each(['user', 'devices', 'refresh_tokens', 'audit'] as const)(
    'rolls the complete batch back when the %s statement fails',
    async (stage) => {
      const state = {
        ...credentialState(),
        credentialRotationFailureAt: stage,
      }
      const database = new FakeD1Database(null, [], state)
      const before = structuredClone({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
      })

      await expect(
        rotateAccountSecurityStamp(database, rotationInput),
      ).rejects.toThrow(`credential rotation ${stage} failed`)

      expect({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
      }).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    },
  )

  it('allows only one concurrent mutation from the same expected generation', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)

    const results = await Promise.all([
      rotateAccountSecurityStamp(database, rotationInput),
      rotateAccountSecurityStamp(database, {
        ...rotationInput,
        nextSecurityStamp: 'competing-security-stamp',
        auditEventId: 'competing-audit-event-id',
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual([
      'conflict',
      'rotated',
    ])
    expect(database.auditEventInserts).toHaveLength(1)
  })
})

function credentialState() {
  return {
    authUser: {
      id: 'user-id',
      masterPasswordHash: 'synthetic-authentication-hash',
      securityStamp: 'old-security-stamp',
      revisionDate: '2026-07-19T00:00:00.000Z',
      disabledAt: null,
    },
    devices: [
      { id: 'device-one', userId: 'user-id' },
      { id: 'device-two', userId: 'user-id' },
      { id: 'external-device', userId: 'external-user-id' },
    ],
    refreshTokens: [
      { id: 'token-one', userId: 'user-id' },
      { id: 'token-two', userId: 'user-id' },
      { id: 'external-token', userId: 'external-user-id' },
    ],
  }
}
