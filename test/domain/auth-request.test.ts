import { describe, expect, it } from 'vitest'

import {
  authRequestPolicy,
  buildAuthRequestAccessCodeHash,
  buildAuthRequestEmailHash,
  buildAuthRequestTimestamps,
  isAuthRequestFeatureEnabled,
  parseAuthRequestCreateBody,
  parseAuthRequestResponseBody,
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

  it('parses compatible create payload casing and normalizes email', () => {
    expect(
      parseAuthRequestCreateBody({
        Email: ' Owner@Example.com ',
        PublicKey: 'opaque-public-key',
        DeviceIdentifier: 'requester-device',
        DeviceType: 8,
        AccessCode: 'high-entropy-access-code',
        Type: 0,
      }),
    ).toEqual({
      ok: true,
      value: {
        emailNormalized: 'owner@example.com',
        requestPublicKey: 'opaque-public-key',
        requestDeviceIdentifier: 'requester-device',
        requestDeviceType: 8,
        accessCode: 'high-entropy-access-code',
        requestType: 0,
      },
    })
  })

  it('rejects unsupported, weak, or oversized create payloads', () => {
    expect(
      parseAuthRequestCreateBody({
        email: 'owner@example.com',
        publicKey: 'opaque-public-key',
        deviceIdentifier: 'requester-device',
        deviceType: 8,
        accessCode: 'too-short',
        type: 0,
      }),
    ).toEqual({ ok: false })
    expect(
      parseAuthRequestCreateBody({
        email: 'owner@example.com',
        publicKey: 'opaque-public-key',
        deviceIdentifier: 'requester-device',
        deviceType: 8,
        accessCode: 'high-entropy-access-code',
        type: 2,
      }),
    ).toEqual({ ok: false })
    expect(
      parseAuthRequestCreateBody({
        email: 'owner@example.com',
        publicKey: 'x'.repeat(authRequestPolicy.maxPublicKeyLength + 1),
        deviceIdentifier: 'requester-device',
        deviceType: 8,
        accessCode: 'high-entropy-access-code',
        type: 0,
      }),
    ).toEqual({ ok: false })
  })

  it('does not normalize client-generated cryptographic material', () => {
    const parsed = parseAuthRequestCreateBody({
      email: 'owner@example.com',
      publicKey: ' opaque-public-key ',
      deviceIdentifier: ' requester-device ',
      deviceType: 8,
      accessCode: ' high-entropy-access-code ',
      type: 1,
    })

    expect(parsed).toEqual({
      ok: true,
      value: expect.objectContaining({
        requestPublicKey: ' opaque-public-key ',
        requestDeviceIdentifier: 'requester-device',
        accessCode: ' high-entropy-access-code ',
      }),
    })
  })

  it('requires opaque key material only for approval', () => {
    expect(
      parseAuthRequestResponseBody({
        requestApproved: true,
        key: 'opaque-encrypted-key',
      }),
    ).toEqual({
      ok: true,
      value: {
        requestApproved: true,
        encryptedResponseKey: 'opaque-encrypted-key',
      },
    })
    expect(parseAuthRequestResponseBody({ requestApproved: true })).toEqual({
      ok: false,
    })
    expect(
      parseAuthRequestResponseBody({
        requestApproved: false,
        key: 'must-not-be-accepted',
      }),
    ).toEqual({ ok: false })
    expect(parseAuthRequestResponseBody({ RequestApproved: false })).toEqual({
      ok: true,
      value: { requestApproved: false, encryptedResponseKey: null },
    })
  })

  it('derives immutable expiry and terminal retention timestamps', () => {
    expect(buildAuthRequestTimestamps('2026-07-11T00:00:00.000Z')).toEqual({
      createdAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-11T00:15:00.000Z',
      retentionDeleteAfter: '2026-08-10T00:00:00.000Z',
    })
  })

  it('keeps runtime enablement explicit and default-off', () => {
    expect(isAuthRequestFeatureEnabled(undefined)).toBe(false)
    expect(isAuthRequestFeatureEnabled('false')).toBe(false)
    expect(isAuthRequestFeatureEnabled('TRUE')).toBe(true)
  })
})
