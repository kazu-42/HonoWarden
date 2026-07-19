import { describe, expect, it } from 'vitest'

import {
  accountCredentialPolicy,
  nextCredentialRevisionDate,
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
