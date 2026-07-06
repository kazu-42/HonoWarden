import { describe, expect, it } from 'vitest'

import {
  generateRefreshToken,
  hashRefreshToken,
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
        twoFactorProvider: 'authenticator',
        twoFactorToken: 'challenge-token',
        twoFactorCode: '123456',
      },
    })
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
