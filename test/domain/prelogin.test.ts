import { describe, expect, it } from 'vitest'

import type { AccountCredentialGeneration } from '../../src/domain/account-credentials'
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
    const generation = {
      emailNormalized: 'person@example.test',
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
    }
    expect(
      await buildPreloginKdfResponse(
        'person@example.test',
        preloginContext(generation, [distributionEntry(generation, 1)]),
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
    const context = preloginContext(null, [
      distributionEntry(pbkdf2Generation(600000), 1_000_000),
      distributionEntry(argon2idGeneration(4, 64, 4), 1),
    ])
    const first = await buildPreloginKdfResponse(
      'unknown@example.test',
      context,
      'test-token-secret',
    )
    expect(first).toEqual(
      await buildPreloginKdfResponse(
        'unknown@example.test',
        context,
        'test-token-secret',
      ),
    )
    expect(first).toEqual({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      kdfSettings: {
        kdfType: 0,
        iterations: 600000,
        memory: null,
        parallelism: null,
      },
      salt: 'unknown@example.test',
    })
  })

  it('covers every readable legacy and non-preset tuple present in storage', async () => {
    await expect(
      buildPreloginKdfResponse(
        'legacy@example.test',
        preloginContext(null, [distributionEntry(pbkdf2Generation(100000), 1)]),
        'test-token-secret',
      ),
    ).resolves.toMatchObject({
      kdf: 0,
      kdfIterations: 100000,
      kdfMemory: null,
      kdfParallelism: null,
    })
    await expect(
      buildPreloginKdfResponse(
        'pbkdf-nonpreset@example.test',
        preloginContext(null, [distributionEntry(pbkdf2Generation(700000), 1)]),
        'test-token-secret',
      ),
    ).resolves.toMatchObject({
      kdf: 0,
      kdfIterations: 700000,
      kdfMemory: null,
      kdfParallelism: null,
    })
    await expect(
      buildPreloginKdfResponse(
        'argon-nonpreset@example.test',
        preloginContext(null, [
          distributionEntry(argon2idGeneration(5, 48, 3), 1),
        ]),
        'test-token-secret',
      ),
    ).resolves.toMatchObject({
      kdf: 1,
      kdfIterations: 5,
      kdfMemory: 48,
      kdfParallelism: 3,
    })
  })

  it('selects only observed resource profiles instead of validation maxima', async () => {
    const defaultGeneration = pbkdf2Generation(600000)
    const practicalArgon = argon2idGeneration(4, 64, 4)
    const context = preloginContext(null, [
      distributionEntry(defaultGeneration, 3),
      distributionEntry(practicalArgon, 1),
    ])
    const observed = new Set(['0:600000:null:null', '1:4:64:4'])
    const responses = await Promise.all(
      Array.from({ length: 256 }, (_, index) =>
        buildPreloginKdfResponse(
          `unknown-${index}@example.test`,
          context,
          'test-token-secret',
        ),
      ),
    )

    for (const response of responses) {
      expect(response).not.toBeNull()
      if (response) {
        expect(
          observed.has(
            `${response.kdf}:${response.kdfIterations}:${response.kdfMemory}:${response.kdfParallelism}`,
          ),
        ).toBe(true)
        expect(response.kdfMemory ?? 0).toBeLessThanOrEqual(64)
      }
    }
    const pbkdf2Count = responses.filter(
      (response) => response?.kdf === 0,
    ).length
    const argon2Count = responses.length - pbkdf2Count
    expect(pbkdf2Count).toBeGreaterThan(argon2Count * 2)
  })

  it('keeps weighted selection stable when grouped rows arrive in another order', async () => {
    const entries = [
      distributionEntry(pbkdf2Generation(600000), 12),
      distributionEntry(pbkdf2Generation(700000), 3),
      distributionEntry(argon2idGeneration(4, 64, 4), 1),
    ]

    await expect(
      buildPreloginKdfResponse(
        'stable@example.test',
        preloginContext(null, entries),
        'test-token-secret',
      ),
    ).resolves.toEqual(
      await buildPreloginKdfResponse(
        'stable@example.test',
        preloginContext(null, [...entries].reverse()),
        'test-token-secret',
      ),
    )
  })

  it('uses the bootstrap default only while the stored distribution is empty', async () => {
    await expect(
      buildPreloginKdfResponse(
        'first-account@example.test',
        preloginContext(null, []),
        'test-token-secret',
      ),
    ).resolves.toMatchObject({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    })
  })

  it('refuses invalid or internally inconsistent stored KDF context', async () => {
    expect(
      await buildPreloginKdfResponse(
        'person@example.test',
        preloginContext(
          {
            emailNormalized: 'person@example.test',
            kdfAlgorithm: 'unknown-kdf',
            kdfIterations: 600000,
            kdfMemory: null,
            kdfParallelism: null,
          },
          [distributionEntry(pbkdf2Generation(600000), 1)],
        ),
        'test-token-secret',
      ),
    ).toBeNull()
    await expect(
      buildPreloginKdfResponse(
        'person@example.test',
        preloginContext(pbkdf2Generation(700000, 'person@example.test'), [
          distributionEntry(pbkdf2Generation(600000), 1),
        ]),
        'test-token-secret',
      ),
    ).resolves.toBeNull()
    await expect(
      buildPreloginKdfResponse(
        'unknown@example.test',
        preloginContext(null, [
          distributionEntry(pbkdf2Generation(600000), 0),
          {
            kdfAlgorithm: 'unknown-kdf',
            kdfIterations: 600000,
            kdfMemory: null,
            kdfParallelism: null,
            accountCount: 1,
          },
          distributionEntry(pbkdf2Generation(100000), 2),
        ]),
        'test-token-secret',
      ),
    ).resolves.toMatchObject({
      kdf: 0,
      kdfIterations: 100000,
      kdfMemory: null,
      kdfParallelism: null,
    })

    await expect(
      buildPreloginKdfResponse(
        'unknown@example.test',
        preloginContext(null, [
          distributionEntry(pbkdf2Generation(4999), 1),
          distributionEntry(argon2idGeneration(2, 15, 1), 1),
        ]),
        'test-token-secret',
      ),
    ).resolves.toMatchObject({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    })
  })
})

function preloginContext(
  target: AccountCredentialGeneration | null,
  distribution: DistributionEntry[],
) {
  return { target, distribution }
}

function distributionEntry(
  generation: AccountCredentialGeneration,
  accountCount: number,
): DistributionEntry {
  return {
    kdfAlgorithm: generation.kdfAlgorithm,
    kdfIterations: generation.kdfIterations,
    kdfMemory: generation.kdfMemory,
    kdfParallelism: generation.kdfParallelism,
    accountCount,
  }
}

function pbkdf2Generation(
  iterations: number,
  emailNormalized = 'distribution@example.test',
): AccountCredentialGeneration {
  return {
    emailNormalized,
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: iterations,
    kdfMemory: null,
    kdfParallelism: null,
  }
}

function argon2idGeneration(
  iterations: number,
  memory: number,
  parallelism: number,
  emailNormalized = 'distribution@example.test',
): AccountCredentialGeneration {
  return {
    emailNormalized,
    kdfAlgorithm: 'argon2id',
    kdfIterations: iterations,
    kdfMemory: memory,
    kdfParallelism: parallelism,
  }
}

type DistributionEntry = Omit<
  AccountCredentialGeneration,
  'emailNormalized'
> & {
  accountCount: number
}
