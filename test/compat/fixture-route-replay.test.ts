import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { hashRefreshToken } from '../../src/domain/tokens'
import { encryptTotpSecret } from '../../src/domain/totp-secret'
import { runCompatFixture } from './fixture-replay-support'

const fixturesRoot = fileURLToPath(
  new URL('../../compat/fixtures', import.meta.url).toString(),
)
const fixtureFlowsPath = fileURLToPath(
  new URL('../../compat/fixture-flows.json', import.meta.url).toString(),
)

type FixtureFlowManifest = {
  schemaVersion: number
  flows: {
    id: string
    fixtures: string[]
  }[]
}

const replayUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'Person@Example.Test',
  emailNormalized: 'person@example.test',
  displayName: 'Fixture User',
  kdfAlgorithm: 'pbkdf2-sha256' as const,
  kdfIterations: 600000,
  kdfMemory: null,
  kdfParallelism: null,
  masterPasswordHash: 'synthetic-master-password-hash',
  userKey: '2.c3ludGhldGljLXVzZXIta2V5',
  publicKey: 'synthetic-public-key',
  privateKey: '2.synthetic-private-key',
  securityStamp: 'fixture-security-stamp',
  revisionDate: '2026-07-06T00:00:00.000Z',
  createdAt: '2026-07-06T00:00:00.000Z',
  disabledAt: null,
  loginFailedCount: 0,
  loginFailedAt: null,
  loginLockedUntil: null,
  totpEnabled: false,
  totpEncryptedSecret: null,
  totpLastAcceptedStep: null,
}

const deviceReplayUser = {
  ...replayUser,
  id: 'user-id',
}

const totpReplayEncryptedSecret = await encryptTotpSecret(
  'fixture-token-secret',
  'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
)

const totpReplayUser = {
  ...replayUser,
  totpEnabled: true,
  totpEncryptedSecret: totpReplayEncryptedSecret,
}

const totpLoginReplayTime = new Date('1970-05-06T05:26:30.000Z')
const sessionRevokeReplayTime = new Date('1970-01-01T00:02:00.000Z')
const totpReplayChallengeHash = await hashRefreshToken(
  'fixture-token-secret',
  'totp:synthetic-two-factor-token',
)
const totpLoginChallenge = {
  id: 'totp-challenge-id',
  userId: replayUser.id,
  challengeHash: totpReplayChallengeHash,
  deviceIdentifier: 'fixture-device',
  expiresAt: '1970-05-06T05:31:30.000Z',
  consumedAt: null,
  createdAt: '1970-05-06T05:21:30.000Z',
}

const deviceRows = [
  {
    id: 'user-id:fixture-device',
    userId: deviceReplayUser.id,
    identifier: 'fixture-device',
    name: 'CLI',
    type: 8,
    lastSeenAt: '2026-07-06T00:10:00.000Z',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:10:00.000Z',
  },
]

const refreshSession = {
  tokenId: 'refresh-token-id',
  userId: replayUser.id,
  deviceId: `${replayUser.id}:fixture-device`,
  deviceIdentifier: 'fixture-device',
  tokenExpiresAt: '2999-08-05T00:00:00.000Z',
  tokenRevokedAt: null,
  deviceRevokedAt: null,
  email: replayUser.email,
  emailNormalized: replayUser.emailNormalized,
  displayName: replayUser.displayName,
  kdfAlgorithm: replayUser.kdfAlgorithm,
  kdfIterations: replayUser.kdfIterations,
  kdfMemory: replayUser.kdfMemory,
  kdfParallelism: replayUser.kdfParallelism,
  masterPasswordHash: replayUser.masterPasswordHash,
  userKey: replayUser.userKey,
  publicKey: replayUser.publicKey,
  privateKey: replayUser.privateKey,
  securityStamp: replayUser.securityStamp,
  revisionDate: replayUser.revisionDate,
  createdAt: replayUser.createdAt,
  disabledAt: replayUser.disabledAt,
  loginFailedCount: replayUser.loginFailedCount,
  loginFailedAt: replayUser.loginFailedAt,
  loginLockedUntil: replayUser.loginLockedUntil,
  totpEnabled: replayUser.totpEnabled,
  totpEncryptedSecret: replayUser.totpEncryptedSecret,
  totpLastAcceptedStep: replayUser.totpLastAcceptedStep,
}

const folderRows = [
  {
    id: 'folder-id',
    userId: replayUser.id,
    name: '2.encrypted-folder-name',
    revisionDate: '2026-07-06T00:03:00.000Z',
  },
]

const cipherRows = [
  {
    id: 'cipher-id',
    userId: replayUser.id,
    folderId: 'folder-id',
    type: 1,
    favorite: true,
    encryptedJson: JSON.stringify({
      type: 1,
      folderId: 'folder-id',
      favorite: true,
      name: '2.encrypted-cipher-name',
      notes: null,
      login: {
        username: '2.encrypted-username',
        password: '2.encrypted-password',
        uris: [],
      },
    }),
    revisionDate: '2026-07-06T00:05:00.000Z',
    createdAt: '2026-07-06T00:04:00.000Z',
  },
]

const attachmentRows = [
  {
    id: 'attachment-id',
    userId: replayUser.id,
    cipherId: 'cipher-id',
    objectKey: 'attachments/00000000-0000-4000-8000-0000000000a1',
    fileName: '2.encrypted-file-name',
    attachmentKey: '2.encrypted-attachment-key',
    size: 15,
    contentType: 'application/octet-stream',
    revisionDate: '2026-07-10T00:00:00.000Z',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  },
]

const replayFixtures = [
  {
    path: 'config/server-config-success.json',
  },
  {
    path: 'prelogin/pbkdf2.json',
  },
  {
    path: 'token/password-grant-success.json',
    allowMutatingFixtures: true,
  },
  {
    path: 'token/refresh-grant-success.json',
    allowMutatingFixtures: true,
    database: {
      refreshSession,
      refreshRotationChanges: 1,
    },
  },
  {
    path: 'token/totp-challenge.json',
    allowMutatingFixtures: true,
    database: {
      authUser: totpReplayUser,
    },
  },
  {
    path: 'token/totp-login-success.json',
    allowMutatingFixtures: true,
    systemTime: totpLoginReplayTime,
    database: {
      authUser: totpReplayUser,
      totpChallenge: totpLoginChallenge,
      totpChallengeUpdateChanges: 1,
    },
  },
  {
    path: 'sync/empty-personal-vault.json',
  },
  {
    path: 'sync/with-folder-and-cipher.json',
    database: {
      authUser: {
        ...replayUser,
        totpEnabled: true,
      },
      folders: folderRows,
      ciphers: cipherRows,
    },
  },
  {
    path: 'sync/with-attachment.json',
    database: {
      authUser: {
        ...replayUser,
        totpEnabled: true,
      },
      folders: folderRows,
      ciphers: cipherRows,
      attachments: attachmentRows,
    },
  },
  {
    path: 'accounts/profile-success.json',
  },
  {
    path: 'accounts/profile-update-success.json',
    allowMutatingFixtures: true,
    systemTime: new Date('2026-07-09T10:30:00.000Z'),
    database: {
      authUser: replayUser,
      userUpdateChanges: 1,
    },
  },
  {
    path: 'accounts/revision-date-success.json',
  },
  {
    path: 'accounts/verify-password-success.json',
    allowMutatingFixtures: true,
    database: {
      authUser: { ...replayUser },
    },
  },
  {
    path: 'accounts/password-change-success.json',
    allowMutatingFixtures: true,
    systemTime: new Date('2026-07-19T00:00:00.000Z'),
    database: {
      authUser: { ...replayUser },
    },
  },
  {
    path: 'accounts/keys-read-success.json',
    accountKeysEnabled: 'true',
  },
  {
    path: 'accounts/keys-initialize-success.json',
    accountKeysEnabled: 'true',
    allowMutatingFixtures: true,
    database: {
      authUser: {
        ...replayUser,
        publicKey: null,
        privateKey: null,
      },
    },
  },
  {
    path: 'metadata/policies-list-success.json',
  },
  {
    path: 'metadata/policies-new-list-success.json',
  },
  {
    path: 'metadata/domains-success.json',
  },
  {
    path: 'metadata/settings-domains-success.json',
  },
  {
    path: 'metadata/collections-list-success.json',
  },
  {
    path: 'metadata/collection-get-not-found.json',
  },
  {
    path: 'devices/list-success.json',
    database: {
      authUser: deviceReplayUser,
      devices: deviceRows,
    },
  },
  {
    path: 'devices/identifier-success.json',
    database: {
      authUser: deviceReplayUser,
      devices: deviceRows,
    },
  },
  {
    path: 'devices/update-success.json',
    allowMutatingFixtures: true,
    systemTime: new Date('2026-07-07T18:06:30.000Z'),
    database: {
      authUser: deviceReplayUser,
      devices: deviceRows,
      deviceUpdateChanges: 1,
    },
  },
  {
    path: 'devices/keys-update-success.json',
    allowMutatingFixtures: true,
    systemTime: new Date('2026-07-07T18:06:30.000Z'),
    database: {
      authUser: deviceReplayUser,
      devices: deviceRows,
      deviceUpdateChanges: 1,
    },
  },
  {
    path: 'devices/bulk-update-trust-success.json',
    allowMutatingFixtures: true,
    systemTime: new Date('2026-07-07T18:06:30.000Z'),
    database: {
      authUser: deviceReplayUser,
      devices: deviceRows,
      deviceUpdateChanges: 1,
    },
  },
  {
    path: 'devices/known-device-success.json',
    database: {
      authUsers: [deviceReplayUser],
      devices: deviceRows,
    },
  },
  {
    path: 'devices/revoke-success.json',
    allowMutatingFixtures: true,
    database: {
      authUser: deviceReplayUser,
      deviceRevokeChanges: 1,
    },
  },
  {
    path: 'devices/revoke-all-success.json',
    allowMutatingFixtures: true,
    systemTime: sessionRevokeReplayTime,
    tokenIssuedAt: 60,
    tokenExpiresAt: 3600,
  },
  {
    path: 'folders/list-success.json',
    database: {
      folders: folderRows,
    },
  },
  {
    path: 'folders/get-success.json',
    database: {
      folders: folderRows,
    },
  },
  {
    path: 'folders/create-success.json',
    allowMutatingFixtures: true,
  },
  {
    path: 'folders/update-success.json',
    allowMutatingFixtures: true,
    database: {
      folderUpdateChanges: 1,
    },
  },
  {
    path: 'folders/delete-success.json',
    allowMutatingFixtures: true,
    database: {
      folderDeleteChanges: 1,
    },
  },
  {
    path: 'ciphers/list-success.json',
    database: {
      ciphers: cipherRows,
    },
  },
  {
    path: 'ciphers/get-login-success.json',
    database: {
      ciphers: cipherRows,
    },
  },
  {
    path: 'ciphers/create-login-success.json',
    allowMutatingFixtures: true,
    database: {
      folders: folderRows,
      cipherInsertChanges: 1,
    },
  },
  {
    path: 'ciphers/update-login-success.json',
    allowMutatingFixtures: true,
    database: {
      folders: folderRows,
      ciphers: cipherRows,
      cipherUpdateChanges: 1,
    },
  },
  {
    path: 'ciphers/trash-success.json',
    allowMutatingFixtures: true,
    database: {
      cipherSoftDeleteChanges: 1,
    },
  },
  {
    path: 'ciphers/restore-success.json',
    allowMutatingFixtures: true,
    database: {
      cipherRestoreChanges: 1,
    },
  },
  {
    path: 'ciphers/delete-success.json',
    allowMutatingFixtures: true,
    database: {
      ciphers: cipherRows,
      cipherPermanentDeleteChanges: 1,
    },
  },
  {
    path: 'errors/revision-conflict.json',
    allowMutatingFixtures: true,
    database: {
      ciphers: cipherRows,
      cipherUpdateChanges: 0,
    },
  },
] as const

describe('compatibility fixture route replay', () => {
  it('covers every fixture file exactly once', () => {
    const fixturePaths = listFixturePaths(fixturesRoot)
    const replayPaths = replayFixturePaths()

    expect(
      duplicatePaths(replayPaths),
      'duplicate replay fixture paths',
    ).toEqual([])
    expect(
      replayPaths.filter((path) => !fixturePaths.includes(path)),
      'replay entries without fixture files',
    ).toEqual([])
    expect(
      fixturePaths.filter((path) => !replayPaths.includes(path)),
      'fixture files without route replay',
    ).toEqual([])
  })

  it('keeps route replay aligned with the fixture-flow manifest', () => {
    expect(readFixtureFlowPaths()).toEqual(replayFixturePaths())
  })

  for (const fixture of replayFixtures) {
    it(`replays ${fixture.path} against the app`, async () => {
      const replayOptions = {
        ...('database' in fixture ? { database: fixture.database } : {}),
        ...('allowMutatingFixtures' in fixture
          ? { allowMutatingFixtures: fixture.allowMutatingFixtures }
          : {}),
        ...('tokenIssuedAt' in fixture
          ? { tokenIssuedAt: fixture.tokenIssuedAt }
          : {}),
        ...('tokenExpiresAt' in fixture
          ? { tokenExpiresAt: fixture.tokenExpiresAt }
          : {}),
        ...('accountKeysEnabled' in fixture
          ? { accountKeysEnabled: fixture.accountKeysEnabled }
          : {}),
      }
      const runFixture = () =>
        runCompatFixture(fixturePath(fixture.path), replayOptions)
      const result =
        'systemTime' in fixture
          ? await withSystemTime(fixture.systemTime, runFixture)
          : await runFixture()

      expect(result.response.status).toBe(result.fixture.response.status)
    })
  }

  it('keeps mutating fixtures outside stateless replay by default', async () => {
    await expect(
      runCompatFixture(fixturePath('folders/create-success.json')),
    ).rejects.toThrow('Refusing to run mutating fixture')
  })
})

function fixturePath(path: string): string {
  return join(fixturesRoot, path)
}

function listFixturePaths(root: string, current = root): string[] {
  const paths = readdirSync(current, { withFileTypes: true }).flatMap(
    (entry) => {
      const absolutePath = join(current, entry.name)

      if (entry.isDirectory()) {
        return listFixturePaths(root, absolutePath)
      }

      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        return []
      }

      return [relative(root, absolutePath).split(sep).join('/')]
    },
  )

  return paths.sort()
}

function replayFixturePaths(): string[] {
  return replayFixtures.map((fixture) => fixture.path).sort()
}

function readFixtureFlowPaths(): string[] {
  const manifest = JSON.parse(
    readFileSync(fixtureFlowsPath, 'utf8'),
  ) as FixtureFlowManifest

  return [...new Set(manifest.flows.flatMap((flow) => flow.fixtures))].sort()
}

function duplicatePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const path of paths) {
    if (seen.has(path)) {
      duplicates.add(path)
      continue
    }

    seen.add(path)
  }

  return [...duplicates].sort()
}

async function withSystemTime<T>(
  systemTime: Date,
  run: () => Promise<T>,
): Promise<T> {
  vi.useFakeTimers()
  vi.setSystemTime(systemTime)

  try {
    return await run()
  } finally {
    vi.useRealTimers()
  }
}
