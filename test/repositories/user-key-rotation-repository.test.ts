import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import type { UserKeyRotationRequest } from '../../src/domain/user-key-rotation'
import {
  rotateUserKeyGeneration,
  userKeyRotationRepositoryPolicy,
} from '../../src/repositories/user-key-rotation-repository'

const userId = '11111111-1111-4111-8111-111111111111'
const folderId = '22222222-2222-4222-8222-222222222222'
const cipherId = '33333333-3333-4333-8333-333333333333'
const attachmentId = '44444444-4444-4444-8444-444444444444'
const deviceId = '55555555-5555-4555-8555-555555555555'
const oldRevisionDate = '2026-07-20T00:00:00.000Z'
const nextRevisionDate = '2026-07-20T00:00:01.000Z'

describe('user key rotation repository', () => {
  it('commits one exact generation in a bounded batch without mutating R2 identity', async () => {
    const fixture = rotationFixture()
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toEqual({
      status: 'rotated',
      securityStamp: fixture.input.nextSecurityStamp,
      revisionDate: nextRevisionDate,
      rotatedFolderCount: 1,
      rotatedCipherCount: 1,
      rotatedAttachmentCount: 1,
      rotatedTrustedDeviceCount: 1,
      revokedDeviceCount: 2,
      revokedRefreshTokenCount: 2,
      invalidatedAuthRequestCount: 2,
      auditEventId: fixture.input.auditEventId,
      budget: {
        snapshotQueries: 5,
        mutationStatements: 10,
        totalQueries: 15,
      },
    })

    expect(database.readQueries).toHaveLength(5)
    expect(database.batchCalls).toHaveLength(1)
    const statements = database.batchCalls[0] ?? []
    expect(statements).toHaveLength(10)
    expect(statements[0]?.query).toContain('UPDATE users')
    expect(statements[0]?.query).toContain('json_each(?)')
    expect(statements.slice(1).every(hasCommittedGenerationGate)).toBe(true)

    const attachmentUpdate = statements.find((statement) =>
      statement.query.includes('UPDATE cipher_attachments'),
    )
    expect(attachmentUpdate?.query).toContain('file_name =')
    expect(attachmentUpdate?.query).toContain('attachment_key =')
    expect(attachmentUpdate?.query).not.toMatch(/SET[\s\S]*object_key\s*=/)
    expect(attachmentUpdate?.query).not.toMatch(/SET[\s\S]*size\s*=/)
    expect(attachmentUpdate?.query).not.toMatch(/SET[\s\S]*content_type\s*=/)

    const revokedKeyClear = statements.find((statement) =>
      statement.query.includes('encrypted_user_key = NULL'),
    )
    expect(revokedKeyClear?.query).toContain('revoked_at IS NOT NULL')
    expect(revokedKeyClear?.query).toContain('security_stamp = ?')

    for (const statement of [...database.readQueries, ...statements]) {
      expect(statement.query.length).toBeLessThanOrEqual(
        userKeyRotationRepositoryPolicy.maxStatementLength,
      )
      expect(statement.values.length).toBeLessThanOrEqual(
        userKeyRotationRepositoryPolicy.maxBoundParameters,
      )
      for (const value of statement.values) {
        if (typeof value === 'string') {
          expect(value.length).toBeLessThanOrEqual(
            userKeyRotationRepositoryPolicy.maxBoundValueLength,
          )
        }
      }
    }
  })

  it.each([
    ['deleted folder', { deletedFolderCount: 1 }],
    ['deleted personal cipher', { deletedCipherCount: 1 }],
    ['pending attachment', { pendingAttachmentCount: 1 }],
    ['partial trusted-device keys', { incompleteTrustedDeviceCount: 1 }],
    ['personal cipher key column', { personalCipherKeyCount: 1 }],
  ])(
    'rejects unsupported snapshot state before batch: %s',
    async (_, patch) => {
      const fixture = rotationFixture()
      Object.assign(fixture.snapshot.summary, patch)
      const database = new RotationD1Database(fixture.snapshot)

      await expect(
        rotateUserKeyGeneration(database, fixture.input),
      ).resolves.toMatchObject({ status: 'unsupported_state' })
      expect(database.batchCalls).toHaveLength(0)
      expect(database.readQueries).toHaveLength(1)
    },
  )

  it.each([
    'missing folder',
    'foreign cipher owner',
    'stale cipher revision',
    'changed immutable metadata',
    'missing attachment',
    'missing trusted device',
  ])('rejects an inexact manifest before batch: %s', async (variant) => {
    const fixture = rotationFixture()
    if (variant === 'missing folder') {
      fixture.request.folders = []
    } else if (variant === 'foreign cipher owner') {
      fixture.request.ciphers[0]!.encryptedFor =
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    } else if (variant === 'stale cipher revision') {
      fixture.request.ciphers[0]!.lastKnownRevisionDate =
        '2026-07-19T23:59:59.000Z'
    } else if (variant === 'changed immutable metadata') {
      fixture.request.ciphers[0]!.metadata.login!.uriMatches = [1]
    } else if (variant === 'missing attachment') {
      fixture.request.ciphers[0]!.attachments = []
    } else {
      fixture.request.trustedDevices = []
    }
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toEqual({ status: 'conflict' })
    expect(database.batchCalls).toHaveLength(0)
  })

  it('rejects an account generation mismatch before batch', async () => {
    const fixture = rotationFixture()
    fixture.snapshot.summary.securityStamp = 'concurrent-security-stamp'
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toEqual({ status: 'conflict' })
    expect(database.batchCalls).toHaveLength(0)
  })

  it('uses the protocol default when stored reprompt metadata is absent', async () => {
    const fixture = rotationFixture()
    const payload = JSON.parse(
      fixture.snapshot.ciphers[0]!.encryptedJson,
    ) as Record<string, unknown>
    delete payload.reprompt
    fixture.snapshot.ciphers[0]!.encryptedJson = JSON.stringify(payload)
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({ status: 'rotated' })
  })

  it('uses the existing cipher default when stored favorite metadata is absent', async () => {
    const fixture = rotationFixture()
    const storedPayload = JSON.parse(
      fixture.snapshot.ciphers[0]!.encryptedJson,
    ) as Record<string, unknown>
    delete storedPayload.favorite
    fixture.snapshot.ciphers[0]!.favorite = 0
    fixture.snapshot.ciphers[0]!.encryptedJson = JSON.stringify(storedPayload)

    const nextPayload = JSON.parse(
      fixture.request.ciphers[0]!.encryptedJson,
    ) as Record<string, unknown>
    nextPayload.favorite = false
    fixture.request.ciphers[0]!.favorite = false
    fixture.request.ciphers[0]!.encryptedJson = JSON.stringify(nextPayload)
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({ status: 'rotated' })
  })

  it('uses the parent cipher revision for attachment staleness', async () => {
    const fixture = rotationFixture()
    fixture.snapshot.attachments[0]!.revisionDate = '2026-07-20T00:00:00.500Z'
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({ status: 'rotated' })
  })

  it('resolves trusted-device identifiers to owner-scoped stored ids', async () => {
    const fixture = rotationFixture()
    fixture.snapshot.trustedDevices[0]!.id = `${userId}:trusted-device`
    fixture.snapshot.trustedDevices[0]!.identifier = 'trusted-device'
    fixture.request.trustedDevices[0]!.id = 'trusted-device'
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({ status: 'rotated' })

    const deviceUpdate = database.batchCalls[0]?.find((statement) =>
      statement.query.includes('encrypted_public_key ='),
    )
    expect(deviceUpdate?.values[0]).toContain(`${userId}:trusted-device`)
  })

  it('guards and clears already-revoked device keys in the same batch', async () => {
    const fixture = rotationFixture()
    fixture.snapshot.summary.revokedDeviceKeyCount = 1
    fixture.snapshot.revokedDeviceKeys.push({
      id: `${userId}:stale-device`,
      identifier: 'stale-device',
      userId,
      revokedAt: '2026-07-19T00:00:00.000Z',
      encryptedUserKey: '2.stale-user-key',
      encryptedPublicKey: '2.stale-public-key',
      encryptedPrivateKey: '2.stale-private-key',
    })
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({ status: 'rotated' })

    const currentDeviceManifest = JSON.parse(
      String(database.batchCalls[0]?.[0]?.values[3]),
    ) as { id: string; revokedAt: string | null }[]
    expect(currentDeviceManifest).toContainEqual({
      id: `${userId}:stale-device`,
      identifier: 'stale-device',
      revokedAt: '2026-07-19T00:00:00.000Z',
      encryptedUserKey: '2.stale-user-key',
      encryptedPublicKey: '2.stale-public-key',
      encryptedPrivateKey: '2.stale-private-key',
    })
  })

  it('rejects every unchanged key-dependent cipher value', async () => {
    for (const path of keyDependentCipherPaths) {
      const fixture = rotationFixture()
      const currentPayload = cipherPayload('old')
      const rotatedPayload = cipherPayload('next')
      setPath(rotatedPayload, path, readPath(currentPayload, path))
      Object.assign(rotatedPayload, {
        id: cipherId,
        encryptedFor: userId,
        lastKnownRevisionDate: oldRevisionDate,
      })
      fixture.request.ciphers[0]!.encryptedJson = JSON.stringify(rotatedPayload)
      const database = new RotationD1Database(fixture.snapshot)

      await expect(
        rotateUserKeyGeneration(database, fixture.input),
      ).resolves.toEqual({ status: 'conflict' })
      expect(database.batchCalls).toHaveLength(0)
    }
  })

  it('rejects an oversized snapshot before reading row payloads or entering batch', async () => {
    const fixture = rotationFixture()
    fixture.snapshot.summary.cipherBytes =
      userKeyRotationRepositoryPolicy.maxSnapshotCipherBytes + 1
    const database = new RotationD1Database(fixture.snapshot)

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toMatchObject({ status: 'over_budget' })
    expect(database.readQueries).toHaveLength(1)
    expect(database.batchCalls).toHaveLength(0)
  })

  it('returns conflict with zero downstream changes when the user CAS loses', async () => {
    const fixture = rotationFixture()
    const database = new RotationD1Database(fixture.snapshot, {
      mode: 'conflict',
    })

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).resolves.toEqual({ status: 'conflict' })
    expect(database.batchCalls).toHaveLength(1)
    expect(database.committed).toBe(false)
  })

  it('fails loudly if a lost user CAS reports any downstream mutation', async () => {
    const fixture = rotationFixture()
    const database = new RotationD1Database(fixture.snapshot, {
      mode: 'broken-conflict',
    })

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).rejects.toThrow('user key rotation guard invariant was violated')
  })

  it('propagates a statement failure and observes the fake transaction rollback', async () => {
    const fixture = rotationFixture()
    const database = new RotationD1Database(fixture.snapshot, {
      mode: 'throw',
    })

    await expect(
      rotateUserKeyGeneration(database, fixture.input),
    ).rejects.toThrow('synthetic D1 statement failure')
    expect(database.committed).toBe(false)
  })
})

function rotationFixture() {
  const oldCipherPayload = cipherPayload('old')
  const nextCipherPayload = cipherPayload('next')
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
        encryptedJson: JSON.stringify(nextCipherPayload),
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
        id: deviceId,
        encryptedPublicKey: '2.next-device-public-key',
        encryptedUserKey: '2.next-device-user-key',
      },
    ],
  }
  const snapshot = {
    summary: {
      id: userId,
      emailNormalized: 'person@example.test',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600_000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'old-authentication-hash',
      userKey: '2.old-wrapped-user-key',
      publicKey: 'account-public-key',
      privateKey: '2.old-wrapped-private-key',
      securityStamp: 'old-security-stamp',
      revisionDate: oldRevisionDate,
      disabledAt: null,
      activeFolderCount: 1,
      deletedFolderCount: 0,
      folderBytes: 17,
      activeCipherCount: 1,
      deletedCipherCount: 0,
      personalCipherKeyCount: 0,
      cipherBytes: JSON.stringify(oldCipherPayload).length,
      uploadedAttachmentCount: 1,
      pendingAttachmentCount: 0,
      attachmentBytes: 100,
      trustedDeviceCount: 1,
      incompleteTrustedDeviceCount: 0,
      revokedDeviceKeyCount: 0,
      trustedDeviceBytes: 100,
    },
    folders: [
      {
        id: folderId,
        userId,
        name: '2.old-folder-name',
        revisionDate: oldRevisionDate,
      },
    ],
    ciphers: [
      {
        id: cipherId,
        userId,
        folderId,
        type: 1,
        favorite: 1,
        encryptedJson: JSON.stringify(oldCipherPayload),
        revisionDate: oldRevisionDate,
      },
    ],
    attachments: [
      {
        id: attachmentId,
        userId,
        cipherId,
        objectKey: 'attachments/immutable-object-key',
        fileName: '2.old-file-name',
        attachmentKey: '2.old-attachment-key',
        size: 4096,
        contentType: 'application/octet-stream',
        revisionDate: oldRevisionDate,
      },
    ],
    trustedDevices: [
      {
        id: deviceId,
        identifier: 'trusted-device',
        userId,
        revokedAt: null,
        encryptedUserKey: '2.old-device-user-key',
        encryptedPublicKey: '2.old-device-public-key',
        encryptedPrivateKey: '2.device-private-key',
      },
    ],
    revokedDeviceKeys: [] as Array<{
      id: string
      identifier: string
      userId: string
      revokedAt: string
      encryptedUserKey: string
      encryptedPublicKey: string
      encryptedPrivateKey: string
    }>,
  }
  const input = {
    userId,
    expectedSecurityStamp: 'old-security-stamp',
    expectedRevisionDate: oldRevisionDate,
    nextSecurityStamp: 'next-security-stamp',
    nextRevisionDate,
    request,
    auditEventId: 'rotation-audit-event-id',
    auditEvent: buildAuditEvent({
      name: 'account.keys.rotate',
      outcome: 'success',
      requestId: 'rotation-request-id',
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

  return { input, request, snapshot }
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
      totp: `2.${generation}-totp`,
      passwordRevisionDate: '2026-07-01T00:00:00.000Z',
      autofillOnPageLoad: false,
      uris: [
        {
          uri: `2.${generation}-uri`,
          match: null,
          uriChecksum: `2.${generation}-uri-checksum`,
        },
      ],
      fido2Credentials: [
        {
          credentialId: `2.${generation}-credential-id`,
          keyType: `2.${generation}-key-type`,
          keyAlgorithm: `2.${generation}-key-algorithm`,
          keyCurve: `2.${generation}-key-curve`,
          keyValue: `2.${generation}-key-value`,
          rpId: `2.${generation}-rp-id`,
          rpName: `2.${generation}-rp-name`,
          counter: `2.${generation}-counter`,
          userHandle: `2.${generation}-user-handle`,
          userName: `2.${generation}-user-name`,
          userDisplayName: `2.${generation}-user-display-name`,
          discoverable: `2.${generation}-discoverable`,
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

const keyDependentCipherPaths: readonly (readonly (string | number)[])[] = [
  ['name'],
  ['notes'],
  ['key'],
  ['login', 'username'],
  ['login', 'password'],
  ['login', 'totp'],
  ['login', 'uris', 0, 'uri'],
  ['login', 'uris', 0, 'uriChecksum'],
  ['login', 'fido2Credentials', 0, 'credentialId'],
  ['login', 'fido2Credentials', 0, 'keyType'],
  ['login', 'fido2Credentials', 0, 'keyAlgorithm'],
  ['login', 'fido2Credentials', 0, 'keyCurve'],
  ['login', 'fido2Credentials', 0, 'keyValue'],
  ['login', 'fido2Credentials', 0, 'rpId'],
  ['login', 'fido2Credentials', 0, 'rpName'],
  ['login', 'fido2Credentials', 0, 'counter'],
  ['login', 'fido2Credentials', 0, 'userHandle'],
  ['login', 'fido2Credentials', 0, 'userName'],
  ['login', 'fido2Credentials', 0, 'userDisplayName'],
  ['login', 'fido2Credentials', 0, 'discoverable'],
  ['fields', 0, 'name'],
  ['fields', 0, 'value'],
  ['passwordHistory', 0, 'password'],
]

function readPath(root: unknown, path: readonly (string | number)[]): unknown {
  let current = root
  for (const segment of path) {
    if (current === null || typeof current !== 'object') {
      throw new Error(`invalid cipher fixture path: ${path.join('.')}`)
    }
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

function setPath(
  root: unknown,
  path: readonly (string | number)[],
  value: unknown,
): void {
  const parent = readPath(root, path.slice(0, -1))
  const key = path.at(-1)
  if (parent === null || typeof parent !== 'object' || key === undefined) {
    throw new Error(`invalid cipher fixture path: ${path.join('.')}`)
  }
  ;(parent as Record<string | number, unknown>)[key] = value
}

function hasCommittedGenerationGate(statement: RecordedStatement): boolean {
  return (
    statement.query.includes('FROM users') &&
    statement.query.includes('security_stamp = ?') &&
    statement.query.includes('revision_date = ?')
  )
}

type SnapshotFixture = ReturnType<typeof rotationFixture>['snapshot']
type BatchMode = 'success' | 'conflict' | 'broken-conflict' | 'throw'

type RecordedStatement = {
  query: string
  values: unknown[]
}

class RotationD1Database {
  readonly readQueries: RecordedStatement[] = []
  readonly batchCalls: RecordedStatement[][] = []
  committed = false

  constructor(
    private readonly snapshot: SnapshotFixture,
    private readonly options: { mode?: BatchMode } = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    let values: unknown[] = []
    const statement = {
      get query() {
        return query
      },
      get values() {
        return values
      },
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return statement
      },
      first: async <T = Record<string, unknown>>() => {
        this.readQueries.push({ query, values })
        return this.snapshot.summary as T
      },
      all: async <T = Record<string, unknown>>() => {
        this.readQueries.push({ query, values })
        return {
          success: true as const,
          results: this.rowsFor(query) as T[],
          meta: meta(0),
        }
      },
      run: async <T = Record<string, unknown>>() => ({
        success: true as const,
        results: [] as T[],
        meta: meta(0),
      }),
    }
    return statement as unknown as D1PreparedStatement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const recorded = (statements as unknown as RecordedStatement[]).map(
      (statement) => ({
        query: statement.query,
        values: statement.values,
      }),
    )
    this.batchCalls.push(recorded)
    const mode = this.options.mode ?? 'success'
    if (mode === 'throw') {
      this.committed = false
      throw new Error('synthetic D1 statement failure')
    }
    if (mode === 'conflict' || mode === 'broken-conflict') {
      const results = recorded.map((_, index) =>
        result<T>(index === 0 ? 0 : mode === 'broken-conflict' ? 1 : 0),
      )
      this.committed = false
      return results
    }

    const changes = [
      1,
      1,
      1,
      1,
      1,
      this.snapshot.summary.revokedDeviceKeyCount,
      2,
      2,
      2,
      1,
    ]
    const results = recorded.map((_, index) => {
      if (index === 0) {
        return {
          ...result<T>(1),
          results: [{ id: userId }] as T[],
        }
      }
      return result<T>(changes[index] ?? 0)
    })
    this.committed = true
    return results
  }

  private rowsFor(query: string): Record<string, unknown>[] {
    if (query.includes('FROM folders')) {
      return this.snapshot.folders
    }
    if (query.includes('FROM ciphers')) {
      return this.snapshot.ciphers
    }
    if (query.includes('FROM cipher_attachments')) {
      return this.snapshot.attachments
    }
    if (query.includes('FROM devices')) {
      return [
        ...this.snapshot.trustedDevices,
        ...this.snapshot.revokedDeviceKeys,
      ]
    }
    return []
  }
}

function result<T>(changes: number): D1Result<T> {
  return {
    success: true,
    results: [],
    meta: meta(changes),
  }
}

function meta(changes: number): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  }
}
