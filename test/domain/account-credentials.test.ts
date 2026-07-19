import { describe, expect, it } from 'vitest'

import {
  accountCredentialPolicy,
  matchesPasswordChangeCredentialGeneration,
  nextCredentialRevisionDate,
  parseCurrentPasswordProofBody,
  parseMasterPasswordChangeBody,
  parseSecurityStampRotationBody,
} from '../../src/domain/account-credentials'

describe('account credential domain', () => {
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
