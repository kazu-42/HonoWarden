import { describe, expect, it } from 'vitest'

import {
  isUserKeyRotationEnabled,
  matchesUserKeyRotationCredentialGeneration,
  parseUserKeyRotationBody,
  userKeyRotationPolicy,
} from '../../src/domain/user-key-rotation'

const userId = '11111111-1111-4111-8111-111111111111'
const folderId = '22222222-2222-4222-8222-222222222222'
const cipherId = '33333333-3333-4333-8333-333333333333'
const attachmentId = '44444444-4444-4444-8444-444444444444'
const deviceId = '55555555-5555-4555-8555-555555555555'
const revisionDate = '2026-07-20T00:00:00.000Z'

describe('user-key rotation domain', () => {
  it('keeps user-key rotation disabled unless the rollout flag is exact true', () => {
    expect(isUserKeyRotationEnabled(undefined)).toBe(false)
    expect(isUserKeyRotationEnabled('')).toBe(false)
    expect(isUserKeyRotationEnabled(' TRUE ')).toBe(true)
    expect(isUserKeyRotationEnabled('yes')).toBe(false)
    expect(isUserKeyRotationEnabled('true')).toBe(true)
  })

  it('parses the pinned V1 account, vault, attachment, and device envelope', () => {
    const body = rotationBody()

    expect(parseUserKeyRotationBody(body)).toEqual({
      ok: true,
      oldMasterKeyAuthenticationHash: 'synthetic-current-auth-hash',
      nextMasterKeyAuthenticationHash: 'synthetic-next-auth-hash',
      nextUserKey: '2.synthetic-next-wrapped-user-key',
      credentialMetadata: {
        salt: 'person@example.test',
        kdf: {
          kdfType: 0,
          iterations: 600000,
          memory: null,
          parallelism: null,
        },
      },
      accountKeys: {
        publicKey: 'synthetic-account-public-key',
        wrappedPrivateKey: '2.synthetic-next-wrapped-private-key',
      },
      folders: [
        {
          id: folderId,
          name: '2.synthetic-next-folder-name',
        },
      ],
      ciphers: [
        {
          id: cipherId,
          encryptedFor: userId,
          organizationId: null,
          folderId,
          type: 1,
          favorite: false,
          reprompt: 0,
          archivedDate: null,
          lastKnownRevisionDate: revisionDate,
          metadata: {
            login: {
              passwordRevisionDate: '2026-07-17T00:00:00.000Z',
              autofillOnPageLoad: true,
              uriMatches: [2],
              fido2CreationDates: ['2026-07-18T00:00:00.000Z'],
            },
            secureNoteType: null,
            fields: [{ type: 1, linkedId: null }],
            passwordHistoryDates: ['2026-07-19T00:00:00.000Z'],
          },
          encryptedJson: JSON.stringify(body.accountData.ciphers[0]),
          attachments: [
            {
              id: attachmentId,
              fileName: '2.synthetic-next-file-name',
              attachmentKey: '2.synthetic-next-attachment-key',
              lastKnownRevisionDate: revisionDate,
            },
          ],
        },
      ],
      trustedDevices: [
        {
          id: deviceId,
          encryptedPublicKey: '2.synthetic-next-device-public-key',
          encryptedUserKey: '2.synthetic-next-device-user-key',
        },
      ],
    })
  })

  it('accepts exact camel/Pascal aliases and rejects conflicting aliases', () => {
    const body = rotationBody()

    expect(
      parseUserKeyRotationBody({
        ...body,
        OldMasterKeyAuthenticationHash: body.oldMasterKeyAuthenticationHash,
        AccountKeys: structuredClone(body.accountKeys),
      }),
    ).toMatchObject({ ok: true })

    expect(
      parseUserKeyRotationBody({
        ...body,
        OldMasterKeyAuthenticationHash: 'different-current-auth-hash',
      }),
    ).toEqual({ ok: false })
    expect(
      parseUserKeyRotationBody({
        ...body,
        AccountKeys: {
          ...body.accountKeys,
          accountPublicKey: 'different-public-key',
        },
      }),
    ).toEqual({ ok: false })
  })

  it('rejects malformed, partial, and unknown envelope fields', () => {
    const body = rotationBody()

    for (const candidate of [
      null,
      [],
      {},
      { ...body, accountData: undefined },
      { ...body, unexpected: true },
      {
        ...body,
        accountUnlockData: {
          ...body.accountUnlockData,
          unsupported: null,
        },
      },
      {
        ...body,
        accountData: { ...body.accountData, unexpected: [] },
      },
    ]) {
      expect(parseUserKeyRotationBody(candidate)).toEqual({ ok: false })
    }
  })

  it('rejects every unsupported product and V2 key surface before mutation', () => {
    const body = rotationBody()

    for (const accountUnlockData of [
      { ...body.accountUnlockData, emergencyAccessUnlockData: [{}] },
      {
        ...body.accountUnlockData,
        organizationAccountRecoveryUnlockData: [{}],
      },
      { ...body.accountUnlockData, passkeyUnlockData: [{}] },
      { ...body.accountUnlockData, v2UpgradeToken: {} },
    ]) {
      expect(parseUserKeyRotationBody({ ...body, accountUnlockData })).toEqual({
        ok: false,
      })
    }

    expect(
      parseUserKeyRotationBody({
        ...body,
        accountData: { ...body.accountData, sends: [{}] },
      }),
    ).toEqual({ ok: false })
    expect(
      parseUserKeyRotationBody({
        ...body,
        accountKeys: { ...body.accountKeys, signatureKeyPair: {} },
      }),
    ).toEqual({ ok: false })
    expect(
      parseUserKeyRotationBody({
        ...body,
        accountKeys: { ...body.accountKeys, securityState: {} },
      }),
    ).toEqual({ ok: false })
    expect(
      parseUserKeyRotationBody({
        ...body,
        accountKeys: {
          ...body.accountKeys,
          publicKeyEncryptionKeyPair: {
            ...body.accountKeys.publicKeyEncryptionKeyPair,
            signedPublicKey: 'synthetic-v2-signature',
          },
        },
      }),
    ).toEqual({ ok: false })
  })

  it('requires the legacy and structured V1 account keys to agree exactly', () => {
    const body = rotationBody()

    for (const accountKeys of [
      { ...body.accountKeys, accountPublicKey: 'different-public-key' },
      {
        ...body.accountKeys,
        userKeyEncryptedAccountPrivateKey: '2.different-private-key',
      },
      { ...body.accountKeys, publicKeyEncryptionKeyPair: null },
    ]) {
      expect(parseUserKeyRotationBody({ ...body, accountKeys })).toEqual({
        ok: false,
      })
    }
  })

  it('rejects hints, KDF drift inside the envelope, and invalid salt forms', () => {
    const body = rotationBody()
    const master = body.accountUnlockData.masterPasswordUnlockData

    for (const masterPasswordUnlockData of [
      { ...master, masterPasswordHint: 'unsupported hint' },
      { ...master, masterPasswordSalt: 'different@example.test' },
      { ...master, kdfMemory: 64 },
      { ...master, kdfIterations: 1 },
      { ...master, kdfType: 2 },
      { ...master, email: ' padded@example.test ' },
    ]) {
      expect(
        parseUserKeyRotationBody({
          ...body,
          accountUnlockData: {
            ...body.accountUnlockData,
            masterPasswordUnlockData,
          },
        }),
      ).toEqual({ ok: false })
    }
  })

  it('accepts the same canonical email salts as bootstrap and authentication', () => {
    const body = rotationBody()
    const master = body.accountUnlockData.masterPasswordUnlockData
    const parsed = parseUserKeyRotationBody({
      ...body,
      accountUnlockData: {
        ...body.accountUnlockData,
        masterPasswordUnlockData: {
          ...master,
          email: 'person@localhost',
        },
      },
    })

    expect(parsed).toMatchObject({
      ok: true,
      credentialMetadata: { salt: 'person@localhost' },
    })
    expect(
      parsed.ok &&
        matchesUserKeyRotationCredentialGeneration(parsed, {
          emailNormalized: 'person@localhost',
          kdfAlgorithm: 'pbkdf2-sha256',
          kdfIterations: 600000,
          kdfMemory: null,
          kdfParallelism: null,
          userKey: '2.synthetic-current-wrapped-user-key',
          publicKey: 'synthetic-account-public-key',
          privateKey: '2.synthetic-current-wrapped-private-key',
        }),
    ).toBe(true)
  })

  it('accepts a bounded Argon2id generation and an empty personal vault', () => {
    const body = rotationBody()
    const master = body.accountUnlockData.masterPasswordUnlockData

    expect(
      parseUserKeyRotationBody({
        ...body,
        accountUnlockData: {
          ...body.accountUnlockData,
          masterPasswordUnlockData: {
            ...master,
            kdfType: 1,
            kdfIterations: 6,
            kdfMemory: 64,
            kdfParallelism: 4,
          },
          deviceKeyUnlockData: [],
        },
        accountData: {
          ciphers: [],
          folders: [],
          sends: [],
        },
      }),
    ).toMatchObject({
      ok: true,
      credentialMetadata: {
        kdf: {
          kdfType: 1,
          iterations: 6,
          memory: 64,
          parallelism: 4,
        },
      },
      folders: [],
      ciphers: [],
      trustedDevices: [],
    })
  })

  it('parses the supported secure-note cipher shape', () => {
    const body = rotationBody()
    const cipher = body.accountData.ciphers[0]!
    const secureNote = {
      ...cipher,
      type: 2,
      login: undefined,
      secureNote: { type: 0 },
    }

    expect(
      parseUserKeyRotationBody({
        ...body,
        accountData: { ...body.accountData, ciphers: [secureNote] },
      }),
    ).toMatchObject({
      ok: true,
      ciphers: [
        {
          id: cipherId,
          type: 2,
          metadata: { login: null, secureNoteType: 0 },
        },
      ],
    })
  })

  it('matches only an unchanged stored KDF/public key and a new wrapped generation', () => {
    const parsed = parseUserKeyRotationBody(rotationBody())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      throw new Error('rotation fixture must parse')
    }

    const generation = {
      emailNormalized: 'person@example.test',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      userKey: '2.synthetic-current-wrapped-user-key',
      publicKey: 'synthetic-account-public-key',
      privateKey: '2.synthetic-current-wrapped-private-key',
    }

    expect(matchesUserKeyRotationCredentialGeneration(parsed, generation)).toBe(
      true,
    )
    expect(
      matchesUserKeyRotationCredentialGeneration(parsed, {
        ...generation,
        kdfIterations: 600001,
      }),
    ).toBe(false)
    expect(
      matchesUserKeyRotationCredentialGeneration(parsed, {
        ...generation,
        publicKey: 'different-public-key',
      }),
    ).toBe(false)
    expect(
      matchesUserKeyRotationCredentialGeneration(parsed, {
        ...generation,
        userKey: parsed.nextUserKey,
      }),
    ).toBe(false)
    expect(
      matchesUserKeyRotationCredentialGeneration(parsed, {
        ...generation,
        userKey: ' invalid-current-user-key ',
      }),
    ).toBe(false)
    expect(
      matchesUserKeyRotationCredentialGeneration(parsed, {
        ...generation,
        privateKey: parsed.accountKeys.wrappedPrivateKey,
      }),
    ).toBe(false)
    expect(
      matchesUserKeyRotationCredentialGeneration(parsed, {
        ...generation,
        privateKey: null,
      }),
    ).toBe(false)
    expect(
      matchesUserKeyRotationCredentialGeneration(
        {
          ...parsed,
          nextUserKey: generation.privateKey,
          accountKeys: {
            ...parsed.accountKeys,
            wrappedPrivateKey: generation.userKey,
          },
        },
        generation,
      ),
    ).toBe(false)
    expect(
      matchesUserKeyRotationCredentialGeneration(
        {
          ...parsed,
          nextUserKey: parsed.accountKeys.wrappedPrivateKey,
        },
        generation,
      ),
    ).toBe(false)
  })

  it('rejects duplicate, foreign, and malformed record identities', () => {
    const body = rotationBody()
    const cipher = body.accountData.ciphers[0]!
    const folder = body.accountData.folders[0]
    const device = body.accountUnlockData.deviceKeyUnlockData[0]

    for (const candidate of [
      {
        ...body,
        accountData: {
          ...body.accountData,
          folders: [folder, structuredClone(folder)],
        },
      },
      {
        ...body,
        accountData: {
          ...body.accountData,
          ciphers: [cipher, structuredClone(cipher)],
        },
      },
      {
        ...body,
        accountUnlockData: {
          ...body.accountUnlockData,
          deviceKeyUnlockData: [device, structuredClone(device)],
        },
      },
      {
        ...body,
        accountData: {
          ...body.accountData,
          ciphers: [{ ...cipher, folderId: deviceId }],
        },
      },
      {
        ...body,
        accountData: {
          ...body.accountData,
          ciphers: [{ ...cipher, id: 'not-a-uuid' }],
        },
      },
    ]) {
      expect(parseUserKeyRotationBody(candidate)).toEqual({ ok: false })
    }
  })

  it('accepts HonoWarden composite trusted-device ids', () => {
    const body = rotationBody()
    const device = body.accountUnlockData.deviceKeyUnlockData[0]!
    const compositeDeviceId = `${userId}:${deviceId}`

    expect(
      parseUserKeyRotationBody({
        ...body,
        accountUnlockData: {
          ...body.accountUnlockData,
          deviceKeyUnlockData: [{ ...device, deviceId: compositeDeviceId }],
        },
      }),
    ).toMatchObject({
      ok: true,
      trustedDevices: [{ id: compositeDeviceId }],
    })
  })

  it('rejects organization-owned, unsupported-type, and unknown cipher data', () => {
    const body = rotationBody()
    const cipher = body.accountData.ciphers[0]!

    for (const rotatedCipher of [
      { ...cipher, organizationId: userId },
      { ...cipher, type: 3 },
      { ...cipher, unexpected: '2.synthetic-ciphertext' },
      {
        ...cipher,
        login: { ...cipher.login, unexpected: '2.synthetic-ciphertext' },
      },
      { ...cipher, encryptedFor: 'not-a-uuid' },
    ]) {
      expect(
        parseUserKeyRotationBody({
          ...body,
          accountData: { ...body.accountData, ciphers: [rotatedCipher] },
        }),
      ).toEqual({ ok: false })
    }
  })

  it('requires exact attachment membership, metadata, and observable revision', () => {
    const body = rotationBody()
    const cipher = body.accountData.ciphers[0]!
    const attachment = cipher.attachments2[attachmentId]!

    for (const rotatedCipher of [
      { ...cipher, attachments: {} },
      { ...cipher, attachments2: {} },
      {
        ...cipher,
        attachments: { [attachmentId]: '2.different-file-name' },
      },
      {
        ...cipher,
        attachments2: {
          [attachmentId]: {
            ...attachment,
            lastKnownRevisionDate: '2026-07-20T00:00:01.000Z',
          },
        },
      },
      {
        ...cipher,
        attachments2: {
          [attachmentId]: { ...attachment, key: undefined },
        },
      },
      { ...cipher, lastKnownRevisionDate: 'not-a-date' },
    ]) {
      expect(
        parseUserKeyRotationBody({
          ...body,
          accountData: { ...body.accountData, ciphers: [rotatedCipher] },
        }),
      ).toEqual({ ok: false })
    }
  })

  it('enforces opaque-value and collection bounds before producing a manifest', () => {
    const body = rotationBody()
    const master = body.accountUnlockData.masterPasswordUnlockData
    const cipher = body.accountData.ciphers[0]

    expect(
      parseUserKeyRotationBody({
        ...body,
        oldMasterKeyAuthenticationHash: 'h'.repeat(
          userKeyRotationPolicy.authenticationHashMaxLength + 1,
        ),
      }),
    ).toEqual({ ok: false })
    expect(
      parseUserKeyRotationBody({
        ...body,
        accountUnlockData: {
          ...body.accountUnlockData,
          masterPasswordUnlockData: {
            ...master,
            masterKeyEncryptedUserKey: 'k'.repeat(
              userKeyRotationPolicy.wrappedUserKeyMaxLength + 1,
            ),
          },
        },
      }),
    ).toEqual({ ok: false })
    expect(
      parseUserKeyRotationBody({
        ...body,
        accountData: {
          ...body.accountData,
          ciphers: Array.from(
            { length: userKeyRotationPolicy.ciphersMax + 1 },
            () => cipher,
          ),
        },
      }),
    ).toEqual({ ok: false })
  })
})

function rotationBody() {
  return {
    oldMasterKeyAuthenticationHash: 'synthetic-current-auth-hash',
    accountUnlockData: {
      masterPasswordUnlockData: {
        kdfType: 0,
        kdfIterations: 600000,
        email: 'person@example.test',
        masterKeyAuthenticationHash: 'synthetic-next-auth-hash',
        masterKeyEncryptedUserKey: '2.synthetic-next-wrapped-user-key',
      },
      emergencyAccessUnlockData: [],
      organizationAccountRecoveryUnlockData: [],
      passkeyUnlockData: [],
      deviceKeyUnlockData: [
        {
          deviceId,
          encryptedPublicKey: '2.synthetic-next-device-public-key',
          encryptedUserKey: '2.synthetic-next-device-user-key',
        },
      ],
    },
    accountKeys: {
      userKeyEncryptedAccountPrivateKey: '2.synthetic-next-wrapped-private-key',
      accountPublicKey: 'synthetic-account-public-key',
      publicKeyEncryptionKeyPair: {
        wrappedPrivateKey: '2.synthetic-next-wrapped-private-key',
        publicKey: 'synthetic-account-public-key',
        signedPublicKey: null,
      },
      signatureKeyPair: null,
      securityState: null,
    },
    accountData: {
      ciphers: [
        {
          id: cipherId,
          encryptedFor: userId,
          type: 1,
          folderId,
          organizationId: null,
          name: '2.synthetic-next-cipher-name',
          notes: null,
          favorite: false,
          login: {
            uris: [
              {
                uri: '2.synthetic-next-uri',
                match: 2,
                uriChecksum: '2.synthetic-next-uri-checksum',
              },
            ],
            username: '2.synthetic-next-username',
            password: '2.synthetic-next-password',
            passwordRevisionDate: '2026-07-17T00:00:00.000Z',
            totp: null,
            autofillOnPageLoad: true,
            fido2Credentials: [
              {
                credentialId: '2.synthetic-next-credential-id',
                creationDate: '2026-07-18T00:00:00.000Z',
              },
            ],
          },
          fields: [
            {
              type: 1,
              name: '2.synthetic-next-field-name',
              value: '2.synthetic-next-field-value',
              linkedId: null,
            },
          ],
          passwordHistory: [
            {
              lastUsedDate: '2026-07-19T00:00:00.000Z',
              password: '2.synthetic-next-history-password',
            },
          ],
          attachments: {
            [attachmentId]: '2.synthetic-next-file-name',
          },
          attachments2: {
            [attachmentId]: {
              fileName: '2.synthetic-next-file-name',
              key: '2.synthetic-next-attachment-key',
              lastKnownRevisionDate: revisionDate,
            },
          },
          lastKnownRevisionDate: revisionDate,
          archivedDate: null,
          reprompt: 0,
          key: null,
        },
      ],
      folders: [{ id: folderId, name: '2.synthetic-next-folder-name' }],
      sends: [],
    },
  }
}
