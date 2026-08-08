import { normalizeEmail } from './prelogin'

export function isAccountLifecycleEnabled(value: string | undefined): boolean {
  return value === 'true'
}

export type AccountLifecycleTokenPurpose =
  'account_delete' | 'email_change' | 'email_verify'

type AccountLifecycleTokenDigestInput = {
  secret: string
  token: string
  purpose: AccountLifecycleTokenPurpose
  userId: string
  generation: string
}

type AccountLifecycleTokenInput = Omit<
  AccountLifecycleTokenDigestInput,
  'token'
> & {
  randomBytes?: (bytes: Uint8Array) => Uint8Array
}

export type AccountLifecycleToken = {
  token: string
  digest: string
}

export type AccountEmailTokenRequest = {
  ok: true
  newEmail: string
  newEmailNormalized: string
  currentMasterPasswordHash: string
}

export type AccountEmailChangeRequest = AccountEmailTokenRequest & {
  nextMasterPasswordHash: string
  token: string
  nextUserKey: string
}

export type AccountLifecycleTokenConfirmation = {
  ok: true
  userId: string
  token: string
}

export type AccountDeletionRecoveryRequest = {
  ok: true
  email: string
  emailNormalized: string
}

type InvalidAccountLifecycleRequest = { ok: false }

const accountLifecyclePolicy = {
  authenticationHashMaxLength: 4096,
  emailMaxLength: 256,
  tokenLength: 43,
  userIdMaxLength: 128,
  wrappedUserKeyMaxLength: 16_384,
} as const

const accountLifecycleTokenTtlMilliseconds: Record<
  AccountLifecycleTokenPurpose,
  number
> = {
  account_delete: 15 * 60 * 1000,
  email_change: 15 * 60 * 1000,
  email_verify: 24 * 60 * 60 * 1000,
}

export function accountLifecycleTokenExpiresAt(
  purpose: AccountLifecycleTokenPurpose,
  now: string,
): string {
  const timestamp = Date.parse(now)
  if (!Number.isFinite(timestamp)) {
    throw new Error('Account lifecycle token timestamp is invalid.')
  }
  return new Date(
    timestamp + accountLifecycleTokenTtlMilliseconds[purpose],
  ).toISOString()
}

export function accountDeletionRecoverUntil(now: string): string {
  const timestamp = Date.parse(now)
  if (!Number.isFinite(timestamp)) {
    throw new Error('Account deletion timestamp is invalid.')
  }
  return new Date(timestamp + 30 * 24 * 60 * 60 * 1000).toISOString()
}

const tokenDigestDomain = 'honowarden:account-lifecycle-token:v1'

export function requireAccountLifecycleTokenSecret(
  secret: string | undefined,
): string {
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('Account lifecycle token secret must be at least 32 bytes.')
  }
  return secret
}

export async function createAccountLifecycleToken(
  input: AccountLifecycleTokenInput,
): Promise<AccountLifecycleToken> {
  const secret = requireAccountLifecycleTokenSecret(input.secret)
  const bytes = new Uint8Array(32)
  const filled = input.randomBytes
    ? input.randomBytes(bytes)
    : crypto.getRandomValues(bytes)
  if (filled !== bytes || filled.byteLength !== 32) {
    throw new Error('Account lifecycle token entropy source is invalid.')
  }

  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
  const digest = await digestAccountLifecycleToken({ ...input, secret, token })

  return { token, digest }
}

export function parseAccountEmailTokenBody(
  body: unknown,
): AccountEmailTokenRequest | InvalidAccountLifecycleRequest {
  if (!isPlainObject(body) || hasUnsupportedCredentialProof(body)) {
    return { ok: false }
  }
  const newEmail = readAliasedBoundedString(body, ['newEmail', 'NewEmail'], 256)
  const currentMasterPasswordHash = readAliasedBoundedString(
    body,
    ['masterPasswordHash', 'MasterPasswordHash'],
    accountLifecyclePolicy.authenticationHashMaxLength,
  )
  const newEmailNormalized = newEmail ? strictNormalizeEmail(newEmail) : null
  if (!newEmail || !newEmailNormalized || !currentMasterPasswordHash) {
    return { ok: false }
  }
  return {
    ok: true,
    newEmail,
    newEmailNormalized,
    currentMasterPasswordHash,
  }
}

export function parseAccountEmailChangeBody(
  body: unknown,
): AccountEmailChangeRequest | InvalidAccountLifecycleRequest {
  const base = parseAccountEmailTokenBody(body)
  if (!base.ok || !isPlainObject(body)) {
    return { ok: false }
  }
  const nextMasterPasswordHash = readAliasedBoundedString(
    body,
    ['newMasterPasswordHash', 'NewMasterPasswordHash'],
    accountLifecyclePolicy.authenticationHashMaxLength,
  )
  const token = readAliasedBoundedString(
    body,
    ['token', 'Token'],
    accountLifecyclePolicy.tokenLength,
  )
  const nextUserKey = readAliasedBoundedString(
    body,
    ['key', 'Key'],
    accountLifecyclePolicy.wrappedUserKeyMaxLength,
  )
  if (
    !nextMasterPasswordHash ||
    !token ||
    token.length !== accountLifecyclePolicy.tokenLength ||
    !/^[A-Za-z0-9_-]+$/u.test(token) ||
    !nextUserKey
  ) {
    return { ok: false }
  }
  return { ...base, nextMasterPasswordHash, token, nextUserKey }
}

export function parseAccountLifecycleTokenConfirmationBody(
  body: unknown,
): AccountLifecycleTokenConfirmation | InvalidAccountLifecycleRequest {
  if (!isPlainObject(body)) {
    return { ok: false }
  }
  const userId = readAliasedBoundedString(
    body,
    ['userId', 'UserId'],
    accountLifecyclePolicy.userIdMaxLength,
  )
  const token = readAliasedBoundedString(
    body,
    ['token', 'Token'],
    accountLifecyclePolicy.tokenLength,
  )
  if (
    !userId ||
    !token ||
    token.length !== accountLifecyclePolicy.tokenLength ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  ) {
    return { ok: false }
  }
  return { ok: true, userId, token }
}

export function parseAccountDeletionRecoveryBody(
  body: unknown,
): AccountDeletionRecoveryRequest | InvalidAccountLifecycleRequest {
  if (!isPlainObject(body)) {
    return { ok: false }
  }
  const email = readAliasedBoundedString(
    body,
    ['email', 'Email'],
    accountLifecyclePolicy.emailMaxLength,
  )
  const emailNormalized = email ? strictNormalizeEmail(email) : null
  if (!email || !emailNormalized) {
    return { ok: false }
  }
  return { ok: true, email, emailNormalized }
}

export async function digestAccountLifecycleToken(
  input: AccountLifecycleTokenDigestInput,
): Promise<string> {
  const secret = requireAccountLifecycleTokenSecret(input.secret)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = [
    tokenDigestDomain,
    input.purpose,
    input.userId,
    input.generation,
    input.token,
  ].join('\0')
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(message))

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function strictNormalizeEmail(value: string): string | null {
  const normalized = normalizeEmail(value)
  if (
    !normalized ||
    value.length > accountLifecyclePolicy.emailMaxLength ||
    value.trim() !== value ||
    /\s/u.test(value) ||
    !/^[^@]+@[^@]+$/u.test(value)
  ) {
    return null
  }
  return normalized
}

function hasUnsupportedCredentialProof(body: Record<string, unknown>): boolean {
  return [
    'otp',
    'OTP',
    'Otp',
    'authRequestAccessCode',
    'AuthRequestAccessCode',
  ].some((name) => body[name] !== undefined)
}

function readAliasedBoundedString(
  body: Record<string, unknown>,
  names: readonly string[],
  maxLength: number,
): string | null {
  const values = names
    .map((name) => body[name])
    .filter((value) => value !== undefined)
  if (
    values.length === 0 ||
    values.some((value) => !Object.is(value, values[0])) ||
    typeof values[0] !== 'string' ||
    values[0].length === 0 ||
    values[0].length > maxLength ||
    values[0].trim() !== values[0] ||
    [...values[0]].some(isControlCharacter)
  ) {
    return null
  }
  return values[0]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127
}
