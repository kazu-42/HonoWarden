import {
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

export type PreloginKdfDistributionEntry = Omit<
  AccountCredentialGeneration,
  'emailNormalized'
> & {
  accountCount: number
}

export type PreloginKdfContext = {
  target: AccountCredentialGeneration | null
  distribution: PreloginKdfDistributionEntry[]
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

const defaultAccountKdf = {
  kdfType: defaultKdfResponse.kdf,
  iterations: defaultKdfResponse.kdfIterations,
  memory: defaultKdfResponse.kdfMemory,
  parallelism: defaultKdfResponse.kdfParallelism,
} satisfies AccountCredentialKdf

const syntheticKdfDomain = 'honowarden:prelogin-kdf:v3:'

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
  context: PreloginKdfContext,
  secret: string,
): Promise<ProjectedPreloginKdfResponse | null> {
  if (
    !context ||
    !Array.isArray(context.distribution) ||
    (context.target && context.target.emailNormalized !== emailNormalized)
  ) {
    return null
  }

  const distribution = normalizeStoredKdfDistribution(context.distribution)
  if (!distribution) {
    return null
  }
  const targetKdf = context.target
    ? accountCredentialKdfFromStoredGeneration(context.target)
    : null
  if (
    (context.target && !targetKdf) ||
    (targetKdf && !distribution.some((entry) => equalKdf(entry.kdf, targetKdf)))
  ) {
    return null
  }

  const syntheticKdf = await deriveSyntheticKdf(
    emailNormalized,
    secret,
    distribution.length > 0
      ? distribution
      : [{ kdf: defaultAccountKdf, accountCount: 1 }],
  )
  const kdf = targetKdf ?? syntheticKdf

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
  distribution: WeightedKdf[],
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
  const total = distribution.reduce((sum, entry) => sum + entry.accountCount, 0)
  let selected = Number(view.getBigUint64(0, false) % BigInt(total))

  for (const entry of distribution) {
    if (selected < entry.accountCount) {
      return { ...entry.kdf }
    }
    selected -= entry.accountCount
  }

  throw new Error('prelogin KDF distribution selection failed')
}

type WeightedKdf = {
  kdf: AccountCredentialKdf
  accountCount: number
}

function normalizeStoredKdfDistribution(
  entries: PreloginKdfDistributionEntry[],
): WeightedKdf[] | null {
  const byKdf = new Map<string, WeightedKdf>()
  let total = 0

  for (const entry of entries) {
    const kdf = accountCredentialKdfFromStoredGeneration({
      emailNormalized: 'distribution@invalid.example',
      kdfAlgorithm: entry.kdfAlgorithm,
      kdfIterations: entry.kdfIterations,
      kdfMemory: entry.kdfMemory,
      kdfParallelism: entry.kdfParallelism,
    })
    if (
      !kdf ||
      !Number.isSafeInteger(entry.accountCount) ||
      entry.accountCount < 1 ||
      !Number.isSafeInteger(total + entry.accountCount)
    ) {
      return null
    }

    total += entry.accountCount
    const key = serializeKdf(kdf)
    const existing = byKdf.get(key)
    if (existing) {
      if (!Number.isSafeInteger(existing.accountCount + entry.accountCount)) {
        return null
      }
      existing.accountCount += entry.accountCount
    } else {
      byKdf.set(key, { kdf, accountCount: entry.accountCount })
    }
  }

  return [...byKdf.values()].sort((left, right) =>
    compareSerializedKdf(serializeKdf(left.kdf), serializeKdf(right.kdf)),
  )
}

function equalKdf(left: AccountCredentialKdf, right: AccountCredentialKdf) {
  return serializeKdf(left) === serializeKdf(right)
}

function serializeKdf(kdf: AccountCredentialKdf): string {
  return [
    kdf.kdfType,
    kdf.iterations,
    kdf.memory ?? '',
    kdf.parallelism ?? '',
  ].join(':')
}

function compareSerializedKdf(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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
