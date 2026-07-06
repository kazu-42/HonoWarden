import { normalizeEmail } from './prelogin'

export type PasswordGrantRequest = {
  username: string
  usernameNormalized: string
  password: string
  scope: string | null
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
