export type PreloginKdfResponse = {
  kdf: 0
  kdfIterations: number
  kdfMemory: null
  kdfParallelism: null
}

export type PreloginDecision =
  | {
      ok: true
      response: PreloginKdfResponse
    }
  | {
      ok: false
      status: 400 | 403
      error: {
        code: 'invalid_request' | 'prelogin_not_allowed'
        message: string
      }
    }

const defaultKdfResponse = {
  kdf: 0,
  kdfIterations: 600000,
  kdfMemory: null,
  kdfParallelism: null,
} satisfies PreloginKdfResponse

export function resolvePrelogin(
  requestBody: unknown,
  allowedEmailsValue: string | undefined,
): PreloginDecision {
  if (!isRecord(requestBody)) {
    return invalidPreloginRequest()
  }

  const email = requestBody.email
  if (typeof email !== 'string') {
    return invalidPreloginRequest()
  }

  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return invalidPreloginRequest()
  }

  if (!parseAllowedEmails(allowedEmailsValue).has(normalizedEmail)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'prelogin_not_allowed',
        message: 'Prelogin is not available for this account.',
      },
    }
  }

  return {
    ok: true,
    response: { ...defaultKdfResponse },
  }
}

export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(/[,\s]+/)
      .map((email) => normalizeEmail(email))
      .filter((email): email is string => email !== null),
  )
}

export function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase()

  if (
    normalized.length === 0 ||
    normalized.startsWith('@') ||
    normalized.endsWith('@') ||
    !normalized.includes('@')
  ) {
    return null
  }

  return normalized
}

function invalidPreloginRequest(): PreloginDecision {
  return {
    ok: false,
    status: 400,
    error: {
      code: 'invalid_request',
      message: 'A valid email is required.',
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
