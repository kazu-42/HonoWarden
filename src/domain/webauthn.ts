export const webAuthnPolicy = {
  assertionChallengeTtlSeconds: 7 * 60,
  keySetChallengeTtlSeconds: 17 * 60,
  maxCredentialsPerUser: 5,
  maxOrigins: 16,
  registrationChallengeTtlSeconds: 7 * 60,
} as const

export type WebAuthnRuntimeBindings = {
  HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST?: string
  HONOWARDEN_WEBAUTHN_ENABLED?: string
  HONOWARDEN_WEBAUTHN_ORIGINS?: string
  HONOWARDEN_WEBAUTHN_RP_ID?: string
}

export type WebAuthnPolicyErrorCode =
  | 'invalid_enabled_flag'
  | 'invalid_localhost_flag'
  | 'missing_rp_id'
  | 'invalid_rp_id'
  | 'missing_origins'
  | 'too_many_origins'
  | 'invalid_origin'
  | 'insecure_origin'
  | 'origin_rp_mismatch'

export type WebAuthnRuntimePolicy =
  | {
      status: 'disabled'
      enabled: false
    }
  | {
      status: 'misconfigured'
      enabled: false
      errors: readonly WebAuthnPolicyErrorCode[]
    }
  | {
      status: 'ready'
      enabled: true
      allowInsecureLocalhost: boolean
      origins: readonly string[]
      rpId: string
    }

const errorOrder: readonly WebAuthnPolicyErrorCode[] = [
  'invalid_enabled_flag',
  'invalid_localhost_flag',
  'missing_rp_id',
  'invalid_rp_id',
  'missing_origins',
  'too_many_origins',
  'invalid_origin',
  'insecure_origin',
  'origin_rp_mismatch',
]

type ExplicitBoolean = true | false | 'invalid'

type ParsedOrigin = {
  canonical: string | null
  errors: readonly WebAuthnPolicyErrorCode[]
}

export function resolveWebAuthnRuntimePolicy(
  bindings: WebAuthnRuntimeBindings,
): WebAuthnRuntimePolicy {
  const enabled = parseExplicitBoolean(bindings.HONOWARDEN_WEBAUTHN_ENABLED)

  if (enabled === false) {
    return { enabled: false, status: 'disabled' }
  }
  if (enabled === 'invalid') {
    return misconfigured(['invalid_enabled_flag'])
  }

  const errors = new Set<WebAuthnPolicyErrorCode>()
  const allowInsecureLocalhost = parseExplicitBoolean(
    bindings.HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST,
  )
  if (allowInsecureLocalhost === 'invalid') {
    errors.add('invalid_localhost_flag')
  }

  const rpId = bindings.HONOWARDEN_WEBAUTHN_RP_ID?.trim() ?? ''
  const validRpId = rpId.length > 0 && isValidRpId(rpId)
  if (rpId.length === 0) {
    errors.add('missing_rp_id')
  } else if (!validRpId) {
    errors.add('invalid_rp_id')
  }

  const originList = bindings.HONOWARDEN_WEBAUTHN_ORIGINS?.trim() ?? ''
  const canonicalOrigins = new Set<string>()
  if (originList.length === 0) {
    errors.add('missing_origins')
  } else {
    const origins = originList.split(',')
    if (origins.length > webAuthnPolicy.maxOrigins) {
      errors.add('too_many_origins')
    } else {
      for (const origin of origins) {
        const parsed = parseOrigin(
          origin,
          validRpId ? rpId : null,
          allowInsecureLocalhost === true,
        )
        for (const error of parsed.errors) {
          errors.add(error)
        }
        if (parsed.canonical !== null) {
          canonicalOrigins.add(parsed.canonical)
        }
      }
    }
  }

  if (errors.size > 0) {
    return misconfigured(errors)
  }

  return {
    allowInsecureLocalhost: allowInsecureLocalhost === true,
    enabled: true,
    origins: [...canonicalOrigins].sort(),
    rpId,
    status: 'ready',
  }
}

function parseExplicitBoolean(value: string | undefined): ExplicitBoolean {
  const normalized = value?.trim().toLowerCase() ?? ''

  if (normalized.length === 0 || normalized === 'false') {
    return false
  }
  if (normalized === 'true') {
    return true
  }

  return 'invalid'
}

function parseOrigin(
  rawOrigin: string,
  rpId: string | null,
  allowInsecureLocalhost: boolean,
): ParsedOrigin {
  const origin = rawOrigin.trim()
  let url: URL

  try {
    url = new URL(origin)
  } catch {
    return { canonical: null, errors: ['invalid_origin'] }
  }

  if (
    origin.length === 0 ||
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !hasExactOriginSerialization(origin, url) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !isValidOriginHostname(url.hostname)
  ) {
    return { canonical: null, errors: ['invalid_origin'] }
  }

  const errors = new Set<WebAuthnPolicyErrorCode>()
  if (
    url.protocol === 'http:' &&
    (url.hostname !== 'localhost' || !allowInsecureLocalhost)
  ) {
    errors.add('insecure_origin')
  }
  if (rpId !== null && !isHostnameWithinRp(url.hostname, rpId)) {
    errors.add('origin_rp_mismatch')
  }

  return {
    canonical: errors.size === 0 ? url.origin : null,
    errors: orderedErrors(errors),
  }
}

function hasExactOriginSerialization(origin: string, url: URL): boolean {
  if (!isVisibleAscii(origin)) {
    return false
  }

  const canonical = url.origin.toLowerCase()
  const accepted = new Set([canonical, `${canonical}/`])
  const defaultPort = url.protocol === 'https:' ? '443' : '80'
  const explicitDefaultPort =
    `${url.protocol}//${url.hostname}:${defaultPort}`.toLowerCase()

  accepted.add(explicitDefaultPort)
  accepted.add(`${explicitDefaultPort}/`)

  return accepted.has(origin.toLowerCase())
}

function isVisibleAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit < 0x21 || codeUnit > 0x7e) {
      return false
    }
  }

  return true
}

function isValidRpId(value: string): boolean {
  if (value === 'localhost') {
    return true
  }

  return isValidDnsHostname(value, true)
}

function isValidOriginHostname(value: string): boolean {
  if (value === 'localhost') {
    return true
  }

  return isValidDnsHostname(value, true)
}

function isValidDnsHostname(value: string, requireDot: boolean): boolean {
  if (
    value.length === 0 ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    value.endsWith('.') ||
    value.includes(':') ||
    /^\d+(?:\.\d+)+$/.test(value) ||
    (requireDot && !value.includes('.'))
  ) {
    return false
  }

  return value.split('.').every((label) => {
    return (
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  })
}

function isHostnameWithinRp(hostname: string, rpId: string): boolean {
  if (rpId === 'localhost') {
    return hostname === 'localhost'
  }

  return hostname === rpId || hostname.endsWith(`.${rpId}`)
}

function misconfigured(
  errors: Iterable<WebAuthnPolicyErrorCode>,
): WebAuthnRuntimePolicy {
  return {
    enabled: false,
    errors: orderedErrors(errors),
    status: 'misconfigured',
  }
}

function orderedErrors(
  errors: Iterable<WebAuthnPolicyErrorCode>,
): WebAuthnPolicyErrorCode[] {
  const present = new Set(errors)

  return errorOrder.filter((error) => present.has(error))
}
