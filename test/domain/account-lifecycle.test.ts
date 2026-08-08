import { describe, expect, it } from 'vitest'

import {
  createAccountLifecycleToken,
  digestAccountLifecycleToken,
  isAccountLifecycleEnabled,
  parseAccountEmailChangeBody,
  parseAccountEmailTokenBody,
  parseAccountLifecycleTokenConfirmationBody,
  parseAccountDeletionRecoveryBody,
  accountDeletionRecoverUntil,
  requireAccountLifecycleTokenSecret,
} from '../../src/domain/account-lifecycle'

describe('account lifecycle policy', () => {
  it('enables lifecycle mutations only for the exact tracked value', () => {
    expect(isAccountLifecycleEnabled('true')).toBe(true)
    expect(isAccountLifecycleEnabled('TRUE')).toBe(false)
    expect(isAccountLifecycleEnabled('1')).toBe(false)
    expect(isAccountLifecycleEnabled('false')).toBe(false)
    expect(isAccountLifecycleEnabled(undefined)).toBe(false)
  })

  it('binds stored token digests to purpose, user, and credential generation', async () => {
    const input = {
      secret: 'account-lifecycle-secret-with-at-least-32-bytes',
      token: 'raw-one-time-token',
      purpose: 'email_change' as const,
      userId: 'user-1',
      generation: 'security-stamp-1',
    }
    const digest = await digestAccountLifecycleToken(input)

    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    await expect(digestAccountLifecycleToken(input)).resolves.toBe(digest)
    await expect(
      digestAccountLifecycleToken({ ...input, purpose: 'account_delete' }),
    ).resolves.not.toBe(digest)
    await expect(
      digestAccountLifecycleToken({ ...input, userId: 'user-2' }),
    ).resolves.not.toBe(digest)
    await expect(
      digestAccountLifecycleToken({
        ...input,
        generation: 'security-stamp-2',
      }),
    ).resolves.not.toBe(digest)
  })

  it('requires an unmodified token secret with at least 32 UTF-8 bytes', () => {
    expect(() => requireAccountLifecycleTokenSecret(undefined)).toThrow(
      'Account lifecycle token secret must be at least 32 bytes.',
    )
    expect(() => requireAccountLifecycleTokenSecret('x'.repeat(31))).toThrow(
      'Account lifecycle token secret must be at least 32 bytes.',
    )
    expect(requireAccountLifecycleTokenSecret(` ${'x'.repeat(31)}`)).toBe(
      ` ${'x'.repeat(31)}`,
    )
  })

  it('creates a 256-bit base64url token and its bound digest', async () => {
    const generated = await createAccountLifecycleToken({
      secret: 's'.repeat(32),
      purpose: 'email_change',
      userId: 'user-1',
      generation: 'security-stamp-1',
      randomBytes: (bytes) => bytes.fill(0xff),
    })

    expect(generated.token).toBe('_'.repeat(42) + '8')
    expect(generated.token).toHaveLength(43)
    expect(generated.digest).toMatch(/^[0-9a-f]{64}$/)
    await expect(
      digestAccountLifecycleToken({
        secret: 's'.repeat(32),
        token: generated.token,
        purpose: 'email_change',
        userId: 'user-1',
        generation: 'security-stamp-1',
      }),
    ).resolves.toBe(generated.digest)
  })

  it('parses the pinned email-token aliases without weakening credential proof', () => {
    expect(
      parseAccountEmailTokenBody({
        NewEmail: 'Next@Example.Test',
        MasterPasswordHash: 'current-authentication-hash',
      }),
    ).toEqual({
      ok: true,
      newEmail: 'Next@Example.Test',
      newEmailNormalized: 'next@example.test',
      currentMasterPasswordHash: 'current-authentication-hash',
    })
    expect(
      parseAccountEmailTokenBody({
        newEmail: 'next@example.test',
        masterPasswordHash: 'hash',
        OTP: 'unsupported',
      }),
    ).toEqual({ ok: false })
    expect(
      parseAccountEmailTokenBody({
        newEmail: 'not-an-email',
        masterPasswordHash: 'hash',
      }),
    ).toEqual({ ok: false })
  })

  it('parses a bounded pinned email-change request and exact token confirmation', () => {
    expect(
      parseAccountEmailChangeBody({
        newEmail: 'Next@Example.Test',
        masterPasswordHash: 'current-hash',
        newMasterPasswordHash: 'next-hash',
        token: 't'.repeat(43),
        key: '2.next-wrapped-user-key',
      }),
    ).toEqual({
      ok: true,
      newEmail: 'Next@Example.Test',
      newEmailNormalized: 'next@example.test',
      currentMasterPasswordHash: 'current-hash',
      nextMasterPasswordHash: 'next-hash',
      token: 't'.repeat(43),
      nextUserKey: '2.next-wrapped-user-key',
    })
    expect(
      parseAccountEmailChangeBody({
        newEmail: 'next@example.test',
        masterPasswordHash: 'current-hash',
        newMasterPasswordHash: 'next-hash',
        token: 'short',
        key: '2.next-wrapped-user-key',
      }),
    ).toEqual({ ok: false })

    expect(
      parseAccountLifecycleTokenConfirmationBody({
        UserId: 'user-1',
        Token: 'v'.repeat(43),
      }),
    ).toEqual({ ok: true, userId: 'user-1', token: 'v'.repeat(43) })
    expect(
      parseAccountLifecycleTokenConfirmationBody({
        userId: 'user-1',
        UserId: 'user-2',
        token: 'v'.repeat(43),
      }),
    ).toEqual({ ok: false })
  })

  it('parses generic deletion recovery email and builds an exact 30-day window', () => {
    expect(
      parseAccountDeletionRecoveryBody({ Email: 'Person@Example.Test' }),
    ).toEqual({
      ok: true,
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
    })
    expect(parseAccountDeletionRecoveryBody({ email: 'invalid' })).toEqual({
      ok: false,
    })
    expect(accountDeletionRecoverUntil('2026-08-08T00:00:00.000Z')).toBe(
      '2026-09-07T00:00:00.000Z',
    )
  })
})
