import { describe, expect, it } from 'vitest'

import {
  resolveWebAuthnRuntimePolicy,
  webAuthnPolicy,
} from '../../src/domain/webauthn'

const readyBindings = {
  HONOWARDEN_WEBAUTHN_ENABLED: 'true',
  HONOWARDEN_WEBAUTHN_RP_ID: 'example.com',
  HONOWARDEN_WEBAUTHN_ORIGINS: 'https://login.example.com',
}

describe('WebAuthn runtime policy', () => {
  it('keeps credential and challenge limits explicit', () => {
    expect(webAuthnPolicy).toEqual({
      assertionChallengeTtlSeconds: 7 * 60,
      keySetChallengeTtlSeconds: 17 * 60,
      maxCredentialsPerUser: 5,
      maxOrigins: 16,
      registrationChallengeTtlSeconds: 7 * 60,
    })
  })

  it('is disabled by default and ignores incomplete trust roots while off', () => {
    expect(resolveWebAuthnRuntimePolicy({})).toEqual({
      enabled: false,
      status: 'disabled',
    })
    expect(
      resolveWebAuthnRuntimePolicy({
        HONOWARDEN_WEBAUTHN_ENABLED: ' FALSE ',
        HONOWARDEN_WEBAUTHN_RP_ID: 'not a valid RP',
      }),
    ).toEqual({ enabled: false, status: 'disabled' })
    expect(
      resolveWebAuthnRuntimePolicy({
        HONOWARDEN_WEBAUTHN_ENABLED: '   ',
      }),
    ).toEqual({ enabled: false, status: 'disabled' })
  })

  it('rejects ambiguous enablement values instead of silently disabling', () => {
    expect(
      resolveWebAuthnRuntimePolicy({
        HONOWARDEN_WEBAUTHN_ENABLED: 'yes',
      }),
    ).toEqual({
      enabled: false,
      errors: ['invalid_enabled_flag'],
      status: 'misconfigured',
    })
  })

  it('requires both configured trust roots when enabled', () => {
    expect(
      resolveWebAuthnRuntimePolicy({
        HONOWARDEN_WEBAUTHN_ENABLED: 'true',
      }),
    ).toEqual({
      enabled: false,
      errors: ['missing_rp_id', 'missing_origins'],
      status: 'misconfigured',
    })
  })

  it('canonicalizes, deduplicates, and sorts exact allowed origins', () => {
    expect(
      resolveWebAuthnRuntimePolicy({
        ...readyBindings,
        HONOWARDEN_WEBAUTHN_ORIGINS:
          ' HTTPS://LOGIN.EXAMPLE.COM:443/ , https://example.com, https://login.example.com ',
      }),
    ).toEqual({
      allowInsecureLocalhost: false,
      enabled: true,
      origins: ['https://example.com', 'https://login.example.com'],
      rpId: 'example.com',
      status: 'ready',
    })
  })

  it.each([
    'Example.com',
    'example.com.',
    'https://example.com',
    'example.com:443',
    '*.example.com',
    'example..com',
    '-example.com',
    'example-.com',
    '127.0.0.1',
    '[::1]',
    'singlelabel',
  ])('rejects non-canonical RP ID %s', (rpId) => {
    expect(
      resolveWebAuthnRuntimePolicy({
        ...readyBindings,
        HONOWARDEN_WEBAUTHN_RP_ID: rpId,
      }),
    ).toEqual({
      enabled: false,
      errors: ['invalid_rp_id'],
      status: 'misconfigured',
    })
  })

  it.each([
    ['https://user:pass@example.com', 'invalid_origin'],
    ['https://example.com/path', 'invalid_origin'],
    ['https://example.com?query=1', 'invalid_origin'],
    ['https://example.com#fragment', 'invalid_origin'],
    [String.raw`https:\example.com`, 'invalid_origin'],
    ['https://example.com/%2e%2e', 'invalid_origin'],
    ['https://example.com/.', 'invalid_origin'],
    ['https://%65xample.com', 'invalid_origin'],
    ['https://ｅxample.com', 'invalid_origin'],
    ['https://K.example.com', 'invalid_origin'],
    ['https://exa\nmple.com', 'invalid_origin'],
    ['https://example.com:0443', 'invalid_origin'],
    ['https://*.example.com', 'invalid_origin'],
    ['https://127.0.0.1', 'invalid_origin'],
    ['chrome-extension://abcdefghijklmnop', 'invalid_origin'],
    ['moz-extension://abcdefghijklmnop', 'invalid_origin'],
    ['not a URL', 'invalid_origin'],
    ['http://example.com', 'insecure_origin'],
    ['https://evil-example.com', 'origin_rp_mismatch'],
  ])('rejects origin %s with %s', (origin, error) => {
    expect(
      resolveWebAuthnRuntimePolicy({
        ...readyBindings,
        HONOWARDEN_WEBAUTHN_ORIGINS: origin,
      }),
    ).toEqual({
      enabled: false,
      errors: [error],
      status: 'misconfigured',
    })
  })

  it('permits HTTP only for exact localhost with a separate explicit opt-in', () => {
    const localhostBindings = {
      HONOWARDEN_WEBAUTHN_ENABLED: 'true',
      HONOWARDEN_WEBAUTHN_RP_ID: 'localhost',
      HONOWARDEN_WEBAUTHN_ORIGINS: 'http://localhost:8787',
    }

    expect(resolveWebAuthnRuntimePolicy(localhostBindings)).toEqual({
      enabled: false,
      errors: ['insecure_origin'],
      status: 'misconfigured',
    })
    expect(
      resolveWebAuthnRuntimePolicy({
        ...localhostBindings,
        HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST: ' TRUE ',
      }),
    ).toEqual({
      allowInsecureLocalhost: true,
      enabled: true,
      origins: ['http://localhost:8787'],
      rpId: 'localhost',
      status: 'ready',
    })
    expect(
      resolveWebAuthnRuntimePolicy({
        ...localhostBindings,
        HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST: 'true',
        HONOWARDEN_WEBAUTHN_ORIGINS: 'http://127.0.0.1:8787',
      }),
    ).toEqual({
      enabled: false,
      errors: ['invalid_origin'],
      status: 'misconfigured',
    })
  })

  it('rejects an ambiguous localhost opt-in value', () => {
    expect(
      resolveWebAuthnRuntimePolicy({
        ...readyBindings,
        HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST: 'enabled',
      }),
    ).toEqual({
      enabled: false,
      errors: ['invalid_localhost_flag'],
      status: 'misconfigured',
    })
  })

  it('bounds configured origin count before canonical deduplication', () => {
    const origins = Array.from(
      { length: webAuthnPolicy.maxOrigins + 1 },
      (_, index) => `https://host-${index}.example.com`,
    )

    expect(
      resolveWebAuthnRuntimePolicy({
        ...readyBindings,
        HONOWARDEN_WEBAUTHN_ORIGINS: origins.join(','),
      }),
    ).toEqual({
      enabled: false,
      errors: ['too_many_origins'],
      status: 'misconfigured',
    })
  })

  it('returns deterministic unique codes without leaking configured values', () => {
    const secretLookingHost = 'internal-sensitive-name.invalid'
    const result = resolveWebAuthnRuntimePolicy({
      HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST: 'sometimes',
      HONOWARDEN_WEBAUTHN_ENABLED: 'true',
      HONOWARDEN_WEBAUTHN_ORIGINS: `,http://${secretLookingHost},https://other.example`,
      HONOWARDEN_WEBAUTHN_RP_ID: 'example.com',
    })

    expect(result).toEqual({
      enabled: false,
      errors: [
        'invalid_localhost_flag',
        'invalid_origin',
        'insecure_origin',
        'origin_rp_mismatch',
      ],
      status: 'misconfigured',
    })
    expect(JSON.stringify(result)).not.toContain(secretLookingHost)
  })
})
