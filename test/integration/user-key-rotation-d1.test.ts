import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import { fingerprintCredentialWrapper } from '../../src/domain/account-credentials'
import { buildAuditEvent } from '../../src/domain/audit'
import type { UserKeyRotationRequest } from '../../src/domain/user-key-rotation'
import {
  changeAccountKdf,
  changeAccountMasterPassword,
  initializeAccountKeyPair,
  type ChangeAccountKdfInput,
  type ChangeAccountMasterPasswordInput,
} from '../../src/repositories/credential-repository'
import { rotateUserKeyGeneration } from '../../src/repositories/user-key-rotation-repository'

const userId = '11111111-1111-4111-8111-111111111111'
const folderId = '22222222-2222-4222-8222-222222222222'
const cipherId = '33333333-3333-4333-8333-333333333333'
const attachmentId = '44444444-4444-4444-8444-444444444444'
const trustedDeviceId = '55555555-5555-4555-8555-555555555555'
const regularDeviceId = '66666666-6666-4666-8666-666666666666'
const staleRevokedDeviceId = '77777777-7777-4777-8777-777777777777'
const oldRevisionDate = '2026-07-20T00:00:00.000Z'
const nextRevisionDate = '2026-07-20T00:00:01.000Z'

const instances: Miniflare[] = []

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('user key rotation on real local D1', () => {
  it('rotates an empty personal vault with zero-row JSON manifests', async () => {
    const database = await createDatabase()
    const fixture = rotationFixture('empty-next-stamp', 'empty-audit-id')
    fixture.request.folders = []
    fixture.request.ciphers = []
    fixture.request.trustedDevices = []
    await seedAccount(database, fixture)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({
      status: 'rotated',
      rotatedFolderCount: 0,
      rotatedCipherCount: 0,
      rotatedAttachmentCount: 0,
      rotatedTrustedDeviceCount: 0,
      revokedDeviceCount: 0,
      revokedRefreshTokenCount: 0,
      invalidatedAuthRequestCount: 0,
    })
  })

  it('commits one generation and preserves attachment storage identity', async () => {
    const database = await createDatabase()
    const fixture = rotationFixture('next-security-stamp', 'rotation-audit-id')
    await seedRotationState(database, fixture, false, true)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({
      status: 'rotated',
      rotatedFolderCount: 1,
      rotatedCipherCount: 1,
      rotatedAttachmentCount: 1,
      rotatedTrustedDeviceCount: 1,
      revokedDeviceCount: 2,
      revokedRefreshTokenCount: 2,
      invalidatedAuthRequestCount: 2,
    })

    const state = await readRotationState(database)
    expect(state.account).toMatchObject({
      masterPasswordHash: fixture.request.nextMasterKeyAuthenticationHash,
      userKey: fixture.request.nextUserKey,
      publicKey: fixture.request.accountKeys.publicKey,
      privateKey: fixture.request.accountKeys.wrappedPrivateKey,
      securityStamp: fixture.input.nextSecurityStamp,
      revisionDate: nextRevisionDate,
    })
    expect(state.folder).toMatchObject({
      name: fixture.request.folders[0]!.name,
      revisionDate: nextRevisionDate,
    })
    expect(state.cipher).toMatchObject({
      encryptedJson: fixture.request.ciphers[0]!.encryptedJson,
      revisionDate: nextRevisionDate,
    })
    expect(state.attachment).toMatchObject({
      fileName: fixture.request.ciphers[0]!.attachments[0]!.fileName,
      attachmentKey: fixture.request.ciphers[0]!.attachments[0]!.attachmentKey,
      revisionDate: nextRevisionDate,
      objectKey: 'attachments/immutable-object-key',
      size: 4096,
      contentType: 'application/octet-stream',
    })
    expect(state.devices).toHaveLength(3)
    expect(
      state.devices
        .filter((device) => device.id !== staleRevokedDeviceId)
        .every((device) => device.revokedAt === nextRevisionDate),
    ).toBe(true)
    expect(
      state.devices.find((device) => device.id === trustedDeviceId),
    ).toMatchObject({
      encryptedUserKey: fixture.request.trustedDevices[0]!.encryptedUserKey,
      encryptedPublicKey: fixture.request.trustedDevices[0]!.encryptedPublicKey,
      encryptedPrivateKey: '2.immutable-device-private-key',
    })
    expect(
      state.devices.find((device) => device.id === staleRevokedDeviceId),
    ).toMatchObject({
      revokedAt: oldRevisionDate,
      encryptedUserKey: null,
      encryptedPublicKey: null,
      encryptedPrivateKey: null,
    })
    expect(
      state.refreshTokens.every(
        (refreshToken) => refreshToken.revokedAt === nextRevisionDate,
      ),
    ).toBe(true)
    expect(
      state.authRequests.every(
        (request) =>
          request.status === 'superseded' &&
          request.requestApproved === 0 &&
          request.encryptedResponseKey === null,
      ),
    ).toBe(true)
    expect(state.auditEvents).toEqual([
      { id: fixture.input.auditEventId, name: 'account.keys.rotate' },
    ])
    expect(state.wrapperHistory).toHaveLength(4)
    expect(
      state.wrapperHistory.every(
        (entry) =>
          ['private_key', 'user_key'].includes(String(entry.wrapperKind)) &&
          /^[a-f0-9]{64}$/.test(String(entry.wrapperSha256)),
      ),
    ).toBe(true)
    expect(JSON.stringify(state.wrapperHistory)).not.toContain(
      'wrapped-user-key',
    )
    expect(JSON.stringify(state.wrapperHistory)).not.toContain(
      'wrapped-private-key',
    )
  })

  it('rejects an older persisted wrapper generation after a successful rotation', async () => {
    const database = await createDatabase()
    const first = rotationFixture('first-security-stamp', 'first-audit-id')
    first.request.folders = []
    first.request.ciphers = []
    first.request.trustedDevices = []
    await seedAccount(database, first)

    await expect(
      rotateUserKeyGeneration(database, first.input),
    ).resolves.toMatchObject({ status: 'rotated' })

    const replayAt = '2026-07-20T00:00:02.000Z'
    const replay = rotationFixture('replay-security-stamp', 'replay-audit-id')
    replay.request.oldMasterKeyAuthenticationHash =
      first.request.nextMasterKeyAuthenticationHash
    replay.request.nextMasterKeyAuthenticationHash =
      first.request.oldMasterKeyAuthenticationHash
    replay.request.nextUserKey = '2.old-wrapped-user-key'
    replay.request.accountKeys.wrappedPrivateKey = '2.old-wrapped-private-key'
    replay.request.folders = []
    replay.request.ciphers = []
    replay.request.trustedDevices = []
    Object.assign(replay.input, {
      expectedSecurityStamp: first.input.nextSecurityStamp,
      expectedRevisionDate: first.input.nextRevisionDate,
      nextRevisionDate: replayAt,
      auditEvent: buildAuditEvent({
        name: 'account.keys.rotate',
        outcome: 'success',
        requestId: 'replay-audit-request',
        occurredAt: replayAt,
        actor: { userId, deviceIdentifier: 'fixture-device' },
        target: { type: 'account', id: userId },
        context: {
          accountEncryptionVersion: 1,
          allSessionsRevoked: true,
          r2ObjectsUnchanged: true,
        },
      }),
    })

    await expect(
      rotateUserKeyGeneration(database, replay.input),
    ).resolves.toEqual({ status: 'replayed_generation' })
    const state = await readRotationState(database)
    expect(state.account).toMatchObject({
      userKey: first.request.nextUserKey,
      privateKey: first.request.accountKeys.wrappedPrivateKey,
      securityStamp: first.input.nextSecurityStamp,
      revisionDate: first.input.nextRevisionDate,
    })
    expect(state.wrapperHistory).toHaveLength(4)
    expect(state.auditEvents).toEqual([
      { id: first.input.auditEventId, name: 'account.keys.rotate' },
    ])
  })

  it.each([
    [
      'private-key history reused as a user key',
      '2.old-wrapped-private-key',
      '2.fresh-cross-role-private-key',
    ],
    [
      'user-key history reused as a private key',
      '2.fresh-cross-role-user-key',
      '2.old-wrapped-user-key',
    ],
  ])('rejects %s', async (_label, nextUserKey, nextPrivateKey) => {
    const database = await createDatabase()
    const first = rotationFixture('first-security-stamp', 'first-audit-id')
    first.request.folders = []
    first.request.ciphers = []
    first.request.trustedDevices = []
    await seedAccount(database, first)

    await expect(
      rotateUserKeyGeneration(database, first.input),
    ).resolves.toMatchObject({ status: 'rotated' })

    const replayAt = '2026-07-20T00:00:02.000Z'
    const replay = rotationFixture(
      'cross-role-security-stamp',
      'cross-role-audit-id',
    )
    replay.request.oldMasterKeyAuthenticationHash =
      first.request.nextMasterKeyAuthenticationHash
    replay.request.nextMasterKeyAuthenticationHash =
      'cross-role-next-authentication-hash'
    replay.request.nextUserKey = nextUserKey
    replay.request.accountKeys.wrappedPrivateKey = nextPrivateKey
    replay.request.folders = []
    replay.request.ciphers = []
    replay.request.trustedDevices = []
    Object.assign(replay.input, {
      expectedSecurityStamp: first.input.nextSecurityStamp,
      expectedRevisionDate: first.input.nextRevisionDate,
      nextRevisionDate: replayAt,
      auditEvent: buildAuditEvent({
        name: 'account.keys.rotate',
        outcome: 'success',
        requestId: 'cross-role-audit-request',
        occurredAt: replayAt,
        actor: { userId, deviceIdentifier: 'fixture-device' },
        target: { type: 'account', id: userId },
        context: {
          accountEncryptionVersion: 1,
          allSessionsRevoked: true,
          r2ObjectsUnchanged: true,
        },
      }),
    })

    await expect(
      rotateUserKeyGeneration(database, replay.input),
    ).resolves.toEqual({ status: 'replayed_generation' })

    const state = await readRotationState(database)
    expect(state.account).toMatchObject({
      userKey: first.request.nextUserKey,
      privateKey: first.request.accountKeys.wrappedPrivateKey,
      securityStamp: first.input.nextSecurityStamp,
      revisionDate: first.input.nextRevisionDate,
    })
    expect(state.wrapperHistory).toHaveLength(4)
    expect(state.auditEvents).toEqual([
      { id: first.input.auditEventId, name: 'account.keys.rotate' },
    ])
  })

  it.each(['password', 'KDF'] as const)(
    'rejects a %s change that reuses a wrapper recorded under another role',
    async (kind) => {
      const database = await createDatabase()
      const fixture = rotationFixture(
        'credential-replay-security-stamp',
        'credential-replay-audit-id',
      )
      await seedAccount(database, fixture)
      const replayedWrapper = '2.replayed-cross-role-wrapper'
      await database
        .prepare(
          `INSERT INTO user_key_rotation_wrapper_history (
            user_id, wrapper_kind, wrapper_sha256, recorded_at
          ) VALUES (?, 'private_key', ?, ?)`,
        )
        .bind(
          userId,
          await fingerprintCredentialWrapper(replayedWrapper),
          oldRevisionDate,
        )
        .run()
      const before = await readRotationState(database)

      await expect(
        mutateCredentialGeneration(database, kind, {
          nextUserKey: replayedWrapper,
        }),
      ).resolves.toEqual({ status: 'conflict' })

      expect(await readRotationState(database)).toEqual(before)
    },
  )

  it.each(['password', 'KDF'] as const)(
    'establishes a first wrapped user key during a %s change with null CAS values',
    async (kind) => {
      const database = await createDatabase()
      const fixture = rotationFixture(
        'keyless-bootstrap-security-stamp',
        'keyless-bootstrap-audit-id',
      )
      await seedAccount(database, fixture)
      await database
        .prepare(
          `UPDATE users
          SET user_key = NULL, private_key = NULL
          WHERE id = ?`,
        )
        .bind(userId)
        .run()
      const nextUserKey = `2.${kind.toLowerCase()}-bootstrap-user-key`

      await expect(
        mutateCredentialGeneration(database, kind, {
          expectedUserKey: null,
          expectedPrivateKey: null,
          nextUserKey,
        }),
      ).resolves.toMatchObject({ status: 'changed' })

      const state = await readRotationState(database)
      expect(state.account).toMatchObject({
        userKey: nextUserKey,
        securityStamp: `${kind.toLowerCase()}-next-security-stamp`,
        revisionDate: nextRevisionDate,
      })
      expect(state.wrapperHistory).toEqual([
        {
          wrapperKind: 'user_key',
          wrapperSha256: await fingerprintCredentialWrapper(nextUserKey),
        },
      ])
      expect(state.auditEvents).toEqual([
        {
          id: `${kind.toLowerCase()}-change-audit-id`,
          name:
            kind === 'password'
              ? 'account.password.change'
              : 'account.kdf.change',
        },
      ])
    },
  )

  it('rejects a historical user wrapper during account-key initialization', async () => {
    const database = await createDatabase()
    const fixture = rotationFixture(
      'account-key-bootstrap-security-stamp',
      'account-key-bootstrap-audit-id',
    )
    await seedAccount(database, fixture)
    await database
      .prepare(
        `UPDATE users
        SET public_key = NULL, private_key = NULL
        WHERE id = ?`,
      )
      .bind(userId)
      .run()

    await expect(
      changeAccountMasterPassword(
        database,
        passwordChangeFixture({ expectedPrivateKey: null }),
      ),
    ).resolves.toMatchObject({ status: 'changed' })
    const before = await readRotationState(database)

    await expect(
      initializeAccountKeyPair(database, {
        userId,
        expectedUserKey: '2.password-next-wrapped-user-key',
        expectedSecurityStamp: 'password-next-security-stamp',
        expectedRevisionDate: nextRevisionDate,
        publicKey: 'account-key-initialization-public-key',
        wrappedPrivateKey: '2.old-wrapped-user-key',
        nextRevisionDate: '2026-07-20T00:00:02.000Z',
        auditEventId: 'account-key-initialization-audit-id',
        auditEvent: buildAuditEvent({
          name: 'account.keys.initialize',
          outcome: 'success',
          requestId: 'account-key-initialization-request',
          occurredAt: '2026-07-20T00:00:02.000Z',
          actor: { userId, deviceIdentifier: 'fixture-device' },
          target: { type: 'account', id: userId },
          context: {
            accountEncryptionVersion: 1,
            securityStampChanged: false,
            sessionsRevoked: false,
          },
        }),
      }),
    ).resolves.toEqual({ status: 'conflict' })

    expect(await readRotationState(database)).toEqual(before)
  })

  it('records only the winning wrappers for concurrent account-key initialization', async () => {
    const database = await createDatabase()
    const fixture = rotationFixture(
      'concurrent-account-key-security-stamp',
      'concurrent-account-key-audit-id',
    )
    await seedAccount(database, fixture)
    await database
      .prepare(
        `UPDATE users
        SET public_key = NULL, private_key = NULL
        WHERE id = ?`,
      )
      .bind(userId)
      .run()
    const sharedInput = {
      userId,
      expectedUserKey: '2.old-wrapped-user-key',
      expectedSecurityStamp: 'old-security-stamp',
      expectedRevisionDate: oldRevisionDate,
      nextRevisionDate,
    }
    const initialize = (
      suffix: string,
    ): ReturnType<typeof initializeAccountKeyPair> =>
      initializeAccountKeyPair(database, {
        ...sharedInput,
        publicKey: `${suffix}-public-key`,
        wrappedPrivateKey: `2.${suffix}-wrapped-private-key`,
        auditEventId: `${suffix}-account-key-audit-id`,
        auditEvent: buildAuditEvent({
          name: 'account.keys.initialize',
          outcome: 'success',
          requestId: `${suffix}-account-key-request`,
          occurredAt: nextRevisionDate,
          actor: { userId, deviceIdentifier: 'fixture-device' },
          target: { type: 'account', id: userId },
          context: {
            accountEncryptionVersion: 1,
            securityStampChanged: false,
            sessionsRevoked: false,
          },
        }),
      })

    const results = await Promise.all([
      initialize('first'),
      initialize('second'),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([
      'conflict',
      'initialized',
    ])

    const state = await readRotationState(database)
    const winningPrivateKey = String(state.account?.privateKey)
    expect(state.wrapperHistory).toEqual(
      expect.arrayContaining([
        {
          wrapperKind: 'user_key',
          wrapperSha256: await fingerprintCredentialWrapper(
            '2.old-wrapped-user-key',
          ),
        },
        {
          wrapperKind: 'private_key',
          wrapperSha256: await fingerprintCredentialWrapper(winningPrivateKey),
        },
      ]),
    )
    expect(state.wrapperHistory).toHaveLength(2)
    expect(state.auditEvents).toHaveLength(1)
  })

  it('rolls every mutation back when the final audit statement fails', async () => {
    const database = await createDatabase()
    const fixture = rotationFixture('next-security-stamp', 'duplicate-audit-id')
    await seedRotationState(database, fixture, true)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).rejects.toThrow()

    const state = await readRotationState(database)
    expect(state.account).toMatchObject({
      masterPasswordHash: fixture.request.oldMasterKeyAuthenticationHash,
      userKey: '2.old-wrapped-user-key',
      privateKey: '2.old-wrapped-private-key',
      securityStamp: 'old-security-stamp',
      revisionDate: oldRevisionDate,
    })
    expect(state.folder).toMatchObject({
      name: '2.old-folder-name',
      revisionDate: oldRevisionDate,
    })
    expect(state.cipher).toMatchObject({
      encryptedJson: JSON.stringify(cipherPayload('old')),
      revisionDate: oldRevisionDate,
    })
    expect(state.attachment).toMatchObject({
      fileName: '2.old-file-name',
      attachmentKey: '2.old-attachment-key',
      revisionDate: oldRevisionDate,
      objectKey: 'attachments/immutable-object-key',
    })
    expect(state.devices.every((device) => device.revokedAt === null)).toBe(
      true,
    )
    expect(
      state.refreshTokens.every(
        (refreshToken) => refreshToken.revokedAt === null,
      ),
    ).toBe(true)
    expect(state.authRequests.map((request) => request.status).sort()).toEqual([
      'approved',
      'pending',
    ])
    expect(state.wrapperHistory).toEqual([])
  })

  it('serializes concurrent generations so exactly one wins', async () => {
    const database = await createDatabase()
    const first = rotationFixture('first-next-stamp', 'first-audit-id')
    const second = rotationFixture('second-next-stamp', 'second-audit-id')
    await seedRotationState(database, first, false)

    const results = await Promise.all([
      rotateUserKeyGeneration(database, first.input),
      rotateUserKeyGeneration(database, second.input),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([
      'conflict',
      'rotated',
    ])

    const state = await readRotationState(database)
    expect(['first-next-stamp', 'second-next-stamp']).toContain(
      state.account?.securityStamp,
    )
    expect(state.auditEvents).toHaveLength(1)
    expect(['first-audit-id', 'second-audit-id']).toContain(
      state.auditEvents[0]?.id,
    )
  })
})

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-06',
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const database = await instance.getD1Database('DB')
  await database.prepare('PRAGMA foreign_keys = ON').run()
  for (const statement of testSchemaStatements) {
    await database.prepare(statement).run()
  }
  return database
}

function rotationFixture(nextSecurityStamp: string, auditEventId: string) {
  const request: UserKeyRotationRequest = {
    oldMasterKeyAuthenticationHash: 'old-authentication-hash',
    nextMasterKeyAuthenticationHash: 'next-authentication-hash',
    nextUserKey: '2.next-wrapped-user-key',
    credentialMetadata: {
      salt: 'person@example.test',
      kdf: {
        kdfType: 0,
        iterations: 600_000,
        memory: null,
        parallelism: null,
      },
    },
    accountKeys: {
      publicKey: 'account-public-key',
      wrappedPrivateKey: '2.next-wrapped-private-key',
    },
    folders: [{ id: folderId, name: '2.next-folder-name' }],
    ciphers: [
      {
        id: cipherId,
        encryptedFor: userId,
        organizationId: null,
        folderId,
        type: 1,
        favorite: true,
        reprompt: 0,
        archivedDate: null,
        lastKnownRevisionDate: oldRevisionDate,
        metadata: {
          login: {
            passwordRevisionDate: '2026-07-01T00:00:00.000Z',
            autofillOnPageLoad: false,
            uriMatches: [null],
            fido2CreationDates: [null],
          },
          secureNoteType: null,
          fields: [{ type: 0, linkedId: null }],
          passwordHistoryDates: ['2026-06-01T00:00:00.000Z'],
        },
        encryptedJson: JSON.stringify(cipherPayload('next')),
        attachments: [
          {
            id: attachmentId,
            fileName: '2.next-file-name',
            attachmentKey: '2.next-attachment-key',
            lastKnownRevisionDate: oldRevisionDate,
          },
        ],
      },
    ],
    trustedDevices: [
      {
        id: trustedDeviceId,
        encryptedPublicKey: '2.next-device-public-key',
        encryptedUserKey: '2.next-device-user-key',
      },
    ],
  }
  const input = {
    userId,
    expectedSecurityStamp: 'old-security-stamp',
    expectedRevisionDate: oldRevisionDate,
    nextSecurityStamp,
    nextRevisionDate,
    request,
    auditEventId,
    auditEvent: buildAuditEvent({
      name: 'account.keys.rotate',
      outcome: 'success',
      requestId: `${auditEventId}-request`,
      occurredAt: nextRevisionDate,
      actor: { userId, deviceIdentifier: 'fixture-device' },
      target: { type: 'account', id: userId },
      context: {
        accountEncryptionVersion: 1,
        allSessionsRevoked: true,
        r2ObjectsUnchanged: true,
      },
    }),
  }
  return { input, request }
}

function passwordChangeFixture(
  overrides: Partial<ChangeAccountMasterPasswordInput> = {},
): ChangeAccountMasterPasswordInput {
  return {
    userId,
    expectedMasterPasswordHash: 'old-authentication-hash',
    expectedEmailNormalized: 'person@example.test',
    expectedKdfAlgorithm: 'pbkdf2-sha256',
    expectedKdfIterations: 600_000,
    expectedKdfMemory: null,
    expectedKdfParallelism: null,
    expectedUserKey: '2.old-wrapped-user-key',
    expectedPrivateKey: '2.old-wrapped-private-key',
    expectedSecurityStamp: 'old-security-stamp',
    expectedRevisionDate: oldRevisionDate,
    nextMasterPasswordHash: 'password-next-authentication-hash',
    nextUserKey: '2.password-next-wrapped-user-key',
    nextSecurityStamp: 'password-next-security-stamp',
    nextRevisionDate,
    auditEventId: 'password-change-audit-id',
    auditEvent: buildAuditEvent({
      name: 'account.password.change',
      outcome: 'success',
      requestId: 'password-change-request',
      occurredAt: nextRevisionDate,
      actor: { userId, deviceIdentifier: 'fixture-device' },
      target: { type: 'account', id: userId },
      context: {
        d1SessionsRevoked: true,
        kdfUnchanged: true,
      },
    }),
    ...overrides,
  }
}

function kdfChangeFixture(
  overrides: Partial<ChangeAccountKdfInput> = {},
): ChangeAccountKdfInput {
  return {
    ...passwordChangeFixture(),
    nextMasterPasswordHash: 'kdf-next-authentication-hash',
    nextUserKey: '2.kdf-next-wrapped-user-key',
    nextSecurityStamp: 'kdf-next-security-stamp',
    nextKdfAlgorithm: 'argon2id',
    nextKdfIterations: 6,
    nextKdfMemory: 32,
    nextKdfParallelism: 4,
    auditEventId: 'kdf-change-audit-id',
    auditEvent: buildAuditEvent({
      name: 'account.kdf.change',
      outcome: 'success',
      requestId: 'kdf-change-request',
      occurredAt: nextRevisionDate,
      actor: { userId, deviceIdentifier: 'fixture-device' },
      target: { type: 'account', id: userId },
      context: {
        d1SessionsRevoked: true,
        previousKdfType: 0,
        nextKdfType: 1,
      },
    }),
    ...overrides,
  }
}

function mutateCredentialGeneration(
  database: D1Database,
  kind: 'password' | 'KDF',
  overrides: Partial<ChangeAccountKdfInput>,
) {
  return kind === 'password'
    ? changeAccountMasterPassword(database, passwordChangeFixture(overrides))
    : changeAccountKdf(database, kdfChangeFixture(overrides))
}

async function seedRotationState(
  database: D1Database,
  fixture: ReturnType<typeof rotationFixture>,
  duplicateAudit: boolean,
  includeStaleRevokedDevice = false,
): Promise<void> {
  const statements = [
    accountInsert(database, fixture),
    database
      .prepare(
        `INSERT INTO folders (
          id, user_id, encrypted_name, revision_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        folderId,
        userId,
        '2.old-folder-name',
        oldRevisionDate,
        oldRevisionDate,
        oldRevisionDate,
      ),
    database
      .prepare(
        `INSERT INTO ciphers (
          id, user_id, folder_id, type, favorite, encrypted_json,
          revision_date, created_at, updated_at, organization_id, cipher_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        cipherId,
        userId,
        folderId,
        1,
        1,
        JSON.stringify(cipherPayload('old')),
        oldRevisionDate,
        oldRevisionDate,
        oldRevisionDate,
      ),
    database
      .prepare(
        `INSERT INTO cipher_attachments (
          id, user_id, cipher_id, object_key, file_name, attachment_key,
          size, content_type, revision_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        attachmentId,
        userId,
        cipherId,
        'attachments/immutable-object-key',
        '2.old-file-name',
        '2.old-attachment-key',
        4096,
        'application/octet-stream',
        oldRevisionDate,
        oldRevisionDate,
        oldRevisionDate,
      ),
    deviceInsert(database, trustedDeviceId, 'trusted-device', {
      userKey: '2.old-device-user-key',
      publicKey: '2.old-device-public-key',
      privateKey: '2.immutable-device-private-key',
    }),
    deviceInsert(database, regularDeviceId, 'regular-device', null),
    refreshTokenInsert(database, 'refresh-token-1', trustedDeviceId),
    refreshTokenInsert(database, 'refresh-token-2', regularDeviceId),
    authRequestInsert(database, 'auth-request-pending', 'pending'),
    authRequestInsert(database, 'auth-request-approved', 'approved'),
  ]
  if (includeStaleRevokedDevice) {
    statements.push(
      database
        .prepare(
          `INSERT INTO devices (
            id, user_id, identifier, name, type, revoked_at, created_at,
            updated_at, encrypted_user_key, encrypted_public_key,
            encrypted_private_key
          ) VALUES (?, ?, ?, ?, 8, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          staleRevokedDeviceId,
          userId,
          'stale-revoked-device',
          'stale-revoked-device',
          oldRevisionDate,
          oldRevisionDate,
          oldRevisionDate,
          '2.stale-old-device-user-key',
          '2.stale-old-device-public-key',
          '2.stale-old-device-private-key',
        ),
    )
  }
  if (duplicateAudit) {
    statements.push(
      database
        .prepare(
          `INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at
          ) VALUES (?, 1, 'account.keys.rotate', 'success', ?, ?)`,
        )
        .bind(
          fixture.input.auditEventId,
          'preexisting-audit-request',
          oldRevisionDate,
        ),
    )
  }
  await database.batch(statements)
}

async function seedAccount(
  database: D1Database,
  fixture: ReturnType<typeof rotationFixture>,
): Promise<void> {
  await accountInsert(database, fixture).run()
}

function accountInsert(
  database: D1Database,
  fixture: ReturnType<typeof rotationFixture>,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO users (
        id, email, email_normalized, kdf_algorithm, kdf_iterations,
        kdf_memory, kdf_parallelism, master_password_hash, user_key,
        public_key, private_key, security_stamp, revision_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      'Person@Example.Test',
      'person@example.test',
      'pbkdf2-sha256',
      600_000,
      null,
      null,
      fixture.request.oldMasterKeyAuthenticationHash,
      '2.old-wrapped-user-key',
      fixture.request.accountKeys.publicKey,
      '2.old-wrapped-private-key',
      'old-security-stamp',
      oldRevisionDate,
    )
}

function deviceInsert(
  database: D1Database,
  id: string,
  identifier: string,
  keys: { userKey: string; publicKey: string; privateKey: string } | null,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO devices (
        id, user_id, identifier, name, type, revoked_at, created_at, updated_at,
        encrypted_user_key, encrypted_public_key, encrypted_private_key
      ) VALUES (?, ?, ?, ?, 8, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      identifier,
      identifier,
      oldRevisionDate,
      oldRevisionDate,
      keys?.userKey ?? null,
      keys?.publicKey ?? null,
      keys?.privateKey ?? null,
    )
}

function refreshTokenInsert(
  database: D1Database,
  id: string,
  deviceId: string,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO refresh_tokens (
        id, user_id, device_id, token_hash, expires_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      id,
      userId,
      deviceId,
      `hash-${id}`,
      '2026-08-20T00:00:00.000Z',
      oldRevisionDate,
    )
}

function authRequestInsert(
  database: D1Database,
  id: string,
  status: 'pending' | 'approved',
): D1PreparedStatement {
  const approved = status === 'approved'
  return database
    .prepare(
      `INSERT INTO auth_requests (
        id, user_id, email_hash, request_type, request_device_identifier,
        request_device_type, request_public_key, access_code_hash, status,
        request_approved, encrypted_response_key, created_at, response_at,
        expires_at, retention_delete_after, updated_at
      ) VALUES (?, ?, ?, 0, ?, 8, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      `email-hash-${id}`,
      `request-device-${id}`,
      `request-public-key-${id}`,
      `access-code-hash-${id}`,
      status,
      approved ? 1 : null,
      approved ? `encrypted-response-${id}` : null,
      oldRevisionDate,
      approved ? oldRevisionDate : null,
      '2026-08-20T00:00:00.000Z',
      '2026-09-20T00:00:00.000Z',
      oldRevisionDate,
    )
}

async function readRotationState(database: D1Database) {
  const [
    account,
    folder,
    cipher,
    attachment,
    devices,
    refreshTokens,
    authRequests,
    auditEvents,
    wrapperHistory,
  ] = await Promise.all([
    database
      .prepare(
        `SELECT
          master_password_hash as masterPasswordHash,
          user_key as userKey,
          public_key as publicKey,
          private_key as privateKey,
          security_stamp as securityStamp,
          revision_date as revisionDate
        FROM users WHERE id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT encrypted_name as name, revision_date as revisionDate
        FROM folders WHERE id = ?`,
      )
      .bind(folderId)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT encrypted_json as encryptedJson, revision_date as revisionDate
        FROM ciphers WHERE id = ?`,
      )
      .bind(cipherId)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT
          object_key as objectKey,
          file_name as fileName,
          attachment_key as attachmentKey,
          size,
          content_type as contentType,
          revision_date as revisionDate
        FROM cipher_attachments WHERE id = ?`,
      )
      .bind(attachmentId)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT
          id,
          revoked_at as revokedAt,
          encrypted_user_key as encryptedUserKey,
          encrypted_public_key as encryptedPublicKey,
          encrypted_private_key as encryptedPrivateKey
        FROM devices WHERE user_id = ? ORDER BY id`,
      )
      .bind(userId)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, revoked_at as revokedAt
        FROM refresh_tokens WHERE user_id = ? ORDER BY id`,
      )
      .bind(userId)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT
          id,
          status,
          request_approved as requestApproved,
          encrypted_response_key as encryptedResponseKey
        FROM auth_requests WHERE user_id = ? ORDER BY id`,
      )
      .bind(userId)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, name FROM audit_events
        WHERE actor_user_id = ? OR id IN (?, ?, ?)
        ORDER BY id`,
      )
      .bind(userId, 'rotation-audit-id', 'first-audit-id', 'second-audit-id')
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT
          wrapper_kind as wrapperKind,
          wrapper_sha256 as wrapperSha256
        FROM user_key_rotation_wrapper_history
        WHERE user_id = ?
        ORDER BY wrapper_kind, wrapper_sha256`,
      )
      .bind(userId)
      .all<Record<string, unknown>>(),
  ])

  return {
    account,
    folder,
    cipher,
    attachment,
    devices: devices.results,
    refreshTokens: refreshTokens.results,
    authRequests: authRequests.results,
    auditEvents: auditEvents.results,
    wrapperHistory: wrapperHistory.results,
  }
}

function cipherPayload(generation: 'old' | 'next') {
  return {
    type: 1,
    folderId,
    organizationId: null,
    favorite: true,
    reprompt: 0,
    archivedDate: null,
    name: `2.${generation}-cipher-name`,
    notes: `2.${generation}-notes`,
    key: `2.${generation}-cipher-key`,
    login: {
      username: `2.${generation}-username`,
      password: `2.${generation}-password`,
      totp: null,
      passwordRevisionDate: '2026-07-01T00:00:00.000Z',
      autofillOnPageLoad: false,
      uris: [
        {
          uri: `2.${generation}-uri`,
          match: null,
          uriChecksum: null,
        },
      ],
      fido2Credentials: [
        {
          credentialId: `2.${generation}-credential-id`,
          creationDate: null,
        },
      ],
    },
    secureNote: null,
    card: null,
    identity: null,
    sshKey: null,
    bankAccount: null,
    driversLicense: null,
    passport: null,
    fields: [
      {
        type: 0,
        name: `2.${generation}-field-name`,
        value: `2.${generation}-field-value`,
        linkedId: null,
      },
    ],
    passwordHistory: [
      {
        lastUsedDate: '2026-06-01T00:00:00.000Z',
        password: `2.${generation}-old-password`,
      },
    ],
  }
}

const testSchemaStatements = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL UNIQUE,
    kdf_algorithm TEXT NOT NULL,
    kdf_iterations INTEGER NOT NULL,
    kdf_memory INTEGER,
    kdf_parallelism INTEGER,
    master_password_hash TEXT NOT NULL,
    user_key TEXT,
    public_key TEXT,
    private_key TEXT,
    security_stamp TEXT NOT NULL,
    revision_date TEXT NOT NULL,
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    encrypted_name TEXT NOT NULL,
    revision_date TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE ciphers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    folder_id TEXT,
    type INTEGER NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    encrypted_json TEXT NOT NULL,
    revision_date TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    organization_id TEXT,
    cipher_key TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE cipher_attachments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    cipher_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    attachment_key TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0),
    content_type TEXT,
    revision_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    identifier TEXT NOT NULL,
    name TEXT,
    type INTEGER,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    encrypted_user_key TEXT,
    encrypted_public_key TEXT,
    encrypted_private_key TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, identifier)
  )`,
  `CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE auth_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email_hash TEXT NOT NULL,
    request_type INTEGER NOT NULL,
    request_device_identifier TEXT NOT NULL,
    request_device_type INTEGER NOT NULL,
    request_public_key TEXT NOT NULL,
    access_code_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    request_approved INTEGER,
    encrypted_response_key TEXT,
    created_at TEXT NOT NULL,
    response_at TEXT,
    expires_at TEXT NOT NULL,
    retention_delete_after TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    name TEXT NOT NULL,
    outcome TEXT NOT NULL,
    request_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    actor_user_id TEXT,
    actor_device_identifier TEXT,
    target_type TEXT,
    target_id TEXT,
    context_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE user_key_rotation_wrapper_history (
    user_id TEXT NOT NULL,
    wrapper_kind TEXT NOT NULL
      CHECK (wrapper_kind IN ('user_key', 'private_key')),
    wrapper_sha256 TEXT NOT NULL
      CHECK (
        length(wrapper_sha256) = 64 AND
        wrapper_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, wrapper_sha256),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) WITHOUT ROWID`,
] as const
