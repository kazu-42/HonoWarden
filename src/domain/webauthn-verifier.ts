import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'

import { evaluateWebAuthnSignCount } from './webauthn'

export type WebAuthnAuthenticatorResponse = {
  id: string
  rawId: string
  type: 'public-key'
  response: Record<string, unknown>
  clientExtensionResults?: Record<string, unknown>
}

export type WebAuthnRegistrationVerification =
  | {
      ok: true
      aaguid: string
      backupEligible: boolean
      backupState: boolean
      credentialId: string
      credentialType: 'public-key'
      discoverable: true
      publicKey: Uint8Array
      signCount: number
      transports: readonly string[]
    }
  | { ok: false; code: 'verification_failed' }

export type WebAuthnAuthenticationVerification =
  | {
      ok: true
      backupEligible: boolean
      backupState: boolean
      credentialId: string
      newSignCount: number
      userHandle: string | null
    }
  | { ok: false; code: 'verification_failed' | 'counter_regression' }

export async function verifyWebAuthnRegistrationResponse(input: {
  response: WebAuthnAuthenticatorResponse
  expectedChallenge: string
  expectedOrigin: string | readonly string[]
  expectedRpId: string
}): Promise<WebAuthnRegistrationVerification> {
  try {
    const verification = await verifyRegistrationResponse({
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: mutableOrigins(input.expectedOrigin),
      expectedRPID: input.expectedRpId,
      requireUserVerification: true,
      response: stripClientExtensions(
        input.response,
      ) as unknown as RegistrationResponseJSON,
    })
    if (!verification.verified || !verification.registrationInfo.userVerified) {
      return { ok: false, code: 'verification_failed' }
    }

    const { registrationInfo } = verification
    return {
      ok: true,
      aaguid: registrationInfo.aaguid,
      backupEligible: registrationInfo.credentialDeviceType === 'multiDevice',
      backupState: registrationInfo.credentialBackedUp,
      credentialId: registrationInfo.credential.id,
      credentialType: 'public-key',
      discoverable: true,
      publicKey: registrationInfo.credential.publicKey,
      signCount: registrationInfo.credential.counter,
      transports: registrationInfo.credential.transports ?? [],
    }
  } catch {
    return { ok: false, code: 'verification_failed' }
  }
}

export async function verifyWebAuthnAuthenticationResponse(input: {
  response: WebAuthnAuthenticatorResponse
  expectedChallenge: string
  expectedOrigin: string | readonly string[]
  expectedRpId: string
  credential: {
    id: string
    publicKey: Uint8Array
    signCount: number
    transports?: readonly string[]
  }
}): Promise<WebAuthnAuthenticationVerification> {
  try {
    const verification = await verifyAuthenticationResponse({
      credential: {
        id: input.credential.id,
        publicKey: new Uint8Array(input.credential.publicKey),
        counter: input.credential.signCount,
        ...(input.credential.transports
          ? {
              transports: [
                ...input.credential.transports,
              ] as AuthenticatorTransportFuture[],
            }
          : {}),
      },
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: mutableOrigins(input.expectedOrigin),
      expectedRPID: input.expectedRpId,
      requireUserVerification: true,
      response: stripClientExtensions(
        input.response,
      ) as unknown as AuthenticationResponseJSON,
    })
    if (
      !verification.verified ||
      !verification.authenticationInfo.userVerified
    ) {
      return { ok: false, code: 'verification_failed' }
    }

    const counter = evaluateWebAuthnSignCount({
      storedSignCount: input.credential.signCount,
      reportedSignCount: verification.authenticationInfo.newCounter,
    })
    if (!counter.ok) {
      return counter
    }

    const userHandle = input.response.response.userHandle
    return {
      ok: true,
      backupEligible:
        verification.authenticationInfo.credentialDeviceType === 'multiDevice',
      backupState: verification.authenticationInfo.credentialBackedUp,
      credentialId: input.credential.id,
      newSignCount: counter.nextSignCount,
      userHandle: typeof userHandle === 'string' ? userHandle : null,
    }
  } catch {
    return { ok: false, code: 'verification_failed' }
  }
}

function stripClientExtensions(
  response: WebAuthnAuthenticatorResponse,
): WebAuthnAuthenticatorResponse {
  return {
    id: response.id,
    rawId: response.rawId,
    type: 'public-key',
    response: response.response,
    clientExtensionResults: {},
  }
}

function mutableOrigins(origin: string | readonly string[]): string | string[] {
  return typeof origin === 'string' ? origin : [...origin]
}
