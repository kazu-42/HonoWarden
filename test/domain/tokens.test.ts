import { describe, expect, it } from 'vitest'

import {
  generateRefreshToken,
  hashRefreshToken,
  parsePasswordGrantForm,
  signAccessToken,
  tokenErrorResponse,
  verifyPresentedPasswordHash,
} from '../../src/domain/tokens'

describe('token domain', () => {
  it('parses password grant form fields', () => {
    const form = new URLSearchParams({
      grant_type: 'password',
      username: ' Person@Example.Test ',
      password: ' synthetic-master-password-hash ',
      scope: 'api offline_access',
    })

    expect(parsePasswordGrantForm(form)).toEqual({
      ok: true,
      grant: {
        username: 'Person@Example.Test',
        usernameNormalized: 'person@example.test',
        password: 'synthetic-master-password-hash',
        scope: 'api offline_access',
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
