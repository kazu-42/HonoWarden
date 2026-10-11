import { describe, expect, it } from 'vitest'

import {
  formatUiError,
  normalizeInvitationEmails,
  completeInvitationDomain,
  runMfaVerification,
  runMutationWithReadback,
} from '../admin/app'
import { AdminError } from '../admin/browser/contracts'

describe('administration mutation outcomes', () => {
  it('does not announce an empty-body successful mutation before readback', async () => {
    let completeReadback!: (value: string) => void
    let resolved = false
    const pending = runMutationWithReadback({
      operation: async () => undefined,
      readback: () =>
        new Promise<string>((resolve) => {
          completeReadback = resolve
        }),
      isCurrent: () => true,
    }).then((value) => {
      resolved = true
      return value
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)
    completeReadback('confirmed server state')
    expect(await pending).toEqual({
      kind: 'confirmed',
      data: 'confirmed server state',
    })
  })

  it('retains a persisted mail failure after successful member readback', async () => {
    const failure = new AdminError(
      'unavailable',
      'invitation_delivery_unavailable',
      {
        httpStatus: 503,
        persisted: true,
        membershipIds: ['member-1', 'member-2'],
        requestId: 'safe-request-1',
      },
    )
    let writes = 0
    const outcome = await runMutationWithReadback({
      operation: async () => {
        writes++
        throw failure
      },
      readback: async () => ['invited', 'accepted'],
      isCurrent: () => true,
    })
    expect(writes).toBe(1)
    expect(outcome).toMatchObject({
      kind: 'partial',
      error: failure,
      data: ['invited', 'accepted'],
    })
  })

  it('does not turn a transport failure into success even when readback works', async () => {
    const error = new AdminError('transport', 'request_failed')
    expect(
      await runMutationWithReadback({
        operation: async () => {
          throw error
        },
        readback: async () => ['current'],
        isCurrent: () => true,
      }),
    ).toEqual({ kind: 'unknown', error, data: ['current'] })
  })

  it('ignores a successful late response after a lock or organization switch', async () => {
    let current = true
    let finish!: () => void
    let reads = 0
    const pending = runMutationWithReadback({
      operation: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      readback: async () => {
        reads++
        return 'decrypted old data'
      },
      isCurrent: () => current,
    })
    current = false
    finish()
    expect(await pending).toEqual({ kind: 'stale' })
    expect(reads).toBe(0)
  })

  it('does not start a write if the caller is already stale', async () => {
    let writes = 0
    expect(
      await runMutationWithReadback({
        operation: async () => {
          writes++
        },
        readback: async () => 'current',
        isCurrent: () => false,
      }),
    ).toEqual({ kind: 'stale' })
    expect(writes).toBe(0)
  })

  it('keeps an unknown outcome when a committed write cannot be read back', async () => {
    const error = new AdminError('unavailable', 'database_unavailable')
    expect(
      await runMutationWithReadback({
        operation: async () => undefined,
        readback: async () => {
          throw error
        },
        isCurrent: () => true,
      }),
    ).toEqual({ kind: 'unknown', error })
  })

  it('keeps a facade rejection uncertain if its post-write state cannot be read', async () => {
    const rejected = new AdminError('conflict', 'revision_conflict', {
      httpStatus: 409,
    })
    let reads = 0
    expect(
      await runMutationWithReadback({
        operation: async () => {
          throw rejected
        },
        readback: async () => {
          reads++
          throw new AdminError('unavailable', 'database_unavailable')
        },
        isCurrent: () => true,
      }),
    ).toEqual({ kind: 'unknown', error: rejected })
    expect(reads).toBe(1)
  })
})

describe('MFA submission outcomes and ephemeral state', () => {
  it('clears ephemeral data before assurance readback after an uncertain submission', async () => {
    const error = new AdminError('transport', 'request_failed')
    let ephemeralCount = 3
    let writes = 0
    const outcome = await runMfaVerification({
      operation: async () => {
        writes++
        throw error
      },
      clearEphemeral: () => {
        ephemeralCount = 0
      },
      readback: async () => {
        expect(ephemeralCount).toBe(0)
        return { mfaVerified: true }
      },
      isCurrent: () => true,
    })
    expect(writes).toBe(1)
    expect(outcome).toEqual({
      kind: 'unknown',
      error,
      data: { mfaVerified: true },
    })
  })

  it('keeps a definite invalid code inline without exposing a new assurance state', async () => {
    const error = new AdminError('validation', 'totp_code_invalid', {
      httpStatus: 400,
    })
    let clears = 0
    let reads = 0
    expect(
      await runMfaVerification({
        operation: async () => {
          throw error
        },
        clearEphemeral: () => {
          clears++
        },
        readback: async () => {
          reads++
          return { mfaVerified: true }
        },
        isCurrent: () => true,
      }),
    ).toEqual({ kind: 'rejected', error })
    expect(clears).toBe(0)
    expect(reads).toBe(0)
  })

  it('clears setup state and keeps the outcome unknown when final assurance cannot be read', async () => {
    const error = new AdminError('unavailable', 'database_unavailable')
    let cleared = false
    expect(
      await runMfaVerification({
        operation: async () => undefined,
        clearEphemeral: () => {
          cleared = true
        },
        readback: async () => {
          expect(cleared).toBe(true)
          throw error
        },
        isCurrent: () => true,
      }),
    ).toEqual({ kind: 'unknown', error })
    expect(cleared).toBe(true)
  })
})

describe('administration safe input and copy', () => {
  it('completes only bare invitation names and retains explicit external domains', () => {
    expect(
      completeInvitationDomain(' First, second@external.test ', 'example.test'),
    ).toEqual(['first@example.test', 'second@external.test'])
    expect(() =>
      completeInvitationDomain('first, first@example.test', 'example.test'),
    ).toThrow()
    expect(() =>
      completeInvitationDomain('first name', 'example.test'),
    ).toThrow()
    expect(() => completeInvitationDomain('first', null)).toThrow()
    expect(() =>
      completeInvitationDomain('first', 'example.test/path'),
    ).toThrow()
  })
  it('rejects duplicate normalized invitations instead of silently dropping one', () => {
    expect(() =>
      normalizeInvitationEmails(' Person@example.test\nperson@EXAMPLE.TEST '),
    ).toThrow()
    expect(
      normalizeInvitationEmails(' First@example.test, second@example.test\n'),
    ).toEqual(['first@example.test', 'second@example.test'])
  })

  it('rejects invitation batches beyond the server limit', () => {
    expect(() =>
      normalizeInvitationEmails(
        Array.from(
          { length: 21 },
          (_, index) => `member${index}@example.test`,
        ).join('\n'),
      ),
    ).toThrow()
  })

  it('does not leak raw exception messages into user copy', () => {
    const raw = 'private value password=do-not-render'
    expect(formatUiError(new Error(raw)).message).not.toContain(raw)
    expect(
      formatUiError(
        new AdminError('authorization', 'organization_not_found', {
          httpStatus: 404,
        }),
      ).message,
    ).not.toContain('削除されました')
  })

  it('offers sign-in or operator setup recovery without claiming that an account exists', () => {
    const notice = formatUiError(
      new AdminError('authorization', 'initial_setup_unavailable', {
        httpStatus: 403,
      }),
    )
    expect(notice.title).toBe('初回セットアップを実行できません')
    expect(notice.message).toContain('作成済みの場合')
    expect(notice.message).toContain('運用担当者')
  })

  it('distinguishes feature-disabled state from a successful empty list', () => {
    expect(
      formatUiError(
        new AdminError('unavailable', 'unsupported_feature', {
          httpStatus: 501,
        }),
      ),
    ).toMatchObject({ title: 'この環境では利用できません', tone: 'neutral' })
  })
})
