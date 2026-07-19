import { describe, expect, it } from 'vitest'

import {
  buildPreloginKdfResponse,
  normalizeEmail,
  parseAllowedEmails,
  resolvePrelogin,
} from '../../src/domain/prelogin'

describe('prelogin domain', () => {
  it('normalizes email addresses for allowlist matching', () => {
    expect(normalizeEmail(' Person@Example.Test ')).toBe('person@example.test')
    expect(normalizeEmail('missing-at')).toBeNull()
  })

  it('parses comma and whitespace separated allowed emails', () => {
    expect(
      parseAllowedEmails(
        'alice@example.test, Bob@Example.Test\ncarol@example.test',
      ),
    ).toEqual(
      new Set(['alice@example.test', 'bob@example.test', 'carol@example.test']),
    )
  })

  it('returns KDF parameters for an allowed email', () => {
    expect(
      resolvePrelogin({ email: 'Person@Example.Test' }, 'person@example.test'),
    ).toEqual({
      ok: true,
      response: {
        kdf: 0,
        kdfIterations: 600000,
        kdfMemory: null,
        kdfParallelism: null,
      },
    })
  })

  it('denies prelogin by default', () => {
    expect(
      resolvePrelogin({ email: 'person@example.test' }, undefined),
    ).toEqual({
      ok: false,
      status: 403,
      error: {
        code: 'prelogin_not_allowed',
        message: 'Prelogin is not available for this account.',
      },
    })
  })

  it('rejects malformed requests', () => {
    expect(resolvePrelogin({ email: '' }, 'person@example.test')).toEqual({
      ok: false,
      status: 400,
      error: {
        code: 'invalid_request',
        message: 'A valid email is required.',
      },
    })
  })

  it('projects an exact known Argon2id generation in legacy and current shapes', async () => {
    expect(
      await buildPreloginKdfResponse(
        'person@example.test',
        {
          emailNormalized: 'person@example.test',
          kdfAlgorithm: 'argon2id',
          kdfIterations: 6,
          kdfMemory: 32,
          kdfParallelism: 4,
        },
        'test-token-secret',
      ),
    ).toEqual({
      kdf: 1,
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      kdfSettings: {
        kdfType: 1,
        iterations: 6,
        memory: 32,
        parallelism: 4,
      },
      salt: 'person@example.test',
    })
  })

  it('uses an email-stable secret-keyed synthetic generation for an unknown allowed account', async () => {
    const first = await buildPreloginKdfResponse(
      'unknown@example.test',
      null,
      'test-token-secret',
    )
    expect(first).toEqual(
      await buildPreloginKdfResponse(
        'unknown@example.test',
        null,
        'test-token-secret',
      ),
    )
    expect(first).toEqual({
      kdf: 1,
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      kdfSettings: {
        kdfType: 1,
        iterations: 6,
        memory: 32,
        parallelism: 4,
      },
      salt: 'unknown@example.test',
    })
    await expect(
      buildPreloginKdfResponse(
        'unknown@example.test',
        null,
        'prelogin-secret-one',
      ),
    ).resolves.toMatchObject({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    })
  })

  it('refuses to project an invalid stored KDF generation', async () => {
    expect(
      await buildPreloginKdfResponse(
        'person@example.test',
        {
          emailNormalized: 'person@example.test',
          kdfAlgorithm: 'unknown-kdf',
          kdfIterations: 600000,
          kdfMemory: null,
          kdfParallelism: null,
        },
        'test-token-secret',
      ),
    ).toBeNull()
  })
})
