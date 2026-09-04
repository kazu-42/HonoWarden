import { describe, expect, it } from 'vitest'

import { hashRefreshToken } from '../../src/domain/tokens'
import {
  buildWebAuthnOriginPolicyVersion,
  evaluateWebAuthnSignCount,
  hashWebAuthnChallenge,
  hashWebAuthnRouteToken,
  resolveWebAuthnPrfState,
  webAuthnChallengeTtlSeconds,
  webAuthnPolicy,
  webAuthnPrfSaltLabel,
  webAuthnRetentionDeleteAfter,
} from '../../src/domain/webauthn'

describe('WebAuthn persistence policy', () => {
  it('keeps credential, challenge, and cleanup limits explicit', () => {
    expect(webAuthnPolicy).toEqual({
      assertionChallengeTtlSeconds: 7 * 60,
      challengeRetentionSeconds: 24 * 60 * 60,
      cleanupRowsPerSlice: 100,
      keySetChallengeTtlSeconds: 17 * 60,
      maxCredentialNameLength: 64,
      maxCredentialsPerUser: 5,
      maxOrigins: 16,
      registrationChallengeTtlSeconds: 7 * 60,
    })
    expect(webAuthnPrfSaltLabel).toBe('passwordless-login')
    expect(webAuthnChallengeTtlSeconds('registration')).toBe(7 * 60)
    expect(webAuthnChallengeTtlSeconds('authentication')).toBe(7 * 60)
    expect(webAuthnChallengeTtlSeconds('prf_key_set')).toBe(17 * 60)
    expect(webAuthnRetentionDeleteAfter('2026-07-06T00:07:00.000Z')).toBe(
      '2026-07-07T00:07:00.000Z',
    )
  })

  it('hashes route tokens and challenges with secret-bound domain separation', async () => {
    const secret = 'test-token-secret'
    const tokenHash = await hashWebAuthnRouteToken(secret, 'opaque-route-token')
    const challengeHash = await hashWebAuthnChallenge(secret, 'raw-challenge')

    expect(tokenHash).toBe(
      await hashRefreshToken(secret, 'webauthn-token:opaque-route-token'),
    )
    expect(challengeHash).toBe(
      await hashRefreshToken(secret, 'webauthn-challenge:raw-challenge'),
    )
    expect(tokenHash).not.toBe(challengeHash)
    expect(tokenHash).not.toContain('opaque-route-token')
    expect(challengeHash).not.toContain('raw-challenge')
  })

  it('builds an immutable origin-policy version from RP ID and canonical origins', async () => {
    const version = await buildWebAuthnOriginPolicyVersion({
      rpId: 'example.com',
      origins: ['https://vault.example.com', 'https://example.com'],
    })
    const shuffled = await buildWebAuthnOriginPolicyVersion({
      rpId: 'example.com',
      origins: ['https://example.com', 'https://vault.example.com'],
    })
    const otherRp = await buildWebAuthnOriginPolicyVersion({
      rpId: 'vault.example.com',
      origins: ['https://vault.example.com', 'https://example.com'],
    })

    expect(version).toMatch(/^[0-9a-f]{64}$/)
    expect(version).toBe(shuffled)
    expect(version).not.toBe(otherRp)
    expect(version).not.toContain('example.com')
  })

  it('preserves valid zero counters and rejects positive regressions', () => {
    expect(
      evaluateWebAuthnSignCount({ storedSignCount: 0, reportedSignCount: 0 }),
    ).toEqual({ ok: true, nextSignCount: 0 })
    expect(
      evaluateWebAuthnSignCount({ storedSignCount: 0, reportedSignCount: 4 }),
    ).toEqual({ ok: true, nextSignCount: 4 })
    expect(
      evaluateWebAuthnSignCount({ storedSignCount: 4, reportedSignCount: 9 }),
    ).toEqual({ ok: true, nextSignCount: 9 })
    expect(
      evaluateWebAuthnSignCount({ storedSignCount: 9, reportedSignCount: 8 }),
    ).toEqual({ ok: false, code: 'counter_regression' })
    expect(
      evaluateWebAuthnSignCount({ storedSignCount: 9, reportedSignCount: 9 }),
    ).toEqual({ ok: false, code: 'counter_regression' })
    expect(
      evaluateWebAuthnSignCount({ storedSignCount: 9, reportedSignCount: 0 }),
    ).toEqual({ ok: false, code: 'counter_regression' })
  })

  it('classifies PRF state only from support plus a complete encrypted key triple', () => {
    expect(
      resolveWebAuthnPrfState({
        prfSupported: false,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
      }),
    ).toEqual({ ok: true, state: 'unsupported' })
    expect(
      resolveWebAuthnPrfState({
        prfSupported: true,
        encryptedUserKey: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
      }),
    ).toEqual({ ok: true, state: 'supported' })
    expect(
      resolveWebAuthnPrfState({
        prfSupported: true,
        encryptedUserKey: 'enc-user',
        encryptedPublicKey: 'enc-public',
        encryptedPrivateKey: 'enc-private',
      }),
    ).toEqual({ ok: true, state: 'enabled' })
    expect(
      resolveWebAuthnPrfState({
        prfSupported: true,
        encryptedUserKey: 'enc-user',
        encryptedPublicKey: null,
        encryptedPrivateKey: 'enc-private',
      }),
    ).toEqual({ ok: false, code: 'partial_prf_key_set' })
    expect(
      resolveWebAuthnPrfState({
        prfSupported: false,
        encryptedUserKey: 'enc-user',
        encryptedPublicKey: 'enc-public',
        encryptedPrivateKey: 'enc-private',
      }),
    ).toEqual({ ok: false, code: 'partial_prf_key_set' })
  })
})
