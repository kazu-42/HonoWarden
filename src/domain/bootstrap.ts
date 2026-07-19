import { normalizeEmail, parseAllowedEmails } from './prelogin'
import { classifyAccountKeyState } from './account-keys'

export type BootstrapAccountPayload = {
  email: string
  emailNormalized: string
  displayName: string | null
  masterPasswordHash: string
  userKey: string | null
  publicKey: string | null
  privateKey: string | null
}

export type BootstrapUserRecord = BootstrapAccountPayload & {
  id: string
  kdfAlgorithm: 'pbkdf2-sha256'
  kdfIterations: 600000
  kdfMemory: null
  kdfParallelism: null
  securityStamp: string
  revisionDate: string
}

export type BootstrapDecision =
  | {
      ok: true
      payload: BootstrapAccountPayload
    }
  | {
      ok: false
      status: 400 | 403
      error: {
        code: 'bootstrap_not_allowed' | 'invalid_request'
        message: string
      }
    }

export function isBootstrapEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase())
}

export function verifyBootstrapToken(
  expectedToken: string | undefined,
  presentedToken: string | undefined,
): boolean {
  if (!expectedToken || !presentedToken) {
    return false
  }

  return constantTimeEqual(expectedToken, presentedToken)
}

export function resolveBootstrapAccount(
  requestBody: unknown,
  allowedEmailsValue: string | undefined,
): BootstrapDecision {
  if (!isRecord(requestBody)) {
    return invalidBootstrapRequest()
  }

  const email = requiredString(requestBody.email)
  const masterPasswordHash = requiredString(requestBody.masterPasswordHash)

  if (!email || !masterPasswordHash) {
    return invalidBootstrapRequest()
  }

  const emailNormalized = normalizeEmail(email)
  if (!emailNormalized) {
    return invalidBootstrapRequest()
  }

  if (!parseAllowedEmails(allowedEmailsValue).has(emailNormalized)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'bootstrap_not_allowed',
        message: 'Bootstrap is not available for this account.',
      },
    }
  }

  const userKey = optionalString(requestBody.userKey)
  const publicKey = optionalString(requestBody.publicKey)
  const privateKey = optionalString(requestBody.privateKey)
  const accountKeyState = classifyAccountKeyState({ publicKey, privateKey })
  if (
    accountKeyState.status === 'invalid' ||
    (accountKeyState.status === 'complete' && userKey === null)
  ) {
    return invalidBootstrapRequest()
  }

  return {
    ok: true,
    payload: {
      email: email.trim(),
      emailNormalized,
      displayName: optionalString(requestBody.displayName),
      masterPasswordHash,
      userKey,
      publicKey,
      privateKey,
    },
  }
}

export function buildBootstrapUserRecord(
  payload: BootstrapAccountPayload,
  values: {
    id: string
    revisionDate: string
    securityStamp: string
  },
): BootstrapUserRecord {
  return {
    ...payload,
    id: values.id,
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: 600000,
    kdfMemory: null,
    kdfParallelism: null,
    revisionDate: values.revisionDate,
    securityStamp: values.securityStamp,
  }
}

function invalidBootstrapRequest(): BootstrapDecision {
  return {
    ok: false,
    status: 400,
    error: {
      code: 'invalid_request',
      message: 'A valid bootstrap account payload is required.',
    },
  }
}

function requiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
