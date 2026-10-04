import { describe, expect, it, vi } from 'vitest'

import { runEmailVerificationSubmission } from '../admin/app'
import { AdminError } from '../admin/browser/contracts'

function submission() {
  return {
    submit: vi.fn(async () => ({ status: 'verified' as const })),
    dispose: vi.fn(),
    isCurrent: () => true,
    currentVerification: () => true as boolean | undefined,
    readback: vi.fn(async () => true as boolean | undefined),
  }
}

describe('optional account email verification outcomes', () => {
  it('keeps a missing browser proof distinct without guessing its cause', async () => {
    const input = submission()
    const submit = vi.fn(async () => ({ status: 'proofUnavailable' as const }))
    expect(await runEmailVerificationSubmission({ ...input, submit })).toEqual({
      kind: 'proofUnavailable',
    })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(input.dispose).toHaveBeenCalledTimes(1)
    expect(input.readback).not.toHaveBeenCalled()
  })

  it('confirms only a facade result backed by canonical profile state', async () => {
    const input = submission()
    expect(await runEmailVerificationSubmission(input)).toEqual({
      kind: 'verified',
    })
    expect(input.dispose).toHaveBeenCalledTimes(1)
    expect(input.readback).not.toHaveBeenCalled()
  })

  it('does not turn missing canonical status into verified success', async () => {
    const input = submission()
    expect(
      await runEmailVerificationSubmission({
        ...input,
        currentVerification: () => undefined,
      }),
    ).toMatchObject({ kind: 'unknown', canonicalVerified: true })
    expect(input.dispose).toHaveBeenCalledTimes(1)
    expect(input.readback).toHaveBeenCalledTimes(1)
  })

  it('does not confirm a response when the current canonical profile is unverified', async () => {
    const input = submission()
    expect(
      await runEmailVerificationSubmission({
        ...input,
        currentVerification: () => false,
        readback: async () => false,
      }),
    ).toMatchObject({ kind: 'unknown', canonicalVerified: false })
    expect(input.dispose).toHaveBeenCalledTimes(1)
  })

  it('retires the attempt before readback and never replays an uncertain verification', async () => {
    const input = submission()
    const error = new AdminError('transport', 'request_failed')
    const submit = vi.fn(async () => {
      throw error
    })
    const readback = vi.fn(async () => {
      expect(input.dispose).toHaveBeenCalledTimes(1)
      return true
    })
    expect(
      await runEmailVerificationSubmission({ ...input, submit, readback }),
    ).toEqual({ kind: 'unknown', error, canonicalVerified: true })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(readback).toHaveBeenCalledTimes(1)
  })

  it('retires a rejected proof and waits for an explicitly prepared new attempt', async () => {
    const input = submission()
    const error = new AdminError('validation', 'invalid_request', {
      httpStatus: 400,
    })
    expect(
      await runEmailVerificationSubmission({
        ...input,
        submit: async () => {
          throw error
        },
      }),
    ).toEqual({ kind: 'rejected', error })
    expect(input.dispose).toHaveBeenCalledTimes(1)
    expect(input.readback).not.toHaveBeenCalled()
  })

  it('does not submit an attempt that was closed or superseded', async () => {
    const input = submission()
    expect(
      await runEmailVerificationSubmission({
        ...input,
        isCurrent: () => false,
      }),
    ).toEqual({ kind: 'stale' })
    expect(input.submit).not.toHaveBeenCalled()
    expect(input.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not apply a late verification after session change', async () => {
    const input = submission()
    let current = true
    let complete!: () => void
    const pending = runEmailVerificationSubmission({
      ...input,
      submit: async () => {
        await new Promise<void>((resolve) => {
          complete = resolve
        })
        return { status: 'verified' }
      },
      isCurrent: () => current,
    })
    current = false
    complete()
    expect(await pending).toEqual({ kind: 'stale' })
    expect(input.dispose).toHaveBeenCalledTimes(1)
    expect(input.readback).not.toHaveBeenCalled()
  })

  it('keeps the outcome unknown when both submission and readback are unavailable', async () => {
    const input = submission()
    const error = new AdminError('unavailable', 'database_unavailable')
    expect(
      await runEmailVerificationSubmission({
        ...input,
        submit: async () => {
          throw error
        },
        readback: async () => {
          throw new AdminError('transport', 'request_failed')
        },
      }),
    ).toEqual({ kind: 'unknown', error })
    expect(input.dispose).toHaveBeenCalledTimes(1)
  })

  it('ignores a readback that finishes after the originating dialog is superseded', async () => {
    const input = submission()
    let current = true
    let complete!: () => void
    let started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = runEmailVerificationSubmission({
      ...input,
      submit: async () => {
        throw new AdminError('transport', 'request_failed')
      },
      isCurrent: () => current,
      readback: async () => {
        started()
        await new Promise<void>((resolve) => {
          complete = resolve
        })
        return true
      },
    })
    await reading
    current = false
    complete()
    expect(await pending).toEqual({ kind: 'stale' })
    expect(input.dispose).toHaveBeenCalledTimes(1)
  })
})
