import type { AccountLifecycleDelivery } from './account-lifecycle-mailer'
import {
  accountLifecycleTokenExpiresAt,
  parseAccountDeletionRecoveryBody,
} from './domain/account-lifecycle'

export type AccountMailEnvelope = {
  version: 1
  keyId: string
  iv: string
  ciphertext: string
}
export type OpenAccountMail =
  | { status: 'decoded'; delivery: AccountLifecycleDelivery; queuedAt: string }
  | { status: 'invalid' | 'unknown_key' | 'unreadable' }
export type AccountMailCodec = {
  seal(delivery: unknown, now: number): Promise<AccountMailEnvelope>
  open(envelope: unknown): Promise<OpenAccountMail>
}

const blockBytes = 2048
const encoder = new TextEncoder()
const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/
const tokenPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export function createAccountMailCodec(options: {
  activeKeyId: string
  keysJson: string
}): AccountMailCodec {
  const keys = readKeys(options)
  const activeKeyId = options.activeKeyId
  const aad = (keyId: string) =>
    encoder.encode(`honowarden:account-lifecycle-mail:v1:${keyId}`)
  const importKey = (keyId: string, usage: 'encrypt' | 'decrypt') =>
    crypto.subtle.importKey('raw', keys.get(keyId)!, 'AES-GCM', false, [usage])
  return {
    async seal(value, now) {
      const delivery = parseAccountMailDelivery(value)
      if (
        !delivery ||
        !Number.isFinite(now) ||
        Date.parse(delivery.expiresAt) <= now ||
        Date.parse(delivery.expiresAt) >
          Date.parse(
            accountLifecycleTokenExpiresAt(
              delivery.purpose,
              new Date(now).toISOString(),
            ),
          )
      ) {
        throw new Error('Account lifecycle mail request is invalid.')
      }
      const payload = encoder.encode(
        JSON.stringify({ delivery, queuedAt: new Date(now).toISOString() }),
      )
      if (payload.byteLength > blockBytes - 2)
        throw new Error('Account lifecycle mail request is invalid.')
      const plaintext = crypto.getRandomValues(new Uint8Array(blockBytes))
      new DataView(plaintext.buffer).setUint16(0, payload.byteLength)
      plaintext.set(payload, 2)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      try {
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: aad(activeKeyId) },
          await importKey(activeKeyId, 'encrypt'),
          plaintext,
        )
        return {
          version: 1,
          keyId: activeKeyId,
          iv: encode(iv),
          ciphertext: encode(new Uint8Array(ciphertext)),
        }
      } finally {
        plaintext.fill(0)
        payload.fill(0)
      }
    },
    async open(value) {
      if (
        !objectWithFields(value, ['version', 'keyId', 'iv', 'ciphertext']) ||
        value.version !== 1 ||
        typeof value.keyId !== 'string' ||
        !keyIdPattern.test(value.keyId) ||
        typeof value.iv !== 'string' ||
        !/^[A-Za-z0-9_-]{16}$/.test(value.iv) ||
        typeof value.ciphertext !== 'string' ||
        !/^[A-Za-z0-9_-]{2752}$/.test(value.ciphertext)
      )
        return { status: 'invalid' }
      if (!keys.has(value.keyId)) return { status: 'unknown_key' }
      let plaintext: Uint8Array
      try {
        plaintext = new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: decode(value.iv),
              additionalData: aad(value.keyId),
            },
            await importKey(value.keyId, 'decrypt'),
            decode(value.ciphertext),
          ),
        )
      } catch {
        return { status: 'unreadable' }
      }
      try {
        if (plaintext.byteLength !== blockBytes) return { status: 'invalid' }
        const length = new DataView(plaintext.buffer).getUint16(0)
        if (length < 1 || length > blockBytes - 2) return { status: 'invalid' }
        const payload: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
            plaintext.subarray(2, length + 2),
          ),
        )
        if (
          !objectWithFields(payload, ['delivery', 'queuedAt']) ||
          !canonicalTimestamp(payload.queuedAt)
        )
          return { status: 'invalid' }
        const delivery = parseAccountMailDelivery(payload.delivery)
        if (
          !delivery ||
          Date.parse(delivery.expiresAt) <= Date.parse(payload.queuedAt) ||
          Date.parse(delivery.expiresAt) >
            Date.parse(
              accountLifecycleTokenExpiresAt(
                delivery.purpose,
                payload.queuedAt,
              ),
            )
        )
          return { status: 'invalid' }
        return { status: 'decoded', delivery, queuedAt: payload.queuedAt }
      } catch {
        return { status: 'invalid' }
      } finally {
        plaintext.fill(0)
      }
    },
  }
}

export function parseAccountMailDelivery(
  value: unknown,
): AccountLifecycleDelivery | null {
  if (
    !objectWithFields(value, [
      'disposition',
      'purpose',
      'recipientEmail',
      'token',
      'userId',
      'expiresAt',
    ])
  )
    return null
  const { disposition, purpose, recipientEmail, token, userId, expiresAt } =
    value
  if (
    (disposition !== 'deliver' && disposition !== 'suppress') ||
    (purpose !== 'email_verify' &&
      purpose !== 'email_change' &&
      purpose !== 'account_delete') ||
    typeof recipientEmail !== 'string' ||
    !parseAccountDeletionRecoveryBody({ email: recipientEmail }).ok ||
    [...recipientEmail].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ) ||
    encoder.encode(recipientEmail).byteLength > 254 ||
    typeof token !== 'string' ||
    !tokenPattern.test(token) ||
    typeof userId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
    !canonicalTimestamp(expiresAt)
  )
    return null
  return { disposition, purpose, recipientEmail, token, userId, expiresAt }
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 24 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
function objectWithFields(
  value: unknown,
  fields: string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  )
}
function readKeys(options: {
  activeKeyId: string
  keysJson: string
}): Map<string, Uint8Array> {
  try {
    if (
      !keyIdPattern.test(options.activeKeyId) ||
      options.keysJson.length > 512
    )
      throw new Error()
    const parsed: unknown = JSON.parse(options.keysJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error()
    const entries = Object.entries(parsed)
    if (entries.length < 1 || entries.length > 3) throw new Error()
    const keys = new Map<string, Uint8Array>()
    for (const [keyId, material] of entries) {
      if (
        !keyIdPattern.test(keyId) ||
        typeof material !== 'string' ||
        !tokenPattern.test(material)
      )
        throw new Error()
      const decoded = decode(material)
      if (decoded.byteLength !== 32 || encode(decoded) !== material)
        throw new Error()
      keys.set(keyId, decoded)
    }
    if (!keys.has(options.activeKeyId)) throw new Error()
    return keys
  } catch {
    throw new Error(
      'Account lifecycle mail encryption configuration is invalid.',
    )
  }
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(
      value
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '='),
    ),
    (character) => character.charCodeAt(0),
  )
}
