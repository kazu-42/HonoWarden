import { describe, expect, it, vi } from 'vitest'

import { fingerprintCredentialWrapper } from '../../src/domain/account-credentials'
import { buildAuditEvent } from '../../src/domain/audit'
import {
  changeAccountKdf,
  changeAccountMasterPassword,
  initializeAccountKeyPair,
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
  expectedUserKey: '2.synthetic-wrapped-user-key',
  expectedPrivateKey: null,
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

const accountKeyInitializationInput = {
  userId: 'user-id',
  expectedUserKey: '2.synthetic-wrapped-user-key',
  expectedSecurityStamp: 'old-security-stamp',
  expectedRevisionDate: '2026-07-19T00:00:00.000Z',
  publicKey: 'synthetic-public-key',
  wrappedPrivateKey: '2.synthetic-wrapped-private-key',
  nextRevisionDate: '2026-07-19T00:00:01.000Z',
  auditEventId: 'account-key-initialization-audit-id',
  auditEvent: buildAuditEvent({
    name: 'account.keys.initialize',
    outcome: 'success',
    requestId: 'account-key-initialization-request',
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
      accountEncryptionVersion: 1,
      securityStampChanged: false,
      sessionsRevoked: false,
    },
  }),
} as const

describe('credential repository', () => {
  it('initializes one account keypair and required audit atomically without rotating sessions', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)
    const prepare = vi.spyOn(database, 'prepare')
    const sessionsBefore = structuredClone({
      devices: state.devices,
      refreshTokens: state.refreshTokens,
      authRequests: state.authRequests,
    })

    await expect(
      initializeAccountKeyPair(database, accountKeyInitializationInput),
    ).resolves.toEqual({
      status: 'initialized',
      securityStamp: 'old-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
      auditEventId: 'account-key-initialization-audit-id',
    })

    expect(state.authUser).toMatchObject({
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-wrapped-private-key',
      securityStamp: 'old-security-stamp',
      revisionDate: '2026-07-19T00:00:01.000Z',
      updatedAt: '2026-07-19T00:00:01.000Z',
    })
    expect({
      devices: state.devices,
      refreshTokens: state.refreshTokens,
      authRequests: state.authRequests,
    }).toEqual(sessionsBefore)
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        id: 'account-key-initialization-audit-id',
        name: 'account.keys.initialize',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        contextJson: JSON.stringify({
          accountEncryptionVersion: 1,
          securityStampChanged: false,
          sessionsRevoked: false,
        }),
      }),
    ])
    const auditJson = JSON.stringify(database.auditEventInserts)
    expect(auditJson).not.toContain('synthetic-public-key')
    expect(auditJson).not.toContain('synthetic-wrapped-private-key')

    const queries = prepare.mock.calls.map(([query]) => String(query))
    expect(state.wrapperHistory).toEqual([
      {
        userId: 'user-id',
        wrapperKind: 'user_key',
        wrapperSha256: await fingerprintCredentialWrapper(
          '2.synthetic-wrapped-user-key',
        ),
        recordedAt: '2026-07-19T00:00:01.000Z',
      },
      {
        userId: 'user-id',
        wrapperKind: 'private_key',
        wrapperSha256: await fingerprintCredentialWrapper(
          '2.synthetic-wrapped-private-key',
        ),
        recordedAt: '2026-07-19T00:00:01.000Z',
      },
    ])
    expect(JSON.stringify(state.wrapperHistory)).not.toContain(
      'synthetic-wrapped-user-key',
    )
    expect(JSON.stringify(state.wrapperHistory)).not.toContain(
      'synthetic-wrapped-private-key',
    )

    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain('INSERT INTO audit_events')
    expect(queries[0]).toContain('public_key IS NULL')
    expect(queries[0]).toContain('private_key IS NULL')
    expect(queries[0]).toContain('user_key IS NOT NULL')
    expect(queries[0]).toContain('length(trim(user_key)) > 0')
    expect(queries[1]).toContain('UPDATE users')
    expect(queries[1]).toContain('user_key IS NOT NULL')
    expect(queries[1]).toContain('length(trim(user_key)) > 0')
    expect(queries[1]).toContain('user_key = ?')
    expect(queries[1]).toContain('NOT EXISTS')
    expect(queries[2]).toContain(
      'INSERT OR IGNORE INTO user_key_rotation_wrapper_history',
    )
    expect(queries[2]).toContain('public_key = ?')
    expect(queries[2]).toContain('private_key = ?')
  })

  it.each([
    ['cross-user', { userId: 'other-user-id' }, {}],
    ['disabled user', {}, { disabledAt: '2026-07-19T00:00:00.000Z' }],
    ['missing wrapped user key', {}, { userKey: null }],
    ['blank wrapped user key', {}, { userKey: '  ' }],
    ['stale wrapped user key', { expectedUserKey: '2.stale-user-key' }, {}],
    ['stale stamp', { expectedSecurityStamp: 'stale-security-stamp' }, {}],
    [
      'stale revision',
      { expectedRevisionDate: '2026-07-18T00:00:00.000Z' },
      {},
    ],
    ['existing public key', {}, { publicKey: 'existing-public-key' }],
    [
      'existing private key',
      {},
      { privateKey: '2.existing-wrapped-private-key' },
    ],
    [
      'existing keypair',
      {},
      {
        publicKey: 'existing-public-key',
        privateKey: '2.existing-wrapped-private-key',
      },
    ],
  ] as const)(
    'leaves every row unchanged for %s',
    async (_name, inputChange, userChange) => {
      const state = credentialState()
      Object.assign(state.authUser, userChange)
      const database = new FakeD1Database(null, [], state)
      const before = structuredClone(state)

      await expect(
        initializeAccountKeyPair(database, {
          ...accountKeyInitializationInput,
          ...inputChange,
        }),
      ).resolves.toEqual({ status: 'conflict' })

      expect(state).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    },
  )

  it('rejects using the current user wrapper as the initial private wrapper', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)
    const prepare = vi.spyOn(database, 'prepare')
    const before = structuredClone(state)

    await expect(
      initializeAccountKeyPair(database, {
        ...accountKeyInitializationInput,
        wrappedPrivateKey: accountKeyInitializationInput.expectedUserKey,
      }),
    ).resolves.toEqual({ status: 'conflict' })

    expect(state).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
    expect(prepare).not.toHaveBeenCalled()
  })

  it.each(['user', 'wrapper_history', 'audit'] as const)(
    'rolls account-key initialization back when the %s statement fails',
    async (stage) => {
      const state = {
        ...credentialState(),
        accountKeyInitializationFailureAt: stage,
      }
      const database = new FakeD1Database(null, [], state)
      const before = structuredClone({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
        authRequests: state.authRequests,
        wrapperHistory: state.wrapperHistory,
      })

      await expect(
        initializeAccountKeyPair(database, accountKeyInitializationInput),
      ).rejects.toThrow(`account key initialization ${stage} failed`)
      expect({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
        authRequests: state.authRequests,
        wrapperHistory: state.wrapperHistory,
      }).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    },
  )

  it('commits only one concurrent initialization from the same missing generation', async () => {
    const state = credentialState()
    const database = new FakeD1Database(null, [], state)

    const results = await Promise.all([
      initializeAccountKeyPair(database, accountKeyInitializationInput),
      initializeAccountKeyPair(database, {
        ...accountKeyInitializationInput,
        publicKey: 'competing-public-key',
        wrappedPrivateKey: '2.competing-wrapped-private-key',
        auditEventId: 'competing-account-key-audit-id',
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual([
      'conflict',
      'initialized',
    ])
    expect(database.auditEventInserts).toHaveLength(1)
  })

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
    expect(state.wrapperHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wrapperKind: 'user_key',
          wrapperSha256: await fingerprintCredentialWrapper(
            '2.synthetic-wrapped-user-key',
          ),
        }),
        expect.objectContaining({
          wrapperKind: 'user_key',
          wrapperSha256: await fingerprintCredentialWrapper(
            '2.synthetic-next-wrapped-user-key',
          ),
        }),
      ]),
    )
    expect(state.wrapperHistory).toHaveLength(2)
    expect(JSON.stringify(state.wrapperHistory)).not.toContain(
      'synthetic-wrapped-user-key',
    )
  })

  it('establishes the first wrapped user key when changing KDF for a keyless bootstrap account', async () => {
    const state = credentialState()
    state.authUser.userKey = null
    const database = new FakeD1Database(null, [], state)
    const prepare = vi.spyOn(database, 'prepare')

    await expect(
      changeAccountKdf(database, {
        ...kdfChangeInput,
        expectedUserKey: null,
      }),
    ).resolves.toMatchObject({ status: 'changed' })

    expect(state.authUser.userKey).toBe('2.synthetic-next-wrapped-user-key')
    expect(state.wrapperHistory).toEqual([
      expect.objectContaining({
        wrapperKind: 'user_key',
        wrapperSha256: await fingerprintCredentialWrapper(
          '2.synthetic-next-wrapped-user-key',
        ),
      }),
    ])
    expect(
      prepare.mock.calls
        .map(([query]) => String(query))
        .find((query) => query.includes('UPDATE users')),
    ).toContain('AND user_key IS ?')
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
    'wrapper_history',
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
        wrapperHistory: state.wrapperHistory,
      })

      await expect(changeAccountKdf(database, kdfChangeInput)).rejects.toThrow(
        `credential rotation ${stage} failed`,
      )
      expect({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
        authRequests: state.authRequests,
        wrapperHistory: state.wrapperHistory,
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
    expect(state.wrapperHistory).toHaveLength(2)
    expect(state.wrapperHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wrapperSha256: await fingerprintCredentialWrapper(
            '2.synthetic-wrapped-user-key',
          ),
        }),
        expect.objectContaining({
          wrapperSha256: await fingerprintCredentialWrapper(
            '2.synthetic-next-wrapped-user-key',
          ),
        }),
      ]),
    )
    expect(JSON.stringify(state.wrapperHistory)).not.toContain(
      'synthetic-wrapped-user-key',
    )
  })

  it('establishes the first wrapped user key when changing a keyless bootstrap password', async () => {
    const state = credentialState()
    state.authUser.userKey = null
    const database = new FakeD1Database(null, [], state)
    const prepare = vi.spyOn(database, 'prepare')

    await expect(
      changeAccountMasterPassword(database, {
        ...passwordChangeInput,
        expectedUserKey: null,
      }),
    ).resolves.toMatchObject({ status: 'changed' })

    expect(state.authUser.userKey).toBe('2.synthetic-next-wrapped-user-key')
    expect(state.wrapperHistory).toEqual([
      expect.objectContaining({
        wrapperKind: 'user_key',
        wrapperSha256: await fingerprintCredentialWrapper(
          '2.synthetic-next-wrapped-user-key',
        ),
      }),
    ])
    expect(
      prepare.mock.calls
        .map(([query]) => String(query))
        .find((query) => query.includes('UPDATE users')),
    ).toContain('AND user_key IS ?')
  })

  it('records the current private wrapper with a password generation without storing raw wrappers', async () => {
    const state = credentialState()
    state.authUser.privateKey = '2.synthetic-current-wrapped-private-key'
    const database = new FakeD1Database(null, [], state)

    await expect(
      changeAccountMasterPassword(database, {
        ...passwordChangeInput,
        expectedPrivateKey: '2.synthetic-current-wrapped-private-key',
      }),
    ).resolves.toMatchObject({ status: 'changed' })

    expect(state.wrapperHistory).toHaveLength(3)
    expect(state.wrapperHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wrapperKind: 'private_key',
          wrapperSha256: await fingerprintCredentialWrapper(
            '2.synthetic-current-wrapped-private-key',
          ),
        }),
      ]),
    )
    expect(JSON.stringify(state.wrapperHistory)).not.toContain(
      'synthetic-current-wrapped-private-key',
    )
  })

  it('rejects a password generation whose next user wrapper appeared under another role', async () => {
    const state = credentialState()
    state.wrapperHistory.push({
      userId: 'user-id',
      wrapperKind: 'private_key',
      wrapperSha256: await fingerprintCredentialWrapper(
        passwordChangeInput.nextUserKey,
      ),
      recordedAt: '2026-07-18T00:00:00.000Z',
    })
    const database = new FakeD1Database(null, [], state)
    const before = structuredClone(state)

    await expect(
      changeAccountMasterPassword(database, passwordChangeInput),
    ).resolves.toEqual({ status: 'conflict' })

    expect(state).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
  })

  it.each([
    ['salt', { expectedEmailNormalized: 'stale@example.test' }],
    ['KDF', { expectedKdfIterations: 600001 }],
    ['wrapped user key', { expectedUserKey: '2.stale-wrapped-user-key' }],
    [
      'wrapped private key',
      { expectedPrivateKey: '2.stale-wrapped-private-key' },
    ],
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
    'wrapper_history',
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
        wrapperHistory: state.wrapperHistory,
      })

      await expect(
        changeAccountMasterPassword(database, passwordChangeInput),
      ).rejects.toThrow(`credential rotation ${stage} failed`)
      expect({
        authUser: state.authUser,
        devices: state.devices,
        refreshTokens: state.refreshTokens,
        authRequests: state.authRequests,
        wrapperHistory: state.wrapperHistory,
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
      userKey: '2.synthetic-wrapped-user-key' as string | null,
      publicKey: null,
      privateKey: null as string | null,
      securityStamp: 'old-security-stamp',
      revisionDate: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
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
    wrapperHistory: [] as Array<{
      userId: string
      wrapperKind: 'user_key' | 'private_key'
      wrapperSha256: string
      recordedAt: string
    }>,
  }
}
