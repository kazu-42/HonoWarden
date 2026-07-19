export const accountKeyPolicy = {
  publicKeyMaxLength: 32_768,
  wrappedPrivateKeyMaxLength: 32_768,
} as const

export type AccountKeyPair = {
  publicKey: string
  wrappedPrivateKey: string
}

export type AccountKeyState =
  | { status: 'missing' }
  | { status: 'complete'; keyPair: AccountKeyPair }
  | { status: 'invalid' }

export type AccountKeyInitializationParseResult =
  { ok: true; keyPair: AccountKeyPair } | { ok: false }

type StoredAccountKeys = {
  publicKey: string | null
  privateKey: string | null
}

const requestFields = new Set([
  'publicKey',
  'PublicKey',
  'encryptedPrivateKey',
  'EncryptedPrivateKey',
])

export function isAccountKeyInitializationEnabled(
  value: string | undefined,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function parseAccountKeyInitializationBody(
  body: unknown,
): AccountKeyInitializationParseResult {
  if (
    !isPlainObject(body) ||
    Object.keys(body).some((field) => !requestFields.has(field))
  ) {
    return { ok: false }
  }

  const publicKey = parseAliasedOpaqueString(
    body,
    ['publicKey', 'PublicKey'],
    accountKeyPolicy.publicKeyMaxLength,
  )
  const wrappedPrivateKey = parseAliasedOpaqueString(
    body,
    ['encryptedPrivateKey', 'EncryptedPrivateKey'],
    accountKeyPolicy.wrappedPrivateKeyMaxLength,
  )
  if (!publicKey || !wrappedPrivateKey) {
    return { ok: false }
  }

  return {
    ok: true,
    keyPair: { publicKey, wrappedPrivateKey },
  }
}

export function classifyAccountKeyState(
  keys: StoredAccountKeys,
): AccountKeyState {
  if (keys.publicKey === null && keys.privateKey === null) {
    return { status: 'missing' }
  }

  const publicKey = parseOpaqueString(
    keys.publicKey,
    accountKeyPolicy.publicKeyMaxLength,
  )
  const wrappedPrivateKey = parseOpaqueString(
    keys.privateKey,
    accountKeyPolicy.wrappedPrivateKeyMaxLength,
  )
  if (!publicKey || !wrappedPrivateKey) {
    return { status: 'invalid' }
  }

  return {
    status: 'complete',
    keyPair: { publicKey, wrappedPrivateKey },
  }
}

export function accountKeyPairsEqual(
  left: AccountKeyPair,
  right: AccountKeyPair,
): boolean {
  const publicKeysEqual = constantTimeEqual(left.publicKey, right.publicKey)
  const privateKeysEqual = constantTimeEqual(
    left.wrappedPrivateKey,
    right.wrappedPrivateKey,
  )
  return publicKeysEqual && privateKeysEqual
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseAliasedOpaqueString(
  object: Record<string, unknown>,
  names: readonly string[],
  maxLength: number,
): string | null {
  const values = names
    .map((name) => object[name])
    .filter((value) => value !== undefined)
  if (
    values.length === 0 ||
    values.some((value) => !Object.is(value, values[0]))
  ) {
    return null
  }

  return parseOpaqueString(values[0], maxLength)
}

function parseOpaqueString(value: unknown, maxLength: number): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    [...value].some(isControlCharacter)
  ) {
    return null
  }

  return value
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let difference = left.length ^ right.length

  for (let index = 0; index < maxLength; index += 1) {
    difference |= charCodeAt(left, index) ^ charCodeAt(right, index)
  }

  return difference === 0
}

function charCodeAt(value: string, index: number): number {
  return index < value.length ? value.charCodeAt(index) : 0
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127
}
