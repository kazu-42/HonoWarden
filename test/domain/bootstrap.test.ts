import { describe, expect, it } from 'vitest'

import {
  buildBootstrapUserRecord,
  isBootstrapEnabled,
  resolveBootstrapAccount,
  verifyBootstrapToken,
} from '../../src/domain/bootstrap'

describe('bootstrap domain', () => {
  it('keeps bootstrap disabled unless explicitly enabled', () => {
    expect(isBootstrapEnabled(undefined)).toBe(false)
    expect(isBootstrapEnabled('false')).toBe(false)
    expect(isBootstrapEnabled('true')).toBe(true)
    expect(isBootstrapEnabled('1')).toBe(true)
  })

  it('requires the configured bootstrap token', () => {
    expect(verifyBootstrapToken(undefined, 'presented')).toBe(false)
    expect(verifyBootstrapToken('expected', undefined)).toBe(false)
    expect(verifyBootstrapToken('expected', 'wrong')).toBe(false)
    expect(verifyBootstrapToken('expected', 'expected')).toBe(true)
  })

  it('validates and normalizes an allowed bootstrap account payload', () => {
    expect(
      resolveBootstrapAccount(
        {
          email: ' Person@Example.Test ',
          displayName: ' Person ',
          masterPasswordHash: 'synthetic-master-password-hash',
          userKey: '2.synthetic-user-key',
        },
        'person@example.test',
      ),
    ).toEqual({
      ok: true,
      payload: {
        email: 'Person@Example.Test',
        emailNormalized: 'person@example.test',
        displayName: 'Person',
        masterPasswordHash: 'synthetic-master-password-hash',
        userKey: '2.synthetic-user-key',
        publicKey: null,
        privateKey: null,
      },
    })
  })

  it('denies bootstrap outside the allowlist', () => {
    expect(
      resolveBootstrapAccount(
        {
          email: 'person@example.test',
          masterPasswordHash: 'synthetic-master-password-hash',
        },
        '',
      ),
    ).toEqual({
      ok: false,
      status: 403,
      error: {
        code: 'bootstrap_not_allowed',
        message: 'Bootstrap is not available for this account.',
      },
    })
  })

  it('rejects malformed bootstrap payloads', () => {
    expect(
      resolveBootstrapAccount(
        {
          email: 'person@example.test',
        },
        'person@example.test',
      ),
    ).toEqual({
      ok: false,
      status: 400,
      error: {
        code: 'invalid_request',
        message: 'A valid bootstrap account payload is required.',
      },
    })
  })

  it.each([
    {
      publicKey: 'synthetic-public-key',
    },
    {
      privateKey: '2.synthetic-wrapped-private-key',
    },
    {
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-wrapped-private-key',
    },
  ])('rejects an incomplete bootstrap key envelope', (keys) => {
    expect(
      resolveBootstrapAccount(
        {
          email: 'person@example.test',
          masterPasswordHash: 'synthetic-master-password-hash',
          ...keys,
        },
        'person@example.test',
      ),
    ).toEqual({
      ok: false,
      status: 400,
      error: {
        code: 'invalid_request',
        message: 'A valid bootstrap account payload is required.',
      },
    })
  })

  it('accepts a complete bootstrap key envelope with its wrapped user key', () => {
    expect(
      resolveBootstrapAccount(
        {
          email: 'person@example.test',
          masterPasswordHash: 'synthetic-master-password-hash',
          userKey: '2.synthetic-user-key',
          publicKey: 'synthetic-public-key',
          privateKey: '2.synthetic-wrapped-private-key',
        },
        'person@example.test',
      ),
    ).toMatchObject({
      ok: true,
      payload: {
        userKey: '2.synthetic-user-key',
        publicKey: 'synthetic-public-key',
        privateKey: '2.synthetic-wrapped-private-key',
      },
    })
  })

  it('builds a D1 user record without plaintext password fields', () => {
    const decision = resolveBootstrapAccount(
      {
        email: 'person@example.test',
        masterPasswordHash: 'synthetic-master-password-hash',
      },
      'person@example.test',
    )

    expect(decision.ok).toBe(true)
    if (!decision.ok) {
      return
    }

    expect(
      buildBootstrapUserRecord(decision.payload, {
        id: 'user-id',
        revisionDate: '2026-07-06T00:00:00.000Z',
        securityStamp: 'security-stamp',
      }),
    ).toEqual({
      id: 'user-id',
      email: 'person@example.test',
      emailNormalized: 'person@example.test',
      displayName: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: null,
      publicKey: null,
      privateKey: null,
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
    })
  })
})
