import { normalizeEmail } from './prelogin'

export type PasswordGrantRequest = {
  username: string
  usernameNormalized: string
  password: string
  scope: string | null
  device: TokenDeviceInfo | null
  twoFactorProvider: string | null
  twoFactorToken: string | null
  twoFactorCode: string | null
}

export type TokenDeviceInfo = {
  identifier: string
  name: string | null
  type: number | null
}

export type RefreshTokenGrantRequest = {
  refreshToken: string
}

export type AuthRequestGrantRequest = {
  username: string
  usernameNormalized: string
  accessCode: string
  authRequestId: string
  device: TokenDeviceInfo
}

export type AuthRequestGrantParseResult =
  | { ok: true; grant: AuthRequestGrantRequest }
  | { ok: false; reason: 'not_auth_request' }
  | FailedTokenRequest

export type PasswordGrantParseResult =
  | {
      ok: true
      grant: PasswordGrantRequest
    }
  | FailedTokenRequest

export type FailedTokenRequest = {
  ok: false
  status: 400
  error: TokenError
}

export type TokenError = {
  error: 'invalid_grant' | 'invalid_request' | 'unsupported_grant_type'
  errorModel: {
    Message: string
    Object: 'error'
  }
}

export type AccessTokenAuthMethod = 'auth_request' | 'password' | 'refresh'

export type AccessTokenClaims = {
  sub: string
  email: string
  email_verified?: boolean
  name?: string | null
  premium?: boolean
  amr?: string[]
  device: string
  securityStamp: string
  sstamp?: string
  iat: number
  exp: number
  authMethod?: AccessTokenAuthMethod
}

export type AccessTokenSigningKey = {
  id: string
  secret: string
}

export type AccessTokenKeyring = {
  active: AccessTokenSigningKey
  previous?: AccessTokenSigningKey[]
  legacySecrets?: string[]
}

export type AccessTokenSigner = string | AccessTokenSigningKey
export type AccessTokenVerifier = string | AccessTokenKeyring

export type AccessTokenVerification =
  | {
      ok: true
      claims: AccessTokenClaims
      keyId?: string
    }
  | {
      ok: false
      code: 'expired' | 'invalid'
    }

export function parsePasswordGrantForm(
  form: URLSearchParams,
): PasswordGrantParseResult {
  const grantType = form.get('grant_type')

  if (grantType !== 'password') {
    return tokenRequestError(
      'unsupported_grant_type',
      'The requested grant type is not supported.',
    )
  }

  const username = form.get('username')?.trim()
  const password = form.get('password')?.trim()

  if (!username || !password) {
    return tokenRequestError(
      'invalid_request',
      'Username and password are required.',
    )
  }

  const usernameNormalized = normalizeEmail(username)
  if (!usernameNormalized) {
    return tokenRequestError(
      'invalid_request',
      'Username and password are required.',
    )
  }

  return {
    ok: true,
    grant: {
      username,
      usernameNormalized,
      password,
      scope: form.get('scope')?.trim() || null,
      device: parseDeviceInfo(form),
      twoFactorProvider: readFormValue(form, [
        'twoFactorProvider',
        'two_factor_provider',
        'TwoFactorProvider',
      ]),
      twoFactorToken: readFormValue(form, [
        'twoFactorToken',
        'two_factor_token',
        'TwoFactorToken',
      ]),
      twoFactorCode: readFormValue(form, [
        'twoFactorCode',
        'two_factor_code',
        'TwoFactorCode',
        'code',
      ]),
    },
  }
}

export function parseAuthRequestGrantForm(
  form: URLSearchParams,
): AuthRequestGrantParseResult {
  const authRequestId = readFormValue(form, [
    'authRequest',
    'auth_request',
    'AuthRequest',
  ])
  if (!authRequestId) {
    return { ok: false, reason: 'not_auth_request' }
  }

  if (form.get('grant_type') !== 'password') {
    return tokenRequestError(
      'unsupported_grant_type',
      'The requested grant type is not supported.',
    )
  }

  const username = form.get('username')?.trim()
  const accessCode = form.get('password')
  const usernameNormalized = username ? normalizeEmail(username) : null
  const device = parseDeviceInfo(form)

  if (!username || !usernameNormalized || !accessCode || !device) {
    return tokenRequestError(
      'invalid_request',
      'Auth request credentials and device information are required.',
    )
  }

  return {
    ok: true,
    grant: {
      username,
      usernameNormalized,
      accessCode,
      authRequestId,
      device,
    },
  }
}

function parseDeviceInfo(form: URLSearchParams): TokenDeviceInfo | null {
  const identifier = readFormValue(form, [
    'deviceIdentifier',
    'device_identifier',
    'DeviceIdentifier',
  ])
  if (!identifier) {
    return null
  }

  const rawType = readFormValue(form, [
    'deviceType',
    'device_type',
    'DeviceType',
  ])
  const type = rawType ? Number.parseInt(rawType, 10) : null

  return {
    identifier,
    name: readFormValue(form, ['deviceName', 'device_name', 'DeviceName']),
    type: Number.isFinite(type) ? type : null,
  }
}

function readFormValue(
  form: URLSearchParams,
  fieldNames: readonly string[],
): string | null {
  for (const fieldName of fieldNames) {
    const value = form.get(fieldName)?.trim()
    if (value) {
      return value
    }
  }

  return null
}

export function parseRefreshTokenGrantForm(
  form: URLSearchParams,
): { ok: true; grant: RefreshTokenGrantRequest } | FailedTokenRequest {
  const grantType = form.get('grant_type')

  if (grantType !== 'refresh_token') {
    return tokenRequestError(
      'unsupported_grant_type',
      'The requested grant type is not supported.',
    )
  }

  const refreshToken = form.get('refresh_token')?.trim()
  if (!refreshToken) {
    return tokenRequestError('invalid_request', 'Refresh token is required.')
  }

  return {
    ok: true,
    grant: {
      refreshToken,
    },
  }
}

export function invalidGrantError(): TokenError {
  return {
    error: 'invalid_grant',
    errorModel: {
      Message: 'Invalid username or password.',
      Object: 'error',
    },
  }
}

export function verifyPresentedPasswordHash(
  storedHash: string,
  presentedHash: string,
): boolean {
  return constantTimeEqual(storedHash, presentedHash)
}

export async function signAccessToken(
  signer: AccessTokenSigner,
  claims: AccessTokenClaims,
): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    ...(typeof signer === 'string' ? {} : { kid: signer.id }),
  }
  const encodedHeader = encodeJson(header)
  const encodedPayload = encodeJson(claims)
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await hmacSha256(signingSecret(signer), signingInput)

  return `${signingInput}.${base64UrlEncodeBytes(signature)}`
}

export async function verifyAccessToken(
  verifier: AccessTokenVerifier,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AccessTokenVerification> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, code: 'invalid' }
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return { ok: false, code: 'invalid' }
  }

  const header = decodeJson<AccessTokenHeader>(encodedHeader)
  if (!isAccessTokenHeader(header)) {
    return { ok: false, code: 'invalid' }
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const verificationKey = await findVerificationKey({
    verifier,
    kid: header.kid,
    signingInput,
    encodedSignature,
  })
  if (!verificationKey) {
    return { ok: false, code: 'invalid' }
  }

  const claims = decodeJson<AccessTokenClaims>(encodedPayload)
  if (!isAccessTokenClaims(claims)) {
    return { ok: false, code: 'invalid' }
  }

  if (claims.exp <= nowSeconds) {
    return { ok: false, code: 'expired' }
  }

  return {
    ok: true,
    claims,
    ...(verificationKey.id ? { keyId: verificationKey.id } : {}),
  }
}

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)

  return base64UrlEncodeBytes(bytes)
}

export async function hashRefreshToken(
  secret: string,
  refreshToken: string,
): Promise<string> {
  const input = new TextEncoder().encode(`${secret}:${refreshToken}`)
  const digest = await crypto.subtle.digest('SHA-256', input)

  return base64UrlEncodeBytes(new Uint8Array(digest))
}

export function tokenRequestError(
  error: TokenError['error'],
  message: string,
): FailedTokenRequest {
  return {
    ok: false,
    status: 400,
    error: {
      error,
      errorModel: {
        Message: message,
        Object: 'error',
      },
    },
  }
}

export function tokenErrorResponse(error: TokenError) {
  return {
    error: error.error,
    ErrorModel: error.errorModel,
  }
}

function encodeJson(value: unknown): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(
      new TextDecoder().decode(base64UrlDecodeBytes(value)),
    ) as T
  } catch {
    return null
  }
}

function isAccessTokenClaims(value: unknown): value is AccessTokenClaims {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const claims = value as Record<string, unknown>

  return (
    typeof claims.sub === 'string' &&
    typeof claims.email === 'string' &&
    typeof claims.device === 'string' &&
    typeof claims.securityStamp === 'string' &&
    (claims.email_verified === undefined ||
      typeof claims.email_verified === 'boolean') &&
    (claims.name === undefined ||
      claims.name === null ||
      typeof claims.name === 'string') &&
    (claims.premium === undefined || typeof claims.premium === 'boolean') &&
    (claims.amr === undefined ||
      (Array.isArray(claims.amr) &&
        claims.amr.every((method) => typeof method === 'string'))) &&
    (claims.sstamp === undefined || typeof claims.sstamp === 'string') &&
    typeof claims.iat === 'number' &&
    typeof claims.exp === 'number' &&
    (claims.authMethod === undefined ||
      claims.authMethod === 'password' ||
      claims.authMethod === 'refresh')
  )
}

type AccessTokenHeader = {
  alg: string
  typ: string
  kid?: string
}

function isAccessTokenHeader(value: unknown): value is AccessTokenHeader {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const header = value as Record<string, unknown>

  return (
    header.alg === 'HS256' &&
    header.typ === 'JWT' &&
    (header.kid === undefined ||
      (typeof header.kid === 'string' && header.kid.length > 0))
  )
}

function signingSecret(signer: AccessTokenSigner): string {
  return typeof signer === 'string' ? signer : signer.secret
}

async function findVerificationKey(input: {
  verifier: AccessTokenVerifier
  kid: string | undefined
  signingInput: string
  encodedSignature: string
}): Promise<{ id?: string; secret: string } | null> {
  if (typeof input.verifier === 'string') {
    return (await signatureMatches({
      secret: input.verifier,
      signingInput: input.signingInput,
      encodedSignature: input.encodedSignature,
    }))
      ? { secret: input.verifier }
      : null
  }

  const keyedCandidates = [
    input.verifier.active,
    ...(input.verifier.previous ?? []),
  ]

  if (input.kid) {
    const keyedCandidate = keyedCandidates.find(
      (candidate) => candidate.id === input.kid,
    )
    if (!keyedCandidate) {
      return null
    }

    return (await signatureMatches({
      secret: keyedCandidate.secret,
      signingInput: input.signingInput,
      encodedSignature: input.encodedSignature,
    }))
      ? keyedCandidate
      : null
  }

  const legacyCandidates = [
    ...keyedCandidates,
    ...(input.verifier.legacySecrets ?? []).map((secret) => ({ secret })),
  ]

  for (const candidate of legacyCandidates) {
    if (
      await signatureMatches({
        secret: candidate.secret,
        signingInput: input.signingInput,
        encodedSignature: input.encodedSignature,
      })
    ) {
      return candidate
    }
  }

  return null
}

async function signatureMatches(input: {
  secret: string
  signingInput: string
  encodedSignature: string
}): Promise<boolean> {
  const expectedSignature = base64UrlEncodeBytes(
    await hmacSha256(input.secret, input.signingInput),
  )

  return constantTimeEqual(expectedSignature, input.encodedSignature)
}

async function hmacSha256(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )

  return new Uint8Array(signature)
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
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
