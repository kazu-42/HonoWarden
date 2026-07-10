import { describe, expect, it } from 'vitest'

import {
  authRequestPolicy,
  buildAuthRequestAccessCodeHash,
  buildAuthRequestEmailHash,
  verifyAuthRequestAccessCode,
} from '../../src/domain/auth-request'

const secret = '0123456789abcdef0123456789abcdef'

describe('auth request domain', () => {
  it('uses the fixed active and terminal-retention windows', () => {
    expect(authRequestPolicy.activeLifetimeSeconds).toBe(15 * 60)
    expect(authRequestPolicy.terminalRetentionDays).toBe(30)
  })

  it('builds deterministic purpose-separated HMAC values', async () => {
    const accessCodeHash = await buildAuthRequestAccessCodeHash(
      secret,
      'request-1',
      'high-entropy-access-code',
    )
    const emailHash = await buildAuthRequestEmailHash(
      secret,
      'owner@example.com',
    )

    expect(accessCodeHash).toMatch(/^hmac-sha256:[A-Za-z0-9_-]{43}$/)
    expect(emailHash).toMatch(/^hmac-sha256:[A-Za-z0-9_-]{43}$/)
    expect(accessCodeHash).not.toBe(emailHash)
    expect(accessCodeHash).not.toContain('high-entropy-access-code')
    expect(emailHash).not.toContain('owner@example.com')
  })

  it('binds an access code verifier to its request id', async () => {
    const hash = await buildAuthRequestAccessCodeHash(
      secret,
      'request-1',
      'high-entropy-access-code',
    )

    await expect(
      verifyAuthRequestAccessCode(
        secret,
        'request-1',
        'high-entropy-access-code',
        hash,
      ),
    ).resolves.toBe(true)
    await expect(
      verifyAuthRequestAccessCode(
        secret,
        'request-2',
        'high-entropy-access-code',
        hash,
      ),
    ).resolves.toBe(false)
    await expect(
      verifyAuthRequestAccessCode(secret, 'request-1', 'wrong-code', hash),
    ).resolves.toBe(false)
  })

  it('rejects malformed verifiers and undersized secrets', async () => {
    await expect(
      verifyAuthRequestAccessCode(
        secret,
        'request-1',
        'high-entropy-access-code',
        'not-a-verifier',
      ),
    ).resolves.toBe(false)
    await expect(
      buildAuthRequestAccessCodeHash('too-short', 'request-1', 'code'),
    ).rejects.toThrow('at least 32 bytes')
  })
})
