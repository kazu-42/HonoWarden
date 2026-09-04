import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyAuthenticationResponse, verifyRegistrationResponse } = vi.hoisted(
  () => ({
    verifyAuthenticationResponse: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
  }),
)

vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
}))

import {
  verifyWebAuthnAuthenticationResponse,
  verifyWebAuthnRegistrationResponse,
} from '../../src/domain/webauthn-verifier'

const registrationResponse = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'client-data',
    attestationObject: 'attestation-object',
  },
  clientExtensionResults: {
    prf: { results: { first: 'client-prf-output' } },
  },
}

const assertionResponse = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key' as const,
  response: {
    authenticatorData: 'authenticator-data',
    clientDataJSON: 'client-data',
    signature: 'signature',
    userHandle: 'user-handle',
  },
  clientExtensionResults: {
    prf: { results: { first: 'client-prf-output' } },
  },
}

const publicKey = new Uint8Array([1, 2, 3, 4])

describe('WebAuthn verifier core', () => {
  beforeEach(() => {
    verifyRegistrationResponse.mockReset()
    verifyAuthenticationResponse.mockReset()
  })

  it('pins SimpleWebAuthn verification with required UV and ignores PRF output', async () => {
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'credential-id',
          publicKey,
          counter: 0,
          transports: ['internal'],
        },
        aaguid: '00000000-0000-0000-0000-000000000000',
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        userVerified: true,
        credentialType: 'public-key',
      },
    })

    await expect(
      verifyWebAuthnRegistrationResponse({
        expectedChallenge: 'challenge',
        expectedOrigin: ['https://vault.example.com'],
        expectedRpId: 'example.com',
        response: registrationResponse,
      }),
    ).resolves.toEqual({
      ok: true,
      aaguid: '00000000-0000-0000-0000-000000000000',
      backupEligible: true,
      backupState: true,
      credentialId: 'credential-id',
      credentialType: 'public-key',
      discoverable: true,
      publicKey,
      signCount: 0,
      transports: ['internal'],
    })

    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'challenge',
        expectedOrigin: ['https://vault.example.com'],
        expectedRPID: 'example.com',
        requireUserVerification: true,
        response: {
          id: 'credential-id',
          rawId: 'credential-id',
          type: 'public-key',
          response: registrationResponse.response,
          clientExtensionResults: {},
        },
      }),
    )
  })

  it('maps failed library verification without exposing authenticator payloads', async () => {
    verifyAuthenticationResponse.mockRejectedValue(
      new Error('clientDataJSON mismatch for authenticator-data'),
    )

    const result = await verifyWebAuthnAuthenticationResponse({
      credential: {
        id: 'credential-id',
        publicKey,
        signCount: 4,
        transports: ['internal'],
      },
      expectedChallenge: 'challenge',
      expectedOrigin: 'https://vault.example.com',
      expectedRpId: 'example.com',
      response: assertionResponse,
    })

    expect(result).toEqual({ ok: false, code: 'verification_failed' })
    expect(JSON.stringify(result)).not.toContain('authenticator-data')
    expect(JSON.stringify(result)).not.toContain('client-prf-output')
  })

  it('rejects positive counter regressions after a verified assertion', async () => {
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 3,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        userVerified: true,
      },
    })

    await expect(
      verifyWebAuthnAuthenticationResponse({
        credential: {
          id: 'credential-id',
          publicKey,
          signCount: 9,
          transports: ['usb'],
        },
        expectedChallenge: 'challenge',
        expectedOrigin: 'https://vault.example.com',
        expectedRpId: 'example.com',
        response: assertionResponse,
      }),
    ).resolves.toEqual({ ok: false, code: 'counter_regression' })
  })

  it('keeps a valid zero counter and records verified backup state', async () => {
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 0,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        userVerified: true,
      },
    })

    await expect(
      verifyWebAuthnAuthenticationResponse({
        credential: {
          id: 'credential-id',
          publicKey,
          signCount: 0,
          transports: ['hybrid'],
        },
        expectedChallenge: 'challenge',
        expectedOrigin: 'https://vault.example.com',
        expectedRpId: 'example.com',
        response: assertionResponse,
      }),
    ).resolves.toEqual({
      ok: true,
      backupEligible: true,
      backupState: true,
      credentialId: 'credential-id',
      newSignCount: 0,
      userHandle: 'user-handle',
    })
  })
})
