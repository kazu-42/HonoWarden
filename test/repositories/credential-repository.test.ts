import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import {
  changeAccountKdf,
  changeAccountMasterPassword,
  rotateAccountSecurityStamp,
} from '../../src/repositories/credential-repository'
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

const passwordChangeInput = {
  ...rotationInput,
  expectedEmailNormalized: 'person@example.test',
  expectedKdfAlgorithm: 'pbkdf2-sha256',
  expectedKdfIterations: 600000,
  expectedKdfMemory: null,
  expectedKdfParallelism: null,
  nextMasterPasswordHash: 'synthetic-next-authentication-hash',
  nextUserKey: '2.synthetic-next-wrapped-user-key',
  auditEventId: 'password-change-audit-event-id',
  auditEvent: buildAuditEvent({
    name: 'account.password.change',
    outcome: 'success',
    requestId: 'password-change-request',
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
      d1SessionsRevoked: true,
      kdfUnchanged: true,
    },
  }),
} as const

const kdfChangeInput = {
  ...passwordChangeInput,
  nextKdfAlgorithm: 'argon2id',
  nextKdfIterations: 6,
  nextKdfMemory: 32,
  nextKdfParallelism: 4,
  auditEventId: 'kdf-change-audit-event-id',
  auditEvent: buildAuditEvent({
    name: 'account.kdf.change',
    outcome: 'success',
    requestId: 'kdf-change-request',
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
      d1SessionsRevoked: true,
      previousKdfType: 0,
      nextKdfType: 1,
    },
  }),
} as const

describe('credential repository', () => {
  it('changes the complete KDF generation and revokes every session atomically', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)

    await expect(changeAccountKdf(database, kdfChangeInput)).resolves.toEqual({
      status: 'changed',
      securityStamp: 'next-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
      revokedDeviceCount: 2,
      revokedRefreshTokenCount: 2,
      invalidatedAuthRequestCount: 2,
      auditEventId: 'kdf-change-audit-event-id',
    })

    expect(state.authUser).toMatchObject({
      masterPasswordHash: 'synthetic-next-authentication-hash',
      userKey: '2.synthetic-next-wrapped-user-key',
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      securityStamp: 'next-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
    })
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        name: 'account.kdf.change',
        contextJson: JSON.stringify({
          d1SessionsRevoked: true,
          previousKdfType: 0,
          nextKdfType: 1,
        }),
      }),
    ])
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'synthetic-next-authentication-hash',
    )
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'synthetic-next-wrapped-user-key',
    )
  })

  it.each([
    ['hash', { expectedMasterPasswordHash: 'stale-hash' }],
    ['salt', { expectedEmailNormalized: 'stale@example.test' }],
    ['KDF', { expectedKdfIterations: 600001 }],
    ['stamp', { expectedSecurityStamp: 'stale-security-stamp' }],
    ['revision', { expectedRevisionDate: '2026-07-18T00:00:00.000Z' }],
  ] as const)(
    'leaves the KDF generation and sessions unchanged on stale %s state',
    async (_name, staleInput) => {
      const state = credentialState()
      const database = new FakeD1Database(null, [], state)
      const before = structuredClone(state)

      await expect(
        changeAccountKdf(database, { ...kdfChangeInput, ...staleInput }),
      ).resolves.toEqual({ status: 'conflict' })
      expect(state).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    },
  )

  it.each([
    'user',
    'devices',
    'refresh_tokens',
    'auth_requests',
    'audit',
  ] as const)(
    'rolls KDF change back when the %s statement fails',
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
        authRequests: state.authRequests,
      })

      await expect(changeAccountKdf(database, kdfChangeInput)).rejects.toThrow(
        `credential rotation ${stage} failed`,
      )
      expect({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
        authRequests: state.authRequests,
      }).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    },
  )

  it('commits only one concurrent KDF change from the same generation', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)
    const results = await Promise.all([
      changeAccountKdf(database, kdfChangeInput),
      changeAccountKdf(database, {
        ...kdfChangeInput,
        nextKdfIterations: 7,
        nextSecurityStamp: 'competing-security-stamp',
        auditEventId: 'competing-kdf-change-audit-id',
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual([
      'changed',
      'conflict',
    ])
    expect(database.auditEventInserts).toHaveLength(1)
  })

  it('changes the password generation and revokes every session atomically', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)

    await expect(
      changeAccountMasterPassword(database, passwordChangeInput),
    ).resolves.toEqual({
      status: 'changed',
      securityStamp: 'next-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
      revokedDeviceCount: 2,
      revokedRefreshTokenCount: 2,
      invalidatedAuthRequestCount: 2,
      auditEventId: 'password-change-audit-event-id',
    })

    expect(state.authUser).toMatchObject({
      masterPasswordHash: 'synthetic-next-authentication-hash',
      userKey: '2.synthetic-next-wrapped-user-key',
      securityStamp: 'next-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
      emailNormalized: 'person@example.test',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    })
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        id: 'password-change-audit-event-id',
        name: 'account.password.change',
        contextJson: JSON.stringify({
          d1SessionsRevoked: true,
          kdfUnchanged: true,
        }),
      }),
    ])
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'synthetic-next-authentication-hash',
    )
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'synthetic-next-wrapped-user-key',
    )
  })

  it.each([
    ['salt', { expectedEmailNormalized: 'stale@example.test' }],
    ['KDF', { expectedKdfIterations: 600001 }],
    ['revision', { expectedRevisionDate: '2026-07-18T00:00:00.000Z' }],
  ] as const)(
    'leaves credentials and sessions unchanged on stale %s generation',
    async (_name, staleInput) => {
      const state = credentialState()
      const database = new FakeD1Database(null, [], state)
      const before = structuredClone(state)

      await expect(
        changeAccountMasterPassword(database, {
          ...passwordChangeInput,
          ...staleInput,
        }),
      ).resolves.toEqual({ status: 'conflict' })
      expect(state).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    },
  )

  it.each([
    'user',
    'devices',
    'refresh_tokens',
    'auth_requests',
    'audit',
  ] as const)(
    'rolls password change back when the %s statement fails',
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
        authRequests: state.authRequests,
      })

      await expect(
        changeAccountMasterPassword(database, passwordChangeInput),
      ).rejects.toThrow(`credential rotation ${stage} failed`)
      expect({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
        authRequests: state.authRequests,
      }).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    },
  )

  it('commits only one concurrent password change from the same generation', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)
    const results = await Promise.all([
      changeAccountMasterPassword(database, passwordChangeInput),
      changeAccountMasterPassword(database, {
        ...passwordChangeInput,
        nextMasterPasswordHash: 'competing-next-hash',
        nextUserKey: '2.competing-next-user-key',
        nextSecurityStamp: 'competing-security-stamp',
        auditEventId: 'competing-password-change-audit-id',
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual([
      'changed',
      'conflict',
    ])
    expect(database.auditEventInserts).toHaveLength(1)
  })

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
      invalidatedAuthRequestCount: 2,
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
    expect(state.authRequests.slice(0, 2)).toEqual([
      expect.objectContaining({
        userId: 'user-id',
        status: 'superseded',
        requestApproved: 0,
        encryptedResponseKey: null,
        updatedAt: '2026-07-19T00:00:01.000Z',
      }),
      expect.objectContaining({
        userId: 'user-id',
        status: 'superseded',
        requestApproved: 0,
        encryptedResponseKey: null,
        updatedAt: '2026-07-19T00:00:01.000Z',
      }),
    ])
    expect(state.authRequests[2]).toMatchObject({
      userId: 'user-id',
      status: 'denied',
    })
    expect(state.authRequests[3]).toMatchObject({
      userId: 'external-user-id',
      status: 'pending',
    })
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

  it.each([
    'user',
    'devices',
    'refresh_tokens',
    'auth_requests',
    'audit',
  ] as const)(
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
        authRequests: state.authRequests,
      })

      await expect(
        rotateAccountSecurityStamp(database, rotationInput),
      ).rejects.toThrow(`credential rotation ${stage} failed`)

      expect({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
        authRequests: state.authRequests,
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
      emailNormalized: 'person@example.test',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-authentication-hash',
      userKey: '2.synthetic-wrapped-user-key',
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
    authRequests: [
      {
        id: 'pending-request',
        userId: 'user-id',
        status: 'pending',
        requestApproved: null,
        encryptedResponseKey: null,
        updatedAt: '2026-07-19T00:00:00.000Z',
      },
      {
        id: 'approved-request',
        userId: 'user-id',
        status: 'approved',
        requestApproved: 1,
        encryptedResponseKey: 'synthetic-encrypted-response-key',
        updatedAt: '2026-07-19T00:00:00.000Z',
      },
      {
        id: 'denied-request',
        userId: 'user-id',
        status: 'denied',
        requestApproved: 0,
        encryptedResponseKey: null,
        updatedAt: '2026-07-19T00:00:00.000Z',
      },
      {
        id: 'external-request',
        userId: 'external-user-id',
        status: 'pending',
        requestApproved: null,
        encryptedResponseKey: null,
        updatedAt: '2026-07-19T00:00:00.000Z',
      },
    ],
  }
}
