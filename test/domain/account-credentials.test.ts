import { describe, expect, it } from 'vitest'

import {
  accountCredentialKdfPolicy,
  accountCredentialPolicy,
  isKdfMutationEnabled,
  matchesKdfChangeCredentialGeneration,
  matchesPasswordChangeCredentialGeneration,
  nextCredentialRevisionDate,
  parseCurrentPasswordProofBody,
  parseKdfChangeBody,
  parseMasterPasswordChangeBody,
  parseSecurityStampRotationBody,
} from '../../src/domain/account-credentials'

describe('account credential domain', () => {
  it('keeps KDF mutation disabled unless the rollout flag is exact true', () => {
    expect(isKdfMutationEnabled(undefined)).toBe(false)
    expect(isKdfMutationEnabled('')).toBe(false)
    expect(isKdfMutationEnabled('false')).toBe(false)
    expect(isKdfMutationEnabled('yes')).toBe(false)
    expect(isKdfMutationEnabled(' TRUE ')).toBe(true)
  })

  it('parses the official camel-case and Pascal-case security-stamp proofs', () => {
    expect(
      parseSecurityStampRotationBody({
        masterPasswordHash: 'synthetic-authentication-hash',
      }),
    ).toEqual({
      ok: true,
      masterPasswordHash: 'synthetic-authentication-hash',
    })
    expect(
      parseSecurityStampRotationBody({
        MasterPasswordHash: 'synthetic-authentication-hash',
      }),
    ).toEqual({
      ok: true,
      masterPasswordHash: 'synthetic-authentication-hash',
    })
  })

  it('rejects missing, conflicting, unsupported, padded, and oversized proofs', () => {
    const oversized = 'a'.repeat(
      accountCredentialPolicy.authenticationHashMaxLength + 1,
    )

    for (const body of [
      null,
      {},
      { masterPasswordHash: '' },
      { masterPasswordHash: ' padded-hash ' },
      { masterPasswordHash: 'hash\nvalue' },
      { masterPasswordHash: oversized },
      {
        masterPasswordHash: 'first-hash',
        MasterPasswordHash: 'different-hash',
      },
      { masterPasswordHash: 'hash', otp: 'unsupported-otp' },
    ]) {
      expect(parseSecurityStampRotationBody(body)).toEqual({ ok: false })
    }
  })

  it('accepts an exact duplicate alias without changing the proof', () => {
    expect(
      parseSecurityStampRotationBody({
        masterPasswordHash: 'same-hash',
        MasterPasswordHash: 'same-hash',
      }),
    ).toEqual({ ok: true, masterPasswordHash: 'same-hash' })
  })

  it('uses the same strict current-hash proof contract for verification', () => {
    expect(
      parseCurrentPasswordProofBody({
        MasterPasswordHash: 'synthetic-current-hash',
      }),
    ).toEqual({
      ok: true,
      masterPasswordHash: 'synthetic-current-hash',
    })
    expect(
      parseCurrentPasswordProofBody({
        masterPasswordHash: 'synthetic-current-hash',
        otp: 'unsupported-proof',
      }),
    ).toEqual({ ok: false })
  })

  it('parses the pinned structured and dual password-change payloads', () => {
    const structured = structuredPasswordChangeBody()
    const expected = {
      ok: true,
      currentMasterPasswordHash: 'synthetic-current-hash',
      nextMasterPasswordHash: 'synthetic-next-hash',
      nextUserKey: '2.synthetic-next-wrapped-user-key',
      credentialMetadata: {
        salt: 'person@example.test',
        kdf: {
          kdfType: 0,
          iterations: 600000,
          memory: null,
          parallelism: null,
        },
      },
      variant: 'structured',
    }

    expect(parseMasterPasswordChangeBody(structured)).toEqual(expected)
    expect(
      parseMasterPasswordChangeBody({
        ...structured,
        newMasterPasswordHash: 'synthetic-next-hash',
        key: '2.synthetic-next-wrapped-user-key',
      }),
    ).toEqual({ ...expected, variant: 'dual' })
  })

  it('accepts the transitional legacy-only password-change payload', () => {
    expect(
      parseMasterPasswordChangeBody({
        masterPasswordHash: 'synthetic-current-hash',
        newMasterPasswordHash: 'synthetic-next-hash',
        key: '2.synthetic-next-wrapped-user-key',
        masterPasswordHint: '',
      }),
    ).toEqual({
      ok: true,
      currentMasterPasswordHash: 'synthetic-current-hash',
      nextMasterPasswordHash: 'synthetic-next-hash',
      nextUserKey: '2.synthetic-next-wrapped-user-key',
      credentialMetadata: null,
      variant: 'legacy',
    })
  })

  it('treats nullable alternative password representations as absent', () => {
    const structured = structuredPasswordChangeBody()

    expect(
      parseMasterPasswordChangeBody({
        ...structured,
        newMasterPasswordHash: null,
        key: null,
      }),
    ).toMatchObject({
      ok: true,
      variant: 'structured',
    })
    expect(
      parseMasterPasswordChangeBody({
        masterPasswordHash: 'synthetic-current-hash',
        newMasterPasswordHash: 'synthetic-next-hash',
        key: '2.synthetic-next-wrapped-user-key',
        authenticationData: null,
        unlockData: null,
        masterPasswordHint: null,
      }),
    ).toEqual({
      ok: true,
      currentMasterPasswordHash: 'synthetic-current-hash',
      nextMasterPasswordHash: 'synthetic-next-hash',
      nextUserKey: '2.synthetic-next-wrapped-user-key',
      credentialMetadata: null,
      variant: 'legacy',
    })
  })

  it('rejects partial, contradictory, drifted, hinted, and oversized payloads', () => {
    const structured = structuredPasswordChangeBody()
    const oversizedKey = 'k'.repeat(
      accountCredentialPolicy.wrappedUserKeyMaxLength + 1,
    )

    for (const body of [
      null,
      {},
      { masterPasswordHash: 'synthetic-current-hash' },
      { ...structured, unlockData: undefined },
      { ...structured, newMasterPasswordHash: 'synthetic-next-hash' },
      {
        ...structured,
        newMasterPasswordHash: 'contradictory-next-hash',
        key: '2.synthetic-next-wrapped-user-key',
      },
      {
        ...structured,
        newMasterPasswordHash: 'synthetic-next-hash',
        key: '2.contradictory-wrapped-user-key',
      },
      {
        ...structured,
        authenticationData: {
          ...structured.authenticationData,
          salt: 'different@example.test',
        },
      },
      {
        ...structured,
        unlockData: {
          ...structured.unlockData,
          kdf: { kdfType: 0, iterations: 600001 },
        },
      },
      { ...structured, masterPasswordHint: 'do not silently discard this' },
      {
        masterPasswordHash: 'synthetic-current-hash',
        newMasterPasswordHash: 'synthetic-next-hash',
        key: oversizedKey,
      },
    ]) {
      expect(parseMasterPasswordChangeBody(body)).toEqual({ ok: false })
    }
  })

  it('requires structured salt and KDF to match the existing generation', () => {
    const parsed = parseMasterPasswordChangeBody(structuredPasswordChangeBody())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      throw new Error('fixture must parse')
    }
    const generation = {
      emailNormalized: 'person@example.test',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    }

    expect(matchesPasswordChangeCredentialGeneration(parsed, generation)).toBe(
      true,
    )
    expect(
      matchesPasswordChangeCredentialGeneration(parsed, {
        ...generation,
        emailNormalized: 'changed@example.test',
      }),
    ).toBe(false)
    expect(
      matchesPasswordChangeCredentialGeneration(parsed, {
        ...generation,
        kdfIterations: 600001,
      }),
    ).toBe(false)
  })

  it.each([
    [
      'PBKDF2 minimum iterations',
      pbkdf2Kdf(accountCredentialKdfPolicy.pbkdf2Iterations.min),
    ],
    [
      'PBKDF2 maximum iterations',
      pbkdf2Kdf(accountCredentialKdfPolicy.pbkdf2Iterations.max),
    ],
    [
      'Argon2id minimum iterations',
      argon2idKdf({
        iterations: accountCredentialKdfPolicy.argon2Iterations.min,
      }),
    ],
    [
      'Argon2id maximum iterations',
      argon2idKdf({
        iterations: accountCredentialKdfPolicy.argon2Iterations.max,
      }),
    ],
    [
      'Argon2id minimum memory',
      argon2idKdf({ memory: accountCredentialKdfPolicy.argon2Memory.min }),
    ],
    [
      'Argon2id maximum memory',
      argon2idKdf({ memory: accountCredentialKdfPolicy.argon2Memory.max }),
    ],
    [
      'Argon2id minimum parallelism',
      argon2idKdf({
        parallelism: accountCredentialKdfPolicy.argon2Parallelism.min,
      }),
    ],
    [
      'Argon2id maximum parallelism',
      argon2idKdf({
        parallelism: accountCredentialKdfPolicy.argon2Parallelism.max,
      }),
    ],
  ] as const)('accepts the inclusive %s boundary', (_name, kdf) => {
    expect(parseKdfChangeBody(kdfChangeBody(kdf))).toEqual({
      ok: true,
      currentMasterPasswordHash: 'synthetic-current-hash',
      nextMasterPasswordHash: 'synthetic-next-hash',
      nextUserKey: '2.synthetic-next-wrapped-user-key',
      credentialMetadata: {
        salt: 'person@example.test',
        kdf,
      },
    })
  })

  it.each([
    [
      'PBKDF2 below minimum',
      pbkdf2Kdf(accountCredentialKdfPolicy.pbkdf2Iterations.min - 1),
    ],
    [
      'PBKDF2 above maximum',
      pbkdf2Kdf(accountCredentialKdfPolicy.pbkdf2Iterations.max + 1),
    ],
    [
      'Argon2id below minimum iterations',
      argon2idKdf({
        iterations: accountCredentialKdfPolicy.argon2Iterations.min - 1,
      }),
    ],
    [
      'Argon2id above maximum iterations',
      argon2idKdf({
        iterations: accountCredentialKdfPolicy.argon2Iterations.max + 1,
      }),
    ],
    [
      'Argon2id below minimum memory',
      argon2idKdf({ memory: accountCredentialKdfPolicy.argon2Memory.min - 1 }),
    ],
    [
      'Argon2id server-only memory minimum rejected by the pinned client',
      argon2idKdf({ memory: 15 }),
    ],
    [
      'Argon2id above maximum memory',
      argon2idKdf({ memory: accountCredentialKdfPolicy.argon2Memory.max + 1 }),
    ],
    [
      'Argon2id below minimum parallelism',
      argon2idKdf({
        parallelism: accountCredentialKdfPolicy.argon2Parallelism.min - 1,
      }),
    ],
    [
      'Argon2id above maximum parallelism',
      argon2idKdf({
        parallelism: accountCredentialKdfPolicy.argon2Parallelism.max + 1,
      }),
    ],
    ['Argon2id missing memory', { kdfType: 1, iterations: 6, parallelism: 4 }],
    ['Argon2id missing parallelism', { kdfType: 1, iterations: 6, memory: 32 }],
    ['unknown algorithm', { kdfType: 2, iterations: 600000 }],
  ] as const)('rejects %s without producing a generation', (_name, kdf) => {
    expect(parseKdfChangeBody(kdfChangeBody(kdf))).toEqual({ ok: false })
  })

  it('rejects mixed KDF data, salt drift, and unsupported proof alternatives', () => {
    const body = kdfChangeBody(argon2idKdf())

    for (const candidate of [
      {
        ...body,
        unlockData: {
          ...body.unlockData,
          kdf: pbkdf2Kdf(600000),
        },
      },
      {
        ...body,
        unlockData: {
          ...body.unlockData,
          salt: 'different@example.test',
        },
      },
      { ...body, otp: 'unsupported-proof' },
      { ...body, authRequestAccessCode: 'unsupported-proof' },
    ]) {
      expect(parseKdfChangeBody(candidate)).toEqual({ ok: false })
    }
  })

  it('requires unchanged account salt and a supported stored KDF generation', () => {
    const parsed = parseKdfChangeBody(kdfChangeBody(argon2idKdf()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      throw new Error('fixture must parse')
    }
    const generation = {
      emailNormalized: 'person@example.test',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    }

    expect(matchesKdfChangeCredentialGeneration(parsed, generation)).toBe(true)
    expect(
      matchesKdfChangeCredentialGeneration(parsed, {
        ...generation,
        emailNormalized: 'changed@example.test',
      }),
    ).toBe(false)
    expect(
      matchesKdfChangeCredentialGeneration(parsed, {
        ...generation,
        kdfAlgorithm: 'unknown-kdf',
      }),
    ).toBe(false)
    expect(
      matchesKdfChangeCredentialGeneration(parsed, {
        ...generation,
        kdfAlgorithm: 'argon2id',
        kdfMemory: null,
        kdfParallelism: null,
      }),
    ).toBe(false)
  })

  it('advances account revision monotonically even within the same millisecond', () => {
    expect(
      nextCredentialRevisionDate(
        '2026-07-19T00:00:00.000Z',
        '2026-07-19T00:00:00.000Z',
      ),
    ).toBe('2026-07-19T00:00:00.001Z')
    expect(
      nextCredentialRevisionDate(
        '2026-07-19T00:00:00.000Z',
        '2026-07-19T00:00:01.000Z',
      ),
    ).toBe('2026-07-19T00:00:01.000Z')
  })
})

function structuredPasswordChangeBody() {
  const kdf = {
    kdfType: 0,
    iterations: 600000,
    memory: null,
    parallelism: null,
  }
  return {
    masterPasswordHash: 'synthetic-current-hash',
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: 'synthetic-next-hash',
      salt: 'person@example.test',
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: '2.synthetic-next-wrapped-user-key',
      salt: 'person@example.test',
    },
    masterPasswordHint: null,
  }
}

function kdfChangeBody(kdf: Record<string, unknown>) {
  return {
    masterPasswordHash: 'synthetic-current-hash',
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: 'synthetic-next-hash',
      salt: 'person@example.test',
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: '2.synthetic-next-wrapped-user-key',
      salt: 'person@example.test',
    },
  }
}

function pbkdf2Kdf(iterations: number) {
  return {
    kdfType: 0 as const,
    iterations,
    memory: null,
    parallelism: null,
  }
}

function argon2idKdf(
  overrides: Partial<{
    iterations: number
    memory: number
    parallelism: number
  }> = {},
) {
  return {
    kdfType: 1 as const,
    iterations: overrides.iterations ?? 6,
    memory: overrides.memory ?? 32,
    parallelism: overrides.parallelism ?? 4,
  }
}
