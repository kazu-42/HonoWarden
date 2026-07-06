import { normalizeEmail } from './prelogin'

export type PasswordGrantRequest = {
  username: string
  usernameNormalized: string
  password: string
  scope: string | null
  twoFactorProvider: string | null
  twoFactorToken: string | null
  twoFactorCode: string | null
}

export type RefreshTokenGrantRequest = {
  refreshToken: string
}

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

export type AccessTokenClaims = {
  sub: string
  email: string
  device: string
  securityStamp: string
  iat: number
  exp: number
}

export type AccessTokenVerification =
  | {
      ok: true
      claims: AccessTokenClaims
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
  secret: string,
  claims: AccessTokenClaims,
): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }
  const encodedHeader = encodeJson(header)
  const encodedPayload = encodeJson(claims)
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await hmacSha256(secret, signingInput)

  return `${signingInput}.${base64UrlEncodeBytes(signature)}`
}

export async function verifyAccessToken(
  secret: string,
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

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const expectedSignature = base64UrlEncodeBytes(
    await hmacSha256(secret, signingInput),
  )

  if (!constantTimeEqual(expectedSignature, encodedSignature)) {
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
    typeof claims.iat === 'number' &&
    typeof claims.exp === 'number'
  )
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
