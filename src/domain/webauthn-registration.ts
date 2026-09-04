import { generateRegistrationOptions } from '@simplewebauthn/server'

import type { WebAuthnAuthenticatorResponse } from './webauthn-verifier'
import {
  resolveWebAuthnPrfState,
  webAuthnPolicy,
  type WebAuthnPrfState,
} from './webauthn'
import type { WebAuthnCredentialRecord } from '../repositories/webauthn-repository'

export const webAuthnRegistrationPolicy = {
  maxEncryptedKeyLength: 2_000,
  opaqueTokenBytes: 32,
  requestJsonMaxBytes: 64 * 1_024,
  rpName: 'HonoWarden',
} as const

export const webAuthnPrfStatusCode = {
  enabled: 0,
  supported: 1,
  unsupported: 2,
} as const

export type WebAuthnPrfStatusCode =
  (typeof webAuthnPrfStatusCode)[keyof typeof webAuthnPrfStatusCode]

export type WebAuthnEncryptedKeyTriple = {
  encryptedUserKey: string | null
  encryptedPublicKey: string | null
  encryptedPrivateKey: string | null
}

export type ParsedWebAuthnRegistrationCreateRequest = {
  deviceResponse: WebAuthnAuthenticatorResponse
  name: string
  token: string
  supportsPrf: boolean
  keys: WebAuthnEncryptedKeyTriple
}

export type WebAuthnCredentialSummary = {
  object: 'webauthnCredential'
  id: string
  name: string
  prfStatus: WebAuthnPrfStatusCode
  encryptedUserKey: string | null
  encryptedPublicKey: string | null
}

export function parseWebAuthnCredentialName(
  value: unknown,
): { ok: true; name: string } | { ok: false } {
  if (typeof value !== 'string') {
    return { ok: false }
  }

  const name = value.trim()
  if (
    name.length === 0 ||
    name.length > webAuthnPolicy.maxCredentialNameLength ||
    !isVisibleName(name)
  ) {
    return { ok: false }
  }

  return { ok: true, name }
}

export function parseWebAuthnEncryptedKeyTriple(input: {
  encryptedUserKey: unknown
  encryptedPublicKey: unknown
  encryptedPrivateKey: unknown
}):
  | { ok: true; keys: WebAuthnEncryptedKeyTriple }
  | { ok: false; code: 'partial_prf_key_set' | 'invalid_request' } {
  const encryptedUserKey = parseOptionalEncryptedKey(input.encryptedUserKey)
  const encryptedPublicKey = parseOptionalEncryptedKey(input.encryptedPublicKey)
  const encryptedPrivateKey = parseOptionalEncryptedKey(
    input.encryptedPrivateKey,
  )
  if (
    encryptedUserKey === 'invalid' ||
    encryptedPublicKey === 'invalid' ||
    encryptedPrivateKey === 'invalid'
  ) {
    return { ok: false, code: 'invalid_request' }
  }

  const prf = resolveWebAuthnPrfState({
    prfSupported: true,
    encryptedUserKey,
    encryptedPublicKey,
    encryptedPrivateKey,
  })
  if (!prf.ok) {
    return { ok: false, code: 'partial_prf_key_set' }
  }

  return {
    ok: true,
    keys: {
      encryptedUserKey,
      encryptedPublicKey,
      encryptedPrivateKey,
    },
  }
}

export function parseWebAuthnRegistrationCreateBody(
  body: unknown,
):
  | { ok: true; request: ParsedWebAuthnRegistrationCreateRequest }
  | { ok: false; code: 'invalid_request' | 'partial_prf_key_set' } {
  if (!isRecord(body)) {
    return { ok: false, code: 'invalid_request' }
  }

  const name = parseWebAuthnCredentialName(readProperty(body, 'name', 'Name'))
  const token = parseRequiredToken(readProperty(body, 'token', 'Token'))
  const supportsPrf = parseRequiredBoolean(
    readProperty(body, 'supportsPrf', 'SupportsPrf'),
  )
  const deviceResponse = parseAuthenticatorAttestationResponse(
    readProperty(body, 'deviceResponse', 'DeviceResponse'),
  )
  if (!name.ok || !token || supportsPrf === null || !deviceResponse) {
    return { ok: false, code: 'invalid_request' }
  }

  const keys = parseWebAuthnEncryptedKeyTriple({
    encryptedUserKey: readProperty(
      body,
      'encryptedUserKey',
      'EncryptedUserKey',
    ),
    encryptedPublicKey: readProperty(
      body,
      'encryptedPublicKey',
      'EncryptedPublicKey',
    ),
    encryptedPrivateKey: readProperty(
      body,
      'encryptedPrivateKey',
      'EncryptedPrivateKey',
    ),
  })
  if (!keys.ok) {
    return keys
  }

  const prf = resolveWebAuthnPrfState({
    prfSupported: supportsPrf,
    ...keys.keys,
  })
  if (!prf.ok) {
    return { ok: false, code: 'partial_prf_key_set' }
  }

  return {
    ok: true,
    request: {
      deviceResponse,
      name: name.name,
      token,
      supportsPrf,
      keys: keys.keys,
    },
  }
}

export function webAuthnUserIdBytes(accountId: string): Uint8Array {
  const hex = accountId.trim().replaceAll('-', '')
  if (/^[0-9a-f]{32}$/i.test(hex)) {
    const bytes = new Uint8Array(16)
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    }
    return bytes
  }

  return new TextEncoder().encode(accountId)
}

export function encodeWebAuthnUserHandle(accountId: string): string {
  return base64UrlEncode(webAuthnUserIdBytes(accountId))
}

export function generateWebAuthnOpaqueToken(): string {
  return base64UrlEncode(
    crypto.getRandomValues(
      new Uint8Array(webAuthnRegistrationPolicy.opaqueTokenBytes),
    ),
  )
}

export function encodeWebAuthnPublicKey(publicKey: Uint8Array): string {
  return base64UrlEncode(publicKey)
}

export function readWebAuthnClientDataChallenge(
  clientDataJson: string,
): string | null {
  const decoded = decodeBase64UrlToString(clientDataJson)
  if (!decoded) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(decoded)
    if (!isRecord(parsed) || typeof parsed.challenge !== 'string') {
      return null
    }

    const challenge = parsed.challenge.trim()
    return challenge.length > 0 ? challenge : null
  } catch {
    return null
  }
}

export async function buildWebAuthnRegistrationOptions(input: {
  accountId: string
  email: string
  displayName: string | null
  rpId: string
  existingCredentials: readonly Pick<
    WebAuthnCredentialRecord,
    'credentialId' | 'transports'
  >[]
}): Promise<{
  challenge: string
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>
}> {
  const options = await generateRegistrationOptions({
    rpName: webAuthnRegistrationPolicy.rpName,
    rpID: input.rpId,
    userName: input.email,
    userID: Uint8Array.from(webAuthnUserIdBytes(input.accountId)),
    userDisplayName: input.displayName ?? '',
    timeout: webAuthnPolicy.registrationChallengeTtlSeconds * 1_000,
    attestationType: 'none',
    excludeCredentials: input.existingCredentials.map((credential) => ({
      id: credential.credentialId,
      ...(credential.transports.length > 0
        ? {
            transports: [...credential.transports] as Array<
              'ble' | 'hybrid' | 'internal' | 'nfc' | 'usb'
            >,
          }
        : {}),
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    extensions: {},
  })

  return { challenge: options.challenge, options }
}

export function webAuthnPrfStatusCodeFor(
  state: WebAuthnPrfState,
): WebAuthnPrfStatusCode {
  return webAuthnPrfStatusCode[state]
}

export function buildWebAuthnCredentialSummary(
  credential: WebAuthnCredentialRecord,
): WebAuthnCredentialSummary | null {
  const prf = resolveWebAuthnPrfState(credential)
  if (!prf.ok) {
    return null
  }

  return {
    object: 'webauthnCredential',
    id: credential.id,
    name: credential.name,
    prfStatus: webAuthnPrfStatusCodeFor(prf.state),
    encryptedUserKey: credential.encryptedUserKey,
    encryptedPublicKey: credential.encryptedPublicKey,
  }
}

export function buildWebAuthnCredentialListResponse(
  credentials: readonly WebAuthnCredentialRecord[],
): {
  object: 'list'
  data: WebAuthnCredentialSummary[]
  continuationToken: null
} {
  return {
    object: 'list',
    data: credentials.flatMap((credential) => {
      const summary = buildWebAuthnCredentialSummary(credential)
      return summary ? [summary] : []
    }),
    continuationToken: null,
  }
}

function parseAuthenticatorAttestationResponse(
  value: unknown,
): WebAuthnAuthenticatorResponse | null {
  if (!isRecord(value)) {
    return null
  }

  const id = parseRequiredToken(readProperty(value, 'id', 'Id'))
  const rawId = parseRequiredToken(readProperty(value, 'rawId', 'RawId')) ?? id
  const type = readProperty(value, 'type', 'Type')
  const response = readProperty(value, 'response', 'Response')
  if (!id || !rawId || type !== 'public-key' || !isRecord(response)) {
    return null
  }

  const attestationObject = parseRequiredToken(
    readProperty(response, 'attestationObject', 'AttestationObject'),
  )
  const clientDataJSON = parseRequiredToken(
    readProperty(
      response,
      'clientDataJSON',
      'clientDataJson',
      'ClientDataJSON',
    ),
  )
  if (!attestationObject || !clientDataJSON) {
    return null
  }

  return {
    id,
    rawId,
    type: 'public-key',
    response: {
      attestationObject,
      clientDataJSON,
    },
  }
}

function parseOptionalEncryptedKey(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string') {
    return 'invalid'
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.length > webAuthnRegistrationPolicy.maxEncryptedKeyLength) {
    return 'invalid'
  }

  return trimmed
}

function parseRequiredToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseRequiredBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readProperty(
  record: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key]
    }
  }

  return undefined
}

function isVisibleName(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit < 0x20 || codeUnit === 0x7f) {
      return false
    }
  }

  return true
}

function decodeBase64UrlToString(value: string): string | null {
  const bytes = decodeBase64Url(value)
  if (!bytes) {
    return null
  }

  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      bytes,
    )
  } catch {
    return null
  }
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length === 0) {
    return null
  }

  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (padded.length % 4)) % 4
  try {
    const binary = atob(`${padded}${'='.repeat(padLength)}`)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
