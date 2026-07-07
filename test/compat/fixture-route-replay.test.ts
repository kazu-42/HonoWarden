import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { runCompatFixture } from './fixture-replay-support'

const fixturesRoot = fileURLToPath(
  new URL('../../compat/fixtures', import.meta.url).toString(),
)

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
    path: 'accounts/profile-success.json',
  },
  {
    path: 'accounts/revision-date-success.json',
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
    path: 'devices/known-device-success.json',
    database: {
      authUsers: [deviceReplayUser],
      devices: deviceRows,
    },
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
] as const

describe('compatibility fixture route replay', () => {
  for (const fixture of replayFixtures) {
    it(`replays ${fixture.path} against the app`, async () => {
      const replayOptions = {
        ...('database' in fixture ? { database: fixture.database } : {}),
        ...('allowMutatingFixtures' in fixture
          ? { allowMutatingFixtures: fixture.allowMutatingFixtures }
          : {}),
      }
      const result = await runCompatFixture(
        fixturePath(fixture.path),
        replayOptions,
      )

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
