import { describe, expect, it } from 'vitest'

import {
  generateRefreshToken,
  hashRefreshToken,
  parseAuthRequestGrantForm,
  parsePasswordGrantForm,
  parseRefreshTokenGrantForm,
  signAccessToken,
  tokenErrorResponse,
  verifyAccessToken,
  verifyPresentedPasswordHash,
} from '../../src/domain/tokens'

describe('token domain', () => {
  it('parses password grant form fields', () => {
    const form = new URLSearchParams({
      grant_type: 'password',
      username: ' Person@Example.Test ',
      password: ' synthetic-master-password-hash ',
      scope: 'api offline_access',
      twoFactorProvider: ' authenticator ',
      twoFactorToken: ' challenge-token ',
      twoFactorCode: ' 123456 ',
    })

    expect(parsePasswordGrantForm(form)).toEqual({
      ok: true,
      grant: {
        username: 'Person@Example.Test',
        usernameNormalized: 'person@example.test',
        password: 'synthetic-master-password-hash',
        scope: 'api offline_access',
        device: null,
        twoFactorProvider: 'authenticator',
        twoFactorToken: 'challenge-token',
        twoFactorCode: '123456',
      },
    })
  })

  it('parses device fields from current CLI password grant forms', () => {
    const form = new URLSearchParams({
      grant_type: 'password',
      username: 'person@example.test',
      password: 'synthetic-master-password-hash',
      deviceType: '9',
      deviceIdentifier: 'fixture-device-id',
      deviceName: 'Fixture Device',
    })

    expect(parsePasswordGrantForm(form)).toMatchObject({
      ok: true,
      grant: {
        device: {
          identifier: 'fixture-device-id',
          name: 'Fixture Device',
          type: 9,
        },
      },
    })
  })

  it('parses the official auth-request password grant extension', () => {
    const form = new URLSearchParams({
      grant_type: 'password',
      username: ' Person@Example.Test ',
      password: 'high-entropy-access-code',
      authRequest: ' auth-request-id ',
      deviceType: '8',
      deviceIdentifier: 'requester-device',
      deviceName: 'Requester',
    })

    expect(parseAuthRequestGrantForm(form)).toEqual({
      ok: true,
      grant: {
        username: 'Person@Example.Test',
        usernameNormalized: 'person@example.test',
        accessCode: 'high-entropy-access-code',
        authRequestId: 'auth-request-id',
        device: {
          identifier: 'requester-device',
          name: 'Requester',
          type: 8,
        },
      },
    })
  })

  it('does not classify ordinary password grants as auth-request grants', () => {
    expect(
      parseAuthRequestGrantForm(
        new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      ),
    ).toEqual({ ok: false, reason: 'not_auth_request' })
  })

  it('accepts alternate two-factor form field names', () => {
    const form = new URLSearchParams({
      grant_type: 'password',
      username: 'person@example.test',
      password: 'synthetic-master-password-hash',
      two_factor_provider: '0',
      two_factor_token: 'challenge-token',
      two_factor_code: '654321',
    })

    expect(parsePasswordGrantForm(form)).toMatchObject({
      ok: true,
      grant: {
        twoFactorProvider: '0',
        twoFactorToken: 'challenge-token',
        twoFactorCode: '654321',
      },
    })
  })

  it('rejects unsupported grants', () => {
    expect(
      parsePasswordGrantForm(
        new URLSearchParams({
          grant_type: 'refresh_token',
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        error: 'unsupported_grant_type',
      },
    })
  })

  it('parses refresh token grant fields', () => {
    expect(
      parseRefreshTokenGrantForm(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      ),
    ).toEqual({
      ok: true,
      grant: {
        refreshToken: 'synthetic-refresh-token',
      },
    })
  })

  it('rejects refresh token grant without refresh token', () => {
    expect(
      parseRefreshTokenGrantForm(
        new URLSearchParams({
          grant_type: 'refresh_token',
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        error: 'invalid_request',
        errorModel: {
          Message: 'Refresh token is required.',
        },
      },
    })
  })

  it('compares presented password hashes without prefix acceptance', () => {
    expect(
      verifyPresentedPasswordHash(
        'synthetic-master-password-hash',
        'synthetic-master-password-hash',
      ),
    ).toBe(true)
    expect(
      verifyPresentedPasswordHash(
        'synthetic-master-password-hash',
        'synthetic-master-password',
      ),
    ).toBe(false)
  })

  it('signs access tokens with a JWT-like compact shape', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      device: 'device-id',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 2,
    })

    expect(token.split('.')).toHaveLength(3)
  })

  it('signs access tokens with a key id when a signing key is configured', async () => {
    const token = await signAccessToken(
      { id: '2026-07-active', secret: 'active-secret' },
      {
        sub: 'user-id',
        email: 'person@example.test',
        device: 'device-id',
        securityStamp: 'security-stamp',
        iat: 1,
        exp: 2,
      },
    )

    expect(decodeSegment(token.split('.')[0])).toMatchObject({
      alg: 'HS256',
      typ: 'JWT',
      kid: '2026-07-active',
    })
  })

  it('verifies signed access tokens', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      device: 'device-id',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 100,
    })

    await expect(verifyAccessToken('secret', token, 2)).resolves.toEqual({
      ok: true,
      claims: {
        sub: 'user-id',
        email: 'person@example.test',
        device: 'device-id',
        securityStamp: 'security-stamp',
        iat: 1,
        exp: 100,
      },
    })
  })

  it('verifies auth-request access-token claims', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      device: 'requester-device',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 100,
      authMethod: 'auth_request',
    })

    await expect(verifyAccessToken('secret', token, 2)).resolves.toMatchObject({
      ok: true,
      claims: { authMethod: 'auth_request' },
    })
  })

  it('verifies active and previous key ids from a staged access-token keyring', async () => {
    const activeToken = await signAccessToken(
      { id: '2026-07-active', secret: 'active-secret' },
      {
        sub: 'active-user-id',
        email: 'person@example.test',
        device: 'device-id',
        securityStamp: 'security-stamp',
        iat: 1,
        exp: 100,
      },
    )
    const previousToken = await signAccessToken(
      { id: '2026-07-previous', secret: 'previous-secret' },
      {
        sub: 'previous-user-id',
        email: 'person@example.test',
        device: 'device-id',
        securityStamp: 'security-stamp',
        iat: 1,
        exp: 100,
      },
    )

    const keyring = {
      active: { id: '2026-07-active', secret: 'active-secret' },
      previous: [{ id: '2026-07-previous', secret: 'previous-secret' }],
    }

    await expect(verifyAccessToken(keyring, activeToken, 2)).resolves.toEqual({
      ok: true,
      keyId: '2026-07-active',
      claims: {
        sub: 'active-user-id',
        email: 'person@example.test',
        device: 'device-id',
        securityStamp: 'security-stamp',
        iat: 1,
        exp: 100,
      },
    })
    await expect(verifyAccessToken(keyring, previousToken, 2)).resolves.toEqual(
      {
        ok: true,
        keyId: '2026-07-previous',
        claims: {
          sub: 'previous-user-id',
          email: 'person@example.test',
          device: 'device-id',
          securityStamp: 'security-stamp',
          iat: 1,
          exp: 100,
        },
      },
    )
  })

  it('keeps legacy no-kid access tokens valid during staged rotation', async () => {
    const legacyToken = await signAccessToken('legacy-secret', {
      sub: 'legacy-user-id',
      email: 'person@example.test',
      device: 'device-id',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 100,
    })

    await expect(
      verifyAccessToken(
        {
          active: { id: '2026-07-active', secret: 'active-secret' },
          previous: [{ id: '2026-07-previous', secret: 'previous-secret' }],
          legacySecrets: ['legacy-secret'],
        },
        legacyToken,
        2,
      ),
    ).resolves.toMatchObject({
      ok: true,
      claims: {
        sub: 'legacy-user-id',
      },
    })
  })

  it('rejects access tokens with unknown key ids', async () => {
    const token = await signAccessToken(
      { id: 'unknown-key', secret: 'active-secret' },
      {
        sub: 'user-id',
        email: 'person@example.test',
        device: 'device-id',
        securityStamp: 'security-stamp',
        iat: 1,
        exp: 100,
      },
    )

    await expect(
      verifyAccessToken(
        {
          active: { id: '2026-07-active', secret: 'active-secret' },
        },
        token,
        2,
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'invalid',
    })
  })

  it('preserves access token auth method claims', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      device: 'device-id',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 100,
      authMethod: 'password',
    })

    await expect(verifyAccessToken('secret', token, 2)).resolves.toMatchObject({
      ok: true,
      claims: {
        authMethod: 'password',
      },
    })
  })

  it('preserves upstream mobile JWT claims required by the Android parser', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      email_verified: true,
      name: 'Person',
      premium: false,
      amr: ['Application'],
      device: 'device-id',
      securityStamp: 'security-stamp',
      sstamp: 'security-stamp',
      iat: 1,
      exp: 100,
      authMethod: 'password',
    })

    expect(decodeSegment(token.split('.')[1])).toMatchObject({
      sub: 'user-id',
      email: 'person@example.test',
      email_verified: true,
      name: 'Person',
      premium: false,
      amr: ['Application'],
      device: 'device-id',
      securityStamp: 'security-stamp',
      sstamp: 'security-stamp',
      authMethod: 'password',
    })
    await expect(verifyAccessToken('secret', token, 2)).resolves.toMatchObject({
      ok: true,
      claims: {
        email_verified: true,
        premium: false,
        amr: ['Application'],
      },
    })
  })

  it('rejects signed access tokens with invalid auth method claims', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      device: 'device-id',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 100,
      authMethod: 'api-key' as 'password',
    })

    await expect(verifyAccessToken('secret', token, 2)).resolves.toEqual({
      ok: false,
      code: 'invalid',
    })
  })

  it('rejects access tokens with invalid signatures', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      device: 'device-id',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 100,
    })

    await expect(verifyAccessToken('wrong-secret', token, 2)).resolves.toEqual({
      ok: false,
      code: 'invalid',
    })
  })

  it('rejects expired access tokens', async () => {
    const token = await signAccessToken('secret', {
      sub: 'user-id',
      email: 'person@example.test',
      device: 'device-id',
      securityStamp: 'security-stamp',
      iat: 1,
      exp: 2,
    })

    await expect(verifyAccessToken('secret', token, 2)).resolves.toEqual({
      ok: false,
      code: 'expired',
    })
  })

  it('generates refresh tokens and hashes them without storing plaintext', async () => {
    const token = generateRefreshToken()
    const hash = await hashRefreshToken('secret', token)

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(hash).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(hash).not.toBe(token)
    await expect(hashRefreshToken('secret', token)).resolves.toBe(hash)
  })

  it('maps token errors to the expected response shape', () => {
    expect(
      tokenErrorResponse({
        error: 'invalid_grant',
        errorModel: {
          Message: 'Invalid username or password.',
          Object: 'error',
        },
      }),
    ).toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })
})

function decodeSegment(value: string | undefined): Record<string, unknown> {
  expect(value).toBeDefined()

  return JSON.parse(Buffer.from(value ?? '', 'base64url').toString('utf8')) as
    Record<string, unknown> | never
}
