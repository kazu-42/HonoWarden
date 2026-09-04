import { describe, expect, it } from 'vitest'

import {
  buildWebAuthnCredentialListResponse,
  buildWebAuthnRegistrationOptions,
  encodeWebAuthnUserHandle,
  parseWebAuthnCredentialName,
  parseWebAuthnEncryptedKeyTriple,
  parseWebAuthnRegistrationCreateBody,
  readWebAuthnClientDataChallenge,
  webAuthnPrfStatusCode,
  webAuthnUserIdBytes,
} from '../../src/domain/webauthn-registration'
import type { WebAuthnCredentialRecord } from '../../src/repositories/webauthn-repository'

const encryptedTriple = {
  encryptedUserKey: '2.encrypted-user-key',
  encryptedPublicKey: '2.encrypted-public-key',
  encryptedPrivateKey: '2.encrypted-private-key',
}

describe('WebAuthn registration contract helpers', () => {
  it('accepts a bounded name and rejects empty or oversized names', () => {
    expect(parseWebAuthnCredentialName(' Laptop ')).toEqual({
      ok: true,
      name: 'Laptop',
    })
    expect(parseWebAuthnCredentialName('')).toEqual({ ok: false })
    expect(parseWebAuthnCredentialName('a'.repeat(65))).toEqual({ ok: false })
    expect(parseWebAuthnCredentialName('bad\nname')).toEqual({ ok: false })
  })

  it('rejects partial encrypted PRF key triples', () => {
    expect(
      parseWebAuthnEncryptedKeyTriple({
        encryptedUserKey: encryptedTriple.encryptedUserKey,
        encryptedPublicKey: encryptedTriple.encryptedPublicKey,
        encryptedPrivateKey: null,
      }),
    ).toEqual({ ok: false, code: 'partial_prf_key_set' })
    expect(
      parseWebAuthnEncryptedKeyTriple({
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
      }),
    ).toEqual({
      ok: true,
      keys: {
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
      },
    })
  })

  it('parses official create envelopes and ignores PRF extension output', () => {
    const parsed = parseWebAuthnRegistrationCreateBody({
      deviceResponse: {
        id: 'credential-id',
        rawId: 'credential-id',
        type: 'public-key',
        response: {
          attestationObject: 'attestation-object',
          clientDataJson: 'client-data',
        },
        clientExtensionResults: {
          prf: { results: { first: 'client-prf-output' } },
        },
      },
      name: 'Laptop',
      token: 'opaque-route-token',
      supportsPrf: true,
      ...encryptedTriple,
    })

    expect(parsed).toEqual({
      ok: true,
      request: {
        deviceResponse: {
          id: 'credential-id',
          rawId: 'credential-id',
          type: 'public-key',
          response: {
            attestationObject: 'attestation-object',
            clientDataJSON: 'client-data',
          },
        },
        name: 'Laptop',
        token: 'opaque-route-token',
        supportsPrf: true,
        keys: encryptedTriple,
      },
    })
    expect(JSON.stringify(parsed)).not.toContain('client-prf-output')
  })

  it('encodes account UUID bytes as the WebAuthn user id', () => {
    expect([
      ...webAuthnUserIdBytes('11111111-1111-4111-8111-111111111111'),
    ]).toEqual([
      0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x41, 0x11, 0x81, 0x11, 0x11, 0x11,
      0x11, 0x11, 0x11, 0x11,
    ])
    expect(encodeWebAuthnUserHandle('user-id')).toBe('dXNlci1pZA')
  })

  it('reads the clientDataJSON challenge without logging authenticator bytes', () => {
    const challenge = 'Y2hhbGxlbmdl'
    const clientDataJSON = encodeClientData({
      type: 'webauthn.create',
      challenge,
      origin: 'https://vault.example.com',
    })

    expect(readWebAuthnClientDataChallenge(clientDataJSON)).toBe(challenge)
    expect(readWebAuthnClientDataChallenge('@@@@')).toBeNull()
  })

  it('builds resident-key registration options with an exclude list and no attestation', async () => {
    const built = await buildWebAuthnRegistrationOptions({
      accountId: '11111111-1111-4111-8111-111111111111',
      email: 'person@example.test',
      displayName: 'Person',
      rpId: 'example.com',
      existingCredentials: [
        { credentialId: 'existing-credential', transports: ['internal'] },
      ],
    })

    expect(built.options.rp).toEqual({ name: 'HonoWarden', id: 'example.com' })
    expect(built.options.user.name).toBe('person@example.test')
    expect(built.options.attestation).toBe('none')
    expect(built.options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    })
    expect(built.options.timeout).toBe(7 * 60 * 1000)
    expect(built.options.excludeCredentials).toEqual([
      expect.objectContaining({
        id: 'existing-credential',
        transports: ['internal'],
      }),
    ])
    expect(built.options.extensions).not.toHaveProperty('prf')
    expect(built.challenge.length).toBeGreaterThan(0)
    expect(built.options.challenge).toBe(built.challenge)
  })

  it('lists only owner-safe credential summaries and PRF status codes', () => {
    const listed = buildWebAuthnCredentialListResponse([
      credentialRecord({
        id: 'row-enabled',
        name: 'Enabled',
        prfSupported: true,
        ...encryptedTriple,
      }),
      credentialRecord({
        id: 'row-supported',
        name: 'Supported',
        prfSupported: true,
      }),
      credentialRecord({
        id: 'row-unsupported',
        name: 'Unsupported',
        prfSupported: false,
      }),
    ])

    expect(listed).toEqual({
      object: 'list',
      continuationToken: null,
      data: [
        {
          object: 'webauthnCredential',
          id: 'row-enabled',
          name: 'Enabled',
          prfStatus: webAuthnPrfStatusCode.enabled,
          encryptedUserKey: encryptedTriple.encryptedUserKey,
          encryptedPublicKey: encryptedTriple.encryptedPublicKey,
        },
        {
          object: 'webauthnCredential',
          id: 'row-supported',
          name: 'Supported',
          prfStatus: webAuthnPrfStatusCode.supported,
          encryptedUserKey: null,
          encryptedPublicKey: null,
        },
        {
          object: 'webauthnCredential',
          id: 'row-unsupported',
          name: 'Unsupported',
          prfStatus: webAuthnPrfStatusCode.unsupported,
          encryptedUserKey: null,
          encryptedPublicKey: null,
        },
      ],
    })
    expect(JSON.stringify(listed)).not.toContain('public-key-bytes')
    expect(JSON.stringify(listed)).not.toContain('credential-id')
    expect(JSON.stringify(listed)).not.toContain('aaguid')
    expect(JSON.stringify(listed)).not.toContain('user-handle')
  })
})

function encodeClientData(value: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function credentialRecord(
  overrides: Partial<WebAuthnCredentialRecord> &
    Pick<WebAuthnCredentialRecord, 'id' | 'name'>,
): WebAuthnCredentialRecord {
  return {
    userId: 'user-1',
    credentialId: `credential-${overrides.id}`,
    publicKey: 'public-key-bytes',
    userHandle: 'user-handle',
    signCount: 0,
    credentialType: 'public-key',
    transports: ['internal'],
    aaguid: '00000000-0000-0000-0000-000000000000',
    discoverable: true,
    backupEligible: true,
    backupState: false,
    prfSupported: false,
    encryptedUserKey: null,
    encryptedPublicKey: null,
    encryptedPrivateKey: null,
    createdAt: '2026-07-06T00:00:00.000Z',
    revisionDate: '2026-07-06T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  }
}
