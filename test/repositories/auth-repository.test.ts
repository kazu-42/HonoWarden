import { describe, expect, it } from 'vitest'

import {
  buildDeviceId,
  createPasswordGrantSession,
  deleteExpiredRefreshTokens,
  countRecentFailedAuthAttempts,
  findAuthFailureBucket,
  findAuthUserByEmail,
  findAuthUserById,
  findDeviceByIdentifier,
  findRefreshTokenSessionByHash,
  invalidateRefreshTokenSession,
  listDevicesByUser,
  knownActiveDeviceExists,
  cleanupAuthDefenseState,
  recordAuthAttempt,
  recordFailedAuthBucket,
  recordFailedLogin,
  revokeOtherDeviceSessions,
  resetAuthFailureBucket,
  resetLoginDefenseState,
  revokeDeviceSession,
  rotateRefreshToken,
  updateDeviceKeys,
  updateDeviceMetadata,
  updateTrustedDeviceKeys,
} from '../../src/repositories/auth-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('auth repository', () => {
  it('looks up auth users by normalized email', async () => {
    const database = new RecordingAuthD1Database({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
      totpEnabled: false,
      totpEncryptedSecret: null,
      totpLastAcceptedStep: null,
    })

    await expect(
      findAuthUserByEmail(database, 'person@example.test'),
    ).resolves.toEqual({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
      totpEnabled: false,
      totpEncryptedSecret: null,
      totpLastAcceptedStep: null,
    })
    expect(database.boundValues).toContain('person@example.test')
  })

  it('looks up auth users by ID for authenticated API reads', async () => {
    const database = new RecordingAuthD1Database({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
    })

    await expect(findAuthUserById(database, 'user-id')).resolves.toMatchObject({
      id: 'user-id',
      emailNormalized: 'person@example.test',
      createdAt: '2026-07-06T00:00:00.000Z',
    })
    expect(database.boundValues).toContain('user-id')
  })

  it('upserts a device and stores only the refresh token hash', async () => {
    const database = new RecordingAuthD1Database(null)

    await createPasswordGrantSession(database, {
      userId: 'user-id',
      deviceIdentifier: 'device-identifier',
      deviceName: 'Desktop',
      deviceType: 9,
      refreshTokenId: 'refresh-token-id',
      refreshTokenHash: 'hashed-refresh-token',
      refreshTokenExpiresAt: '2026-08-05T00:00:00.000Z',
      now: '2026-07-06T00:00:00.000Z',
    })

    expect(database.batchStatements).toHaveLength(3)
    expect(database.boundValues).toContain(
      buildDeviceId('user-id', 'device-identifier'),
    )
    expect(database.boundValues).toContain('hashed-refresh-token')
    expect(database.boundValues).not.toContain('plaintext-refresh-token')
  })

  it('lists active devices for one user', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, null, [
      {
        id: 'user-id:desktop-device',
        userId: 'user-id',
        identifier: 'desktop-device',
        name: 'Desktop',
        type: 9,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
      {
        id: 'other-user:desktop-device',
        userId: 'other-user',
        identifier: 'desktop-device',
        name: 'Other Desktop',
        type: 9,
        lastSeenAt: '2026-07-06T00:20:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:20:00.000Z',
      },
      {
        id: 'user-id:revoked-device',
        userId: 'user-id',
        identifier: 'revoked-device',
        name: 'Revoked',
        type: 9,
        revokedAt: '2026-07-06T00:30:00.000Z',
        lastSeenAt: '2026-07-06T00:15:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:30:00.000Z',
      },
    ])

    await expect(listDevicesByUser(database, 'user-id')).resolves.toEqual([
      {
        id: 'user-id:desktop-device',
        userId: 'user-id',
        identifier: 'desktop-device',
        name: 'Desktop',
        type: 9,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
    ])

    const query = database.queries.join('\n')
    expect(query).toContain('FROM devices')
    expect(query).toContain('WHERE user_id = ?')
    expect(query).toContain('revoked_at IS NULL')
    expect(query).toContain('ORDER BY')
    expect(database.boundValues).toContain('user-id')
  })

  it('finds an active device by owner and identifier', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, null, [
      {
        id: 'user-id:fixture-device',
        userId: 'user-id',
        identifier: 'fixture-device',
        name: 'CLI',
        type: 8,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
      {
        id: 'other-user:fixture-device',
        userId: 'other-user',
        identifier: 'fixture-device',
        name: 'Other CLI',
        type: 8,
        lastSeenAt: '2026-07-06T00:20:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:20:00.000Z',
      },
    ])

    await expect(
      findDeviceByIdentifier(database, {
        userId: 'user-id',
        identifier: 'fixture-device',
      }),
    ).resolves.toMatchObject({
      id: 'user-id:fixture-device',
      userId: 'user-id',
      identifier: 'fixture-device',
      name: 'CLI',
      type: 8,
    })

    const query = database.queries.join('\n')
    expect(query).toContain('FROM devices')
    expect(query).toContain('WHERE user_id = ?')
    expect(query).toContain('identifier = ?')
    expect(query).toContain('revoked_at IS NULL')
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('fixture-device')
  })

  it('updates active owner-scoped device metadata', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, null, [
      {
        id: 'user-id:fixture-device',
        userId: 'user-id',
        identifier: 'fixture-device',
        name: 'CLI',
        type: 8,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
    ])

    await expect(
      updateDeviceMetadata(database, {
        userId: 'user-id',
        deviceId: 'user-id:fixture-device',
        name: 'Renamed CLI',
        type: 9,
        updatedAt: '2026-07-07T18:06:30.000Z',
      }),
    ).resolves.toEqual({
      status: 'updated',
      device: {
        id: 'user-id:fixture-device',
        userId: 'user-id',
        identifier: 'fixture-device',
        name: 'Renamed CLI',
        type: 9,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-07T18:06:30.000Z',
      },
    })

    const query = database.queries.join('\n')
    expect(query).toContain('FROM devices')
    expect(query).toContain('UPDATE devices')
    expect(query).toContain('revoked_at IS NULL')
    expect(database.boundValues).toContain('Renamed CLI')
    expect(database.boundValues).toContain(9)
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('user-id:fixture-device')
  })

  it('does not update missing, cross-user, or revoked device metadata', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 0, 0, null, [
      {
        id: 'other-user:fixture-device',
        userId: 'other-user',
        identifier: 'fixture-device',
        name: 'Other CLI',
        type: 8,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
      {
        id: 'user-id:revoked-device',
        userId: 'user-id',
        identifier: 'revoked-device',
        name: 'Revoked',
        type: 8,
        revokedAt: '2026-07-06T00:15:00.000Z',
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:15:00.000Z',
      },
    ])

    await expect(
      updateDeviceMetadata(database, {
        userId: 'user-id',
        deviceId: 'user-id:missing-device',
        name: 'Renamed CLI',
        type: 9,
        updatedAt: '2026-07-07T18:06:30.000Z',
      }),
    ).resolves.toEqual({
      status: 'not_found',
    })

    expect(database.queries.join('\n')).not.toContain('UPDATE devices')
  })

  it('updates active owner-scoped encrypted device keys', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, null, [
      {
        id: 'user-id:fixture-device',
        userId: 'user-id',
        identifier: 'fixture-device',
        name: 'CLI',
        type: 8,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
    ])

    await expect(
      updateDeviceKeys(database, {
        userId: 'user-id',
        deviceIdOrIdentifier: 'fixture-device',
        encryptedUserKey: '2.encrypted-user-key',
        encryptedPublicKey: '2.encrypted-public-key',
        encryptedPrivateKey: '2.encrypted-private-key',
        updatedAt: '2026-07-07T18:06:30.000Z',
      }),
    ).resolves.toEqual({
      status: 'updated',
      device: {
        id: 'user-id:fixture-device',
        userId: 'user-id',
        identifier: 'fixture-device',
        name: 'CLI',
        type: 8,
        encryptedUserKey: '2.encrypted-user-key',
        encryptedPublicKey: '2.encrypted-public-key',
        encryptedPrivateKey: '2.encrypted-private-key',
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-07T18:06:30.000Z',
      },
    })

    const query = database.queries.join('\n')
    expect(query).toContain('FROM devices')
    expect(query).toContain('identifier = ?')
    expect(query).toContain('UPDATE devices')
    expect(query).toContain('encrypted_user_key = ?')
    expect(query).toContain('encrypted_public_key = ?')
    expect(query).toContain('encrypted_private_key = ?')
    expect(query).toContain('revoked_at IS NULL')
    expect(database.boundValues).toContain('2.encrypted-user-key')
    expect(database.boundValues).toContain('2.encrypted-public-key')
    expect(database.boundValues).toContain('2.encrypted-private-key')
    expect(database.boundValues).toContain('fixture-device')
  })

  it('does not update keys for missing, cross-user, or revoked devices', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 0, 0, null, [
      {
        id: 'other-user:fixture-device',
        userId: 'other-user',
        identifier: 'fixture-device',
        name: 'Other CLI',
        type: 8,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
      {
        id: 'user-id:revoked-device',
        userId: 'user-id',
        identifier: 'revoked-device',
        name: 'Revoked',
        type: 8,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        revokedAt: '2026-07-06T00:15:00.000Z',
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:15:00.000Z',
      },
    ])

    await expect(
      updateDeviceKeys(database, {
        userId: 'user-id',
        deviceIdOrIdentifier: 'fixture-device',
        encryptedUserKey: '2.encrypted-user-key',
        encryptedPublicKey: '2.encrypted-public-key',
        encryptedPrivateKey: '2.encrypted-private-key',
        updatedAt: '2026-07-07T18:06:30.000Z',
      }),
    ).resolves.toEqual({
      status: 'not_found',
    })

    expect(database.queries.join('\n')).not.toContain('UPDATE devices')
  })

  it('bulk updates trusted keys for active owner-scoped current and other devices', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, null, [
      {
        id: 'user-id:current-device',
        userId: 'user-id',
        identifier: 'current-device',
        name: 'Current CLI',
        type: 8,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
      {
        id: 'user-id:other-device',
        userId: 'user-id',
        identifier: 'other-device',
        name: 'Other Browser',
        type: 3,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        lastSeenAt: '2026-07-06T00:20:00.000Z',
        createdAt: '2026-07-06T00:01:00.000Z',
        updatedAt: '2026-07-06T00:20:00.000Z',
      },
    ])

    await expect(
      updateTrustedDeviceKeys(database, {
        userId: 'user-id',
        updatedAt: '2026-07-07T18:06:30.000Z',
        devices: [
          {
            deviceIdOrIdentifier: 'current-device',
            encryptedUserKey: '2.current-user-key',
            encryptedPublicKey: '2.current-public-key',
            encryptedPrivateKey: '2.current-private-key',
          },
          {
            deviceIdOrIdentifier: 'user-id:other-device',
            encryptedUserKey: '2.other-user-key',
            encryptedPublicKey: '2.other-public-key',
            encryptedPrivateKey: '2.other-private-key',
          },
        ],
      }),
    ).resolves.toEqual({
      status: 'updated',
      devices: [
        {
          id: 'user-id:current-device',
          userId: 'user-id',
          identifier: 'current-device',
          name: 'Current CLI',
          type: 8,
          encryptedUserKey: '2.current-user-key',
          encryptedPublicKey: '2.current-public-key',
          encryptedPrivateKey: '2.current-private-key',
          lastSeenAt: '2026-07-06T00:10:00.000Z',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-07T18:06:30.000Z',
        },
        {
          id: 'user-id:other-device',
          userId: 'user-id',
          identifier: 'other-device',
          name: 'Other Browser',
          type: 3,
          encryptedUserKey: '2.other-user-key',
          encryptedPublicKey: '2.other-public-key',
          encryptedPrivateKey: '2.other-private-key',
          lastSeenAt: '2026-07-06T00:20:00.000Z',
          createdAt: '2026-07-06T00:01:00.000Z',
          updatedAt: '2026-07-07T18:06:30.000Z',
        },
      ],
    })

    const query = database.queries.join('\n')
    expect(query).toContain('identifier = ?')
    expect(query).toContain('id = ?')
    expect(query).toContain('UPDATE devices')
    expect(query).toContain('encrypted_user_key = ?')
    expect(database.batchStatements).toHaveLength(2)
    expect(database.boundValues).toContain('2.current-private-key')
    expect(database.boundValues).toContain('2.other-private-key')
  })

  it('does not bulk update trusted keys when any requested device is missing', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, null, [
      {
        id: 'user-id:current-device',
        userId: 'user-id',
        identifier: 'current-device',
        name: 'Current CLI',
        type: 8,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
        lastSeenAt: '2026-07-06T00:10:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:10:00.000Z',
      },
    ])

    await expect(
      updateTrustedDeviceKeys(database, {
        userId: 'user-id',
        updatedAt: '2026-07-07T18:06:30.000Z',
        devices: [
          {
            deviceIdOrIdentifier: 'current-device',
            encryptedUserKey: '2.current-user-key',
            encryptedPublicKey: '2.current-public-key',
            encryptedPrivateKey: '2.current-private-key',
          },
          {
            deviceIdOrIdentifier: 'missing-device',
            encryptedUserKey: '2.missing-user-key',
            encryptedPublicKey: '2.missing-public-key',
            encryptedPrivateKey: '2.missing-private-key',
          },
        ],
      }),
    ).resolves.toEqual({
      status: 'not_found',
      missingDeviceIdOrIdentifier: 'missing-device',
    })

    expect(database.batchStatements).toHaveLength(0)
    expect(database.queries.join('\n')).not.toContain('UPDATE devices')
  })

  it('checks whether an active user has an active known device', async () => {
    const database = new RecordingAuthD1Database(
      {
        id: 'user-id',
        emailNormalized: 'person@example.test',
        disabledAt: null,
      },
      null,
      1,
      1,
      0,
      null,
      [
        {
          id: 'user-id:fixture-device',
          userId: 'user-id',
          identifier: 'fixture-device',
          name: 'CLI',
          type: 8,
          lastSeenAt: '2026-07-06T00:10:00.000Z',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:10:00.000Z',
        },
      ],
    )

    await expect(
      knownActiveDeviceExists(database, {
        emailNormalized: 'person@example.test',
        identifier: 'fixture-device',
      }),
    ).resolves.toBe(true)

    const query = database.queries.join('\n')
    expect(query).toContain('FROM users u')
    expect(query).toContain('JOIN devices d')
    expect(query).toContain('u.email_normalized = ?')
    expect(query).toContain('u.disabled_at IS NULL')
    expect(query).toContain('d.identifier = ?')
    expect(query).toContain('d.revoked_at IS NULL')
    expect(database.boundValues).toContain('person@example.test')
    expect(database.boundValues).toContain('fixture-device')
  })

  it('returns false when a known-device lookup misses', async () => {
    const database = new RecordingAuthD1Database(null)

    await expect(
      knownActiveDeviceExists(database, {
        emailNormalized: 'person@example.test',
        identifier: 'missing-device',
      }),
    ).resolves.toBe(false)
  })

  it('finds refresh token sessions with user and device context', async () => {
    const database = new RecordingAuthD1Database(null, {
      tokenId: 'refresh-token-id',
      userId: 'user-id',
      deviceId: 'device-id',
      deviceIdentifier: 'device-identifier',
      tokenExpiresAt: '2026-08-05T00:00:00.000Z',
      tokenRevokedAt: null,
      deviceRevokedAt: null,
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
    })

    await expect(
      findRefreshTokenSessionByHash(database, 'hashed-refresh-token'),
    ).resolves.toMatchObject({
      tokenId: 'refresh-token-id',
      userId: 'user-id',
      deviceId: 'device-id',
      deviceIdentifier: 'device-identifier',
      user: {
        emailNormalized: 'person@example.test',
      },
    })
    expect(database.boundValues).toContain('hashed-refresh-token')
  })

  it('rotates refresh token hashes after conditionally revoking the old token', async () => {
    const database = new RecordingAuthD1Database(null, null, 1)

    await expect(
      rotateRefreshToken(database, {
        currentTokenId: 'current-refresh-token-id',
        userId: 'user-id',
        deviceId: 'device-id',
        deviceIdentifier: 'device-identifier',
        deviceName: 'Desktop',
        deviceType: 9,
        nextRefreshTokenId: 'next-refresh-token-id',
        nextRefreshTokenHash: 'next-refresh-token-hash',
        nextRefreshTokenExpiresAt: '2026-08-05T00:00:00.000Z',
        now: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'rotated',
    })

    expect(database.boundValues).toContain('current-refresh-token-id')
    expect(database.boundValues).toContain('next-refresh-token-hash')
    expect(database.boundValues).not.toContain('next-refresh-token-plaintext')
    expect(database.batchStatements).toHaveLength(2)
  })

  it('invalidates the device session when rotation detects reuse', async () => {
    const database = new RecordingAuthD1Database(null, null, 0)

    await expect(
      rotateRefreshToken(database, {
        currentTokenId: 'current-refresh-token-id',
        userId: 'user-id',
        deviceId: 'device-id',
        deviceIdentifier: 'device-identifier',
        deviceName: 'Desktop',
        deviceType: 9,
        nextRefreshTokenId: 'next-refresh-token-id',
        nextRefreshTokenHash: 'next-refresh-token-hash',
        nextRefreshTokenExpiresAt: '2026-08-05T00:00:00.000Z',
        now: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'reuse_detected',
    })

    expect(database.batchStatements).toHaveLength(2)
    expect(database.boundValues).toContain('device-id')
    expect(database.boundValues).not.toContain('next-refresh-token-hash')
  })

  it('deletes refresh-token history only at the retention cutoff in bounded idempotent slices', async () => {
    const refreshTokens = [
      {
        id: 'oldest-expired-token',
        expiresAt: '2026-06-30T23:59:59.999Z',
        revokedAt: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'cutoff-token',
        expiresAt: '2026-07-01T00:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'active-token',
        expiresAt: '2026-08-01T00:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'revoked-but-unexpired-token',
        expiresAt: '2026-07-15T00:00:00.000Z',
        revokedAt: '2026-06-20T00:00:00.000Z',
      },
    ]
    const database = new RefreshTokenRetentionD1Database(refreshTokens)
    const input = {
      now: '2026-07-31T00:00:00.000Z',
      limit: 1,
    }

    await expect(deleteExpiredRefreshTokens(database, input)).resolves.toBe(1)
    expect(refreshTokens.map((row) => row.id)).toEqual([
      'cutoff-token',
      'active-token',
      'revoked-but-unexpired-token',
    ])

    await expect(deleteExpiredRefreshTokens(database, input)).resolves.toBe(1)
    await expect(deleteExpiredRefreshTokens(database, input)).resolves.toBe(0)

    expect(refreshTokens.map((row) => row.id)).toEqual([
      'active-token',
      'revoked-but-unexpired-token',
    ])
    expect(normalizeSql(database.queries[0] ?? '')).toBe(
      'DELETE FROM refresh_tokens WHERE id IN ( SELECT id FROM refresh_tokens WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ? )',
    )
    expect(database.queries[0]).not.toContain('revoked_at')
    expect(database.bindings).toEqual([
      ['2026-07-01T00:00:00.000Z', 1],
      ['2026-07-01T00:00:00.000Z', 1],
      ['2026-07-01T00:00:00.000Z', 1],
    ])
  })

  it('preserves revoked-token reuse invalidation after an expired rotation parent is retained-cleaned', async () => {
    const currentToken = {
      id: 'revoked-current-token',
      tokenId: 'revoked-current-token',
      userId: 'user-id',
      deviceId: 'device-id',
      deviceIdentifier: 'device-identifier',
      tokenHash: 'revoked-current-token-hash',
      rotatedFromTokenId: 'expired-rotation-parent',
      expiresAt: '2026-07-15T00:00:00.000Z',
      tokenExpiresAt: '2026-07-15T00:00:00.000Z',
      revokedAt: '2026-06-20T00:00:00.000Z',
      tokenRevokedAt: '2026-06-20T00:00:00.000Z',
      deviceRevokedAt: null,
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-06-20T00:00:00.000Z',
      createdAt: '2026-06-20T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
      totpEnabled: false,
      totpEncryptedSecret: null,
      totpLastAcceptedStep: null,
    }
    const refreshTokens: Record<string, unknown>[] = [
      {
        id: 'expired-rotation-parent',
        tokenHash: 'expired-parent-token-hash',
        expiresAt: '2026-06-01T00:00:00.000Z',
        revokedAt: '2026-05-15T00:00:00.000Z',
      },
      currentToken,
    ]
    const database = new RefreshTokenRetentionD1Database(refreshTokens)

    await expect(
      deleteExpiredRefreshTokens(database, {
        now: '2026-07-01T00:00:00.000Z',
        limit: 100,
      }),
    ).resolves.toBe(1)
    expect(refreshTokens).toHaveLength(1)
    expect(currentToken.rotatedFromTokenId).toBeNull()

    const session = await findRefreshTokenSessionByHash(
      database,
      'revoked-current-token-hash',
    )
    expect(session).toMatchObject({
      tokenId: 'revoked-current-token',
      tokenRevokedAt: '2026-06-20T00:00:00.000Z',
    })

    await expect(
      rotateRefreshToken(database, {
        currentTokenId: session?.tokenId ?? '',
        userId: session?.userId ?? '',
        deviceId: session?.deviceId ?? '',
        deviceIdentifier: session?.deviceIdentifier ?? '',
        deviceName: null,
        deviceType: null,
        nextRefreshTokenId: 'must-not-be-created',
        nextRefreshTokenHash: 'must-not-be-stored',
        nextRefreshTokenExpiresAt: '2026-08-01T00:00:00.000Z',
        now: '2026-07-01T00:00:01.000Z',
      }),
    ).resolves.toEqual({ status: 'reuse_detected' })

    expect(database.batchQueries).toHaveLength(1)
    expect(database.batchQueries[0]?.join('\n')).toContain(
      'WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL',
    )
    expect(database.batchQueries[0]?.join('\n')).toContain('UPDATE devices')
    expect(database.bindings.flat()).not.toContain('must-not-be-stored')
  })

  it('can invalidate active refresh tokens for one device session', async () => {
    const database = new RecordingAuthD1Database(null)

    await invalidateRefreshTokenSession(
      database,
      'user-id',
      'device-id',
      '2026-07-06T00:00:00.000Z',
    )

    expect(database.batchStatements).toHaveLength(2)
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('device-id')
  })

  it('records a failed login state for an existing user', async () => {
    const database = new RecordingAuthD1Database(null)

    await recordFailedLogin(database, {
      userId: 'user-id',
      failedCount: 5,
      failedAt: '2026-07-06T00:05:00.000Z',
      lockedUntil: '2026-07-06T00:20:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('UPDATE users')
    expect(database.queries.join('\n')).toContain('login_failed_count')
    expect(database.boundValues).toContain(5)
    expect(database.boundValues).toContain('2026-07-06T00:20:00.000Z')
  })

  it('resets login defense state after a successful password grant', async () => {
    const database = new RecordingAuthD1Database(null)

    await resetLoginDefenseState(database, {
      userId: 'user-id',
      resetAt: '2026-07-06T00:06:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('UPDATE users')
    expect(database.queries.join('\n')).toContain('login_failed_count = 0')
    expect(database.queries.join('\n')).toContain('login_locked_until = NULL')
    expect(database.boundValues).toContain('user-id')
  })

  it('records auth attempts without plaintext network source values', async () => {
    const database = new RecordingAuthD1Database(null)

    await recordAuthAttempt(database, {
      id: 'attempt-id',
      bucketKey: 'ip:hashed-bucket',
      subjectKey: 'account:hashed-subject',
      successful: false,
      occurredAt: '2026-07-06T00:05:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('INSERT INTO auth_attempts')
    expect(database.boundValues).toContain('ip:hashed-bucket')
    expect(database.boundValues).not.toContain('203.0.113.10')
  })

  it('counts recent failed auth attempts for a bucket', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 12)

    await expect(
      countRecentFailedAuthAttempts(database, {
        bucketKey: 'ip:hashed-bucket',
        occurredAfter: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toBe(12)

    expect(database.queries.join('\n')).toContain('COUNT(*) as count')
    expect(database.boundValues).toContain('ip:hashed-bucket')
  })

  it('looks up a failed auth bucket by hashed key', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, {
      bucketKey: 'account:hashed-bucket',
      failedCount: 4,
      windowStartedAt: '2026-07-06T00:00:00.000Z',
      lockedUntil: null,
      updatedAt: '2026-07-06T00:04:00.000Z',
    })

    await expect(
      findAuthFailureBucket(database, 'account:hashed-bucket'),
    ).resolves.toEqual({
      bucketKey: 'account:hashed-bucket',
      failedCount: 4,
      windowStartedAt: '2026-07-06T00:00:00.000Z',
      lockedUntil: null,
      updatedAt: '2026-07-06T00:04:00.000Z',
    })
    expect(database.queries.join('\n')).toContain('FROM auth_failure_buckets')
    expect(database.boundValues).toContain('account:hashed-bucket')
  })

  it('atomically advances failed auth buckets in the database', async () => {
    const database = new RecordingAuthD1Database(null)

    await expect(
      recordFailedAuthBucket(database, {
        bucketKey: 'ip:hashed-bucket',
        failureLimit: 20,
        failureWindowSeconds: 60,
        lockoutSeconds: 60,
        now: '2026-07-06T00:05:00.000Z',
      }),
    ).resolves.toEqual({
      bucketKey: 'ip:hashed-bucket',
      failedCount: 1,
      windowStartedAt: '2026-07-06T00:05:00.000Z',
      lockedUntil: null,
      updatedAt: '2026-07-06T00:05:00.000Z',
    })

    const joinedQueries = database.queries.join('\n')
    expect(joinedQueries).toContain('INSERT INTO auth_failure_buckets')
    expect(joinedQueries).toContain('ON CONFLICT(bucket_key) DO UPDATE')
    expect(joinedQueries).toContain('auth_failure_buckets.failed_count + 1')
    expect(database.boundValues).toContain('ip:hashed-bucket')
    expect(database.boundValues).toContain(20)
  })

  it('resets a failed auth bucket after successful authentication', async () => {
    const database = new RecordingAuthD1Database(null)

    await resetAuthFailureBucket(database, 'account:hashed-bucket')

    expect(database.queries.join('\n')).toContain(
      'DELETE FROM auth_failure_buckets',
    )
    expect(database.boundValues).toContain('account:hashed-bucket')
  })

  it('cleans up stale auth-defense rows in bounded, idempotent slices', async () => {
    const database = new CleanupAwareAuthD1Database(3, 2)
    const cleanupInput = {
      now: '2026-07-06T00:10:00.000Z',
      authAttemptExpiredBefore: '2026-07-06T00:00:00.000Z',
      authFailureBucketExpiredBefore: '2026-07-06T00:00:00.000Z',
      maxRowsPerQuery: 5,
    }

    await expect(
      cleanupAuthDefenseState(database, cleanupInput),
    ).resolves.toEqual({
      deletedAuthAttempts: 3,
      deletedAuthFailureBuckets: 2,
    })
    await expect(
      cleanupAuthDefenseState(database, cleanupInput),
    ).resolves.toEqual({
      deletedAuthAttempts: 0,
      deletedAuthFailureBuckets: 0,
    })

    const query = database.queries.join('\n')
    expect(query).toContain('DELETE FROM auth_attempts')
    expect(query).toContain('DELETE FROM auth_failure_buckets')
    expect(query).toContain('ORDER BY occurred_at ASC')
    expect(query).toContain('ORDER BY updated_at ASC')
    expect(query).toContain('LIMIT ?')
    expect(database.boundValues).toContain('2026-07-06T00:00:00.000Z')
    expect(database.boundValues).toContain(5)
  })

  it('revokes an active owner-scoped device session', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1)

    await expect(
      revokeDeviceSession(database, {
        userId: 'user-id',
        deviceId: 'target-device-id',
        revokedAt: '2026-07-06T00:10:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'revoked',
      deviceId: 'target-device-id',
      revokedAt: '2026-07-06T00:10:00.000Z',
    })

    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('target-device-id')
    expect(database.queries.join('\n')).toContain('UPDATE devices')
    expect(database.queries.join('\n')).toContain('revoked_at = ?')
    expect(database.queries.join('\n')).toContain('UPDATE refresh_tokens')
  })

  it('returns not found when revoking a missing, cross-user, or already revoked device', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 0)

    await expect(
      revokeDeviceSession(database, {
        userId: 'user-id',
        deviceId: 'target-device-id',
        revokedAt: '2026-07-06T00:10:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'not_found',
    })

    expect(database.queries.join('\n')).toContain('UPDATE devices')
    expect(database.queries.join('\n')).not.toContain('UPDATE refresh_tokens')
  })

  it('revokes every other device session while preserving the current device', async () => {
    const database = new RecordingAuthD1Database(null)

    await expect(
      revokeOtherDeviceSessions(database, {
        userId: 'user-id',
        currentDeviceId: 'user-id:current-device',
        revokedAt: '2026-07-06T00:15:00.000Z',
      }),
    ).resolves.toEqual({
      currentDeviceId: 'user-id:current-device',
      currentSessionRevoked: false,
      revokedAt: '2026-07-06T00:15:00.000Z',
    })

    const query = database.queries.join('\n')
    expect(query).toContain('UPDATE devices')
    expect(query).toContain('UPDATE refresh_tokens')
    expect(query).toContain('id <> ?')
    expect(query).toContain('device_id <> ?')
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('user-id:current-device')
    expect(database.batchStatements).toHaveLength(2)
  })
})

class CleanupAwareAuthD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  private remainingAuthAttemptDeletes: number
  private remainingAuthFailureBucketDeletes: number

  constructor(
    initialAuthAttemptDeletes = 1,
    initialAuthFailureBucketDeletes = 1,
  ) {
    this.remainingAuthAttemptDeletes = initialAuthAttemptDeletes
    this.remainingAuthFailureBucketDeletes = initialAuthFailureBucketDeletes
  }

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const thisBoundValues = this.boundValues
    const thisRemainingAuthAttemptDeletes = () => {
      const value = this.remainingAuthAttemptDeletes
      this.remainingAuthAttemptDeletes = 0

      return value
    }
    const thisRemainingAuthFailureBucketDeletes = () => {
      const value = this.remainingAuthFailureBucketDeletes
      this.remainingAuthFailureBucketDeletes = 0

      return value
    }

    const run = async <T = Record<string, unknown>>(): Promise<D1Result<T>> => {
      let changes = fakeMeta.changes

      if (/DELETE\s+FROM\s+auth_attempts/.test(query)) {
        changes = thisRemainingAuthAttemptDeletes()
      }

      if (/DELETE\s+FROM\s+auth_failure_buckets/.test(query)) {
        changes = thisRemainingAuthFailureBucketDeletes()
      }

      return {
        success: true,
        results: [],
        meta: {
          ...fakeMeta,
          changes,
        },
      }
    }

    const bind = (...values: unknown[]) => {
      thisBoundValues.push(...values)
      return statement
    }

    const statement = {
      bind,
      first: async <T = unknown>(): Promise<T | null> => null,
      all: async <T = unknown>(): Promise<D1Result<T>> => ({
        success: true,
        results: [],
        meta: fakeMeta,
      }),
      run,
      raw: async <T = unknown>(): Promise<T[]> => [],
    } as D1PreparedStatement

    return statement
  }
}

class RefreshTokenRetentionD1Database {
  readonly batchQueries: string[][] = []
  readonly bindings: unknown[][] = []
  readonly queries: string[] = []

  constructor(private readonly refreshTokens: Record<string, unknown>[]) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    let boundValues: unknown[] = []
    const statement = {
      __query: query,
      bind: (...values: unknown[]) => {
        boundValues = values
        this.bindings.push(values)
        return statement
      },
      first: async <T = unknown>(): Promise<T | null> => {
        if (!query.includes('FROM refresh_tokens')) {
          return null
        }

        const tokenHash = String(boundValues[0] ?? '')
        return (this.refreshTokens.find((row) => row.tokenHash === tokenHash) ??
          null) as T | null
      },
      all: async <T = unknown>(): Promise<D1Result<T>> => ({
        success: true,
        results: [],
        meta: fakeMeta,
      }),
      run: async <T = Record<string, unknown>>(): Promise<D1Result<T>> => {
        let changes = 0

        if (/DELETE\s+FROM\s+refresh_tokens/.test(query)) {
          const [cutoff, rawLimit] = boundValues
          const deletedIds = [...this.refreshTokens]
            .filter(
              (row) =>
                String(row.expiresAt ?? row.tokenExpiresAt) <= String(cutoff),
            )
            .sort((left, right) =>
              String(left.expiresAt ?? left.tokenExpiresAt).localeCompare(
                String(right.expiresAt ?? right.tokenExpiresAt),
              ),
            )
            .slice(0, Number(rawLimit))
            .map((row) => row.id)

          this.refreshTokens.splice(
            0,
            this.refreshTokens.length,
            ...this.refreshTokens.filter((row) => !deletedIds.includes(row.id)),
          )
          for (const row of this.refreshTokens) {
            if (deletedIds.includes(row.rotatedFromTokenId)) {
              row.rotatedFromTokenId = null
            }
          }
          changes = deletedIds.length
        } else if (
          /UPDATE\s+refresh_tokens/.test(query) &&
          query.includes('WHERE id = ?')
        ) {
          const [, id, userId, deviceId] = boundValues
          const row = this.refreshTokens.find(
            (candidate) =>
              candidate.id === id &&
              candidate.userId === userId &&
              candidate.deviceId === deviceId &&
              candidate.revokedAt == null,
          )
          changes = row ? 1 : 0
        }

        return {
          success: true,
          results: [],
          meta: { ...fakeMeta, changes },
        }
      },
      raw: async <T = unknown>(): Promise<T[]> => [],
    } as unknown as D1PreparedStatement

    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const queries = statements.map(
      (statement) => (statement as unknown as { __query: string }).__query,
    )
    this.batchQueries.push(queries)

    return statements.map(() => ({
      success: true,
      results: [],
      meta: fakeMeta,
    }))
  }
}

class RecordingAuthD1Database {
  boundValues: unknown[] = []
  batchStatements: D1PreparedStatement[] = []
  queries: string[] = []
  private authFailureBucketRow: unknown

  constructor(
    private readonly userRow: unknown,
    private readonly refreshSessionRow: unknown = null,
    private readonly updateChanges = 1,
    private readonly deviceUpdateChanges = 1,
    private readonly failedAttemptCount = 0,
    authFailureBucketRow: unknown = null,
    private readonly deviceRows: unknown[] = [],
  ) {
    this.authFailureBucketRow = authFailureBucketRow
  }

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    let statementBoundValues: unknown[] = []
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
      statementBoundValues = values
    }
    const getUserRow = () => this.userRow
    const getRefreshSessionRow = () => this.refreshSessionRow
    const getUpdateChanges = () => this.updateChanges
    const getDeviceUpdateChanges = () => this.deviceUpdateChanges
    const getFailedAttemptCount = () => this.failedAttemptCount
    const getAuthFailureBucketRow = () => this.authFailureBucketRow
    const getDeviceRows = () => this.deviceRows
    const setAuthFailureBucketRow = (row: unknown) => {
      this.authFailureBucketRow = row
    }

    const statement = {
      bind(...values: unknown[]) {
        pushValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        if (query.includes('FROM auth_failure_buckets')) {
          return getAuthFailureBucketRow() as T | null
        }

        if (query.includes('COUNT(*) as count')) {
          return {
            count: getFailedAttemptCount(),
          } as T
        }

        if (query.includes('FROM refresh_tokens')) {
          return getRefreshSessionRow() as T | null
        }

        if (
          query.includes('FROM users u') &&
          query.includes('JOIN devices d')
        ) {
          const emailNormalized = String(statementBoundValues[0] ?? '')
          const identifier = String(statementBoundValues[1] ?? '')
          const user = getUserRow()

          if (
            isRecord(user) &&
            user.emailNormalized === emailNormalized &&
            !user.disabledAt &&
            filterRecordingDeviceRows(getDeviceRows(), [user.id]).some(
              (row) => row.identifier === identifier,
            )
          ) {
            return { found: 1 } as T
          }

          return null
        }

        if (query.includes('FROM devices')) {
          const lookupValue = String(statementBoundValues[1] ?? '')
          const rows = filterRecordingDeviceRows(
            getDeviceRows(),
            statementBoundValues,
          )

          if (query.includes('identifier = ?')) {
            return (rows.find((row) => row.identifier === lookupValue) ??
              null) as T | null
          }

          return (rows.find((row) => row.id === lookupValue) ??
            null) as T | null
        }

        if (query.includes('FROM users')) {
          return getUserRow() as T | null
        }

        return null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        if (query.includes('FROM devices')) {
          return {
            success: true,
            results: filterRecordingDeviceRows(
              getDeviceRows(),
              statementBoundValues,
            ) as T[],
            meta: fakeMeta,
          }
        }

        return {
          success: true,
          results: [],
          meta: fakeMeta,
        }
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        if (query.includes('INSERT INTO auth_failure_buckets')) {
          setAuthFailureBucketRow({
            bucketKey: statementBoundValues[0],
            failedCount: 1,
            windowStartedAt: statementBoundValues[1],
            lockedUntil: statementBoundValues[2],
            updatedAt: statementBoundValues[3],
          })
        }

        if (/DELETE\s+FROM\s+auth_failure_buckets/.test(query)) {
          setAuthFailureBucketRow(null)
        }

        const changes =
          /UPDATE\s+devices/.test(query) &&
          (query.includes('revoked_at = ?') ||
            query.includes('encrypted_user_key = ?'))
            ? getDeviceUpdateChanges()
            : /UPDATE\s+refresh_tokens/.test(query)
              ? getUpdateChanges()
              : fakeMeta.changes

        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes,
          },
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchStatements = statements

    return statements.map(() => ({
      success: true,
      results: [],
      meta: fakeMeta,
    }))
  }
}

function filterRecordingDeviceRows(
  rows: unknown[],
  boundValues: unknown[],
): Record<string, unknown>[] {
  const userId = String(boundValues[0] ?? '')

  return rows.filter(isRecord).filter((row) => {
    const revokedAt = row.revokedAt ?? row.revoked_at

    return (
      row.userId === userId && (revokedAt === null || revokedAt === undefined)
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/g, ' ').trim()
}
