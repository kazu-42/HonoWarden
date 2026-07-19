import {
  accountCredentialKdfPolicy,
  accountCredentialKdfFromStoredGeneration,
  type AccountCredentialGeneration,
  type AccountCredentialKdf,
} from './account-credentials'

export type PreloginKdfResponse = {
  kdf: 0
  kdfIterations: number
  kdfMemory: null
  kdfParallelism: null
}

export type ProjectedPreloginKdfResponse = {
  kdf: 0 | 1
  kdfIterations: number
  kdfMemory: number | null
  kdfParallelism: number | null
  kdfSettings: AccountCredentialKdf
  salt: string
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

const syntheticKdfDomain = 'honowarden:prelogin-kdf:v2:'

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

export async function buildPreloginKdfResponse(
  emailNormalized: string,
  generation: AccountCredentialGeneration | null,
  secret: string,
): Promise<ProjectedPreloginKdfResponse | null> {
  if (generation && generation.emailNormalized !== emailNormalized) {
    return null
  }

  const syntheticKdf = await deriveSyntheticKdf(emailNormalized, secret)
  const kdf = generation
    ? accountCredentialKdfFromStoredGeneration(generation)
    : syntheticKdf
  if (!kdf) {
    return null
  }

  return {
    kdf: kdf.kdfType,
    kdfIterations: kdf.iterations,
    kdfMemory: kdf.memory,
    kdfParallelism: kdf.parallelism,
    kdfSettings: { ...kdf },
    salt: emailNormalized,
  }
}

async function deriveSyntheticKdf(
  emailNormalized: string,
  secret: string,
): Promise<AccountCredentialKdf> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${syntheticKdfDomain}${emailNormalized}`),
  )
  const view = new DataView(digest)

  if (view.getUint8(0) % 2 === 0) {
    return {
      kdfType: 0,
      iterations: syntheticBoundedInteger(
        view,
        1,
        accountCredentialKdfPolicy.pbkdf2Iterations,
      ),
      memory: null,
      parallelism: null,
    }
  }

  return {
    kdfType: 1,
    iterations: syntheticBoundedInteger(
      view,
      1,
      accountCredentialKdfPolicy.argon2Iterations,
    ),
    memory: syntheticBoundedInteger(
      view,
      5,
      accountCredentialKdfPolicy.argon2Memory,
    ),
    parallelism: syntheticBoundedInteger(
      view,
      9,
      accountCredentialKdfPolicy.argon2Parallelism,
    ),
  }
}

function syntheticBoundedInteger(
  view: DataView,
  byteOffset: number,
  range: { min: number; max: number },
): number {
  const size = range.max - range.min + 1
  return range.min + (view.getUint32(byteOffset, false) % size)
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
