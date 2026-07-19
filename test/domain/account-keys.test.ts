import { describe, expect, it } from 'vitest'

import {
  accountKeyPolicy,
  accountKeyPairsEqual,
  classifyAccountKeyState,
  isAccountKeyInitializationEnabled,
  parseAccountKeyInitializationBody,
} from '../../src/domain/account-keys'

describe('account key domain', () => {
  it('keeps account-key routes disabled unless the rollout flag is exact true', () => {
    expect(isAccountKeyInitializationEnabled(undefined)).toBe(false)
    expect(isAccountKeyInitializationEnabled('')).toBe(false)
    expect(isAccountKeyInitializationEnabled('false')).toBe(false)
    expect(isAccountKeyInitializationEnabled('yes')).toBe(false)
    expect(isAccountKeyInitializationEnabled(' TRUE ')).toBe(true)
  })

  it('parses the pinned camel-case and Pascal-case V1 envelopes', () => {
    expect(
      parseAccountKeyInitializationBody({
        publicKey: 'synthetic-public-key',
        encryptedPrivateKey: '2.synthetic-wrapped-private-key',
      }),
    ).toEqual({
      ok: true,
      keyPair: {
        publicKey: 'synthetic-public-key',
        wrappedPrivateKey: '2.synthetic-wrapped-private-key',
      },
    })
    expect(
      parseAccountKeyInitializationBody({
        PublicKey: 'synthetic-public-key',
        EncryptedPrivateKey: '2.synthetic-wrapped-private-key',
      }),
    ).toEqual({
      ok: true,
      keyPair: {
        publicKey: 'synthetic-public-key',
        wrappedPrivateKey: '2.synthetic-wrapped-private-key',
      },
    })
  })

  it('accepts exact duplicate aliases and rejects conflicting aliases', () => {
    expect(
      parseAccountKeyInitializationBody({
        publicKey: 'synthetic-public-key',
        PublicKey: 'synthetic-public-key',
        encryptedPrivateKey: '2.synthetic-wrapped-private-key',
        EncryptedPrivateKey: '2.synthetic-wrapped-private-key',
      }),
    ).toMatchObject({ ok: true })

    expect(
      parseAccountKeyInitializationBody({
        publicKey: 'first-public-key',
        PublicKey: 'different-public-key',
        encryptedPrivateKey: '2.synthetic-wrapped-private-key',
      }),
    ).toEqual({ ok: false })
    expect(
      parseAccountKeyInitializationBody({
        publicKey: 'synthetic-public-key',
        encryptedPrivateKey: '2.first-wrapped-private-key',
        EncryptedPrivateKey: '2.different-wrapped-private-key',
      }),
    ).toEqual({ ok: false })
  })

  it('rejects missing, partial, padded, controlled, oversized, and unknown input', () => {
    const oversizedPublicKey = 'p'.repeat(
      accountKeyPolicy.publicKeyMaxLength + 1,
    )
    const oversizedPrivateKey = 'k'.repeat(
      accountKeyPolicy.wrappedPrivateKeyMaxLength + 1,
    )

    for (const body of [
      null,
      [],
      {},
      { publicKey: 'synthetic-public-key' },
      { encryptedPrivateKey: '2.synthetic-wrapped-private-key' },
      {
        publicKey: ' synthetic-public-key',
        encryptedPrivateKey: '2.synthetic-wrapped-private-key',
      },
      {
        publicKey: 'synthetic-public-key',
        encryptedPrivateKey: '2.synthetic-wrapped-private-key\n',
      },
      {
        publicKey: oversizedPublicKey,
        encryptedPrivateKey: '2.synthetic-wrapped-private-key',
      },
      {
        publicKey: 'synthetic-public-key',
        encryptedPrivateKey: oversizedPrivateKey,
      },
      {
        publicKey: 'synthetic-public-key',
        encryptedPrivateKey: '2.synthetic-wrapped-private-key',
        unexpected: true,
      },
      {
        publicKey: 'synthetic-public-key',
        encryptedPrivateKey: '2.synthetic-wrapped-private-key',
        privateKey: 'plaintext-shaped-unsupported-field',
      },
    ]) {
      expect(parseAccountKeyInitializationBody(body)).toEqual({ ok: false })
    }
  })

  it('rejects every pinned V2 account-key field before mutation', () => {
    for (const field of [
      'accountKeys',
      'AccountKeys',
      'signatureKeyPair',
      'publicKeyEncryptionKeyPair',
      'securityState',
      'signedPublicKey',
    ]) {
      expect(
        parseAccountKeyInitializationBody({
          publicKey: 'synthetic-public-key',
          encryptedPrivateKey: '2.synthetic-wrapped-private-key',
          [field]: null,
        }),
      ).toEqual({ ok: false })
    }
  })

  it('accepts both opaque values at their inclusive maximum lengths', () => {
    const publicKey = 'p'.repeat(accountKeyPolicy.publicKeyMaxLength)
    const wrappedPrivateKey = 'k'.repeat(
      accountKeyPolicy.wrappedPrivateKeyMaxLength,
    )

    expect(
      parseAccountKeyInitializationBody({
        publicKey,
        encryptedPrivateKey: wrappedPrivateKey,
      }),
    ).toEqual({
      ok: true,
      keyPair: { publicKey, wrappedPrivateKey },
    })
  })

  it('classifies only both-null as missing and only two valid values as complete', () => {
    expect(
      classifyAccountKeyState({ publicKey: null, privateKey: null }),
    ).toEqual({ status: 'missing' })
    expect(
      classifyAccountKeyState({
        publicKey: 'synthetic-public-key',
        privateKey: '2.synthetic-wrapped-private-key',
      }),
    ).toEqual({
      status: 'complete',
      keyPair: {
        publicKey: 'synthetic-public-key',
        wrappedPrivateKey: '2.synthetic-wrapped-private-key',
      },
    })

    for (const state of [
      { publicKey: 'synthetic-public-key', privateKey: null },
      { publicKey: null, privateKey: '2.synthetic-wrapped-private-key' },
      { publicKey: '', privateKey: '' },
      { publicKey: ' padded', privateKey: '2.synthetic-wrapped-private-key' },
      {
        publicKey: 'synthetic-public-key',
        privateKey: '2.controlled\u0000private-key',
      },
    ]) {
      expect(classifyAccountKeyState(state)).toEqual({ status: 'invalid' })
    }
  })

  it('compares both opaque account-key values exactly', () => {
    const pair = {
      publicKey: 'synthetic-public-key',
      wrappedPrivateKey: '2.synthetic-wrapped-private-key',
    }

    expect(accountKeyPairsEqual(pair, pair)).toBe(true)
    expect(
      accountKeyPairsEqual(pair, {
        ...pair,
        publicKey: 'different-public-key',
      }),
    ).toBe(false)
    expect(
      accountKeyPairsEqual(pair, {
        ...pair,
        wrappedPrivateKey: '2.different-wrapped-private-key',
      }),
    ).toBe(false)
  })
})
