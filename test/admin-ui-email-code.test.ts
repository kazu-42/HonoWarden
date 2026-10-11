import { describe, expect, it, vi } from 'vitest'

import { runEmailCodeSubmission } from '../admin/app'
import { AdminError } from '../admin/browser/contracts'

function submission() {
  let code = 'a'.repeat(43)
  let disposed = false
  return {
    attempt: {
      requestCode: vi.fn(async () => {}),
      submit: vi.fn(async (submittedCode: string) => {
        expect(code).toBe('')
        expect(submittedCode).toBe('a'.repeat(43))
        return { status: 'verified' as const }
      }),
      readback: vi.fn(async () => {
        expect(disposed).toBe(false)
        return true
      }),
      dispose: vi.fn(() => {
        disposed = true
      }),
    },
    takeCode: vi.fn(() => {
      const value = code
      code = ''
      return value
    }),
    isCurrent: () => true,
    currentVerification: () => true as boolean | undefined,
  }
}

describe('ordinary email code submission outcomes', () => {
  it('clears the input before sending once and confirms canonical success', async () => {
    const input = submission()
    expect(await runEmailCodeSubmission(input)).toEqual({ kind: 'verified' })
    expect(input.attempt.submit).toHaveBeenCalledExactlyOnceWith('a'.repeat(43))
    expect(input.takeCode).toHaveBeenCalledTimes(1)
    expect(input.attempt.requestCode).not.toHaveBeenCalled()
    expect(input.attempt.readback).not.toHaveBeenCalled()
    expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the scoped attempt alive for canonical readback after uncertain submission', async () => {
    const input = submission()
    const error = new AdminError('transport', 'request_failed')
    input.attempt.submit.mockRejectedValue(error)
    expect(await runEmailCodeSubmission(input)).toEqual({
      kind: 'unknown',
      error,
      canonicalVerified: true,
    })
    expect(input.attempt.submit).toHaveBeenCalledTimes(1)
    expect(input.attempt.requestCode).not.toHaveBeenCalled()
    expect(input.attempt.readback).toHaveBeenCalledTimes(1)
    expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not equate a successful consume response with missing canonical verification', async () => {
    const input = submission()
    input.attempt.readback.mockResolvedValue(false)
    expect(
      await runEmailCodeSubmission({
        ...input,
        currentVerification: () => undefined,
      }),
    ).toMatchObject({ kind: 'unknown', canonicalVerified: false })
    expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not replay an invalid or expired code or send a replacement implicitly', async () => {
    const input = submission()
    const error = new AdminError('validation', 'invalid_request', {
      httpStatus: 400,
    })
    input.attempt.submit.mockRejectedValue(error)
    expect(await runEmailCodeSubmission(input)).toEqual({
      kind: 'rejected',
      error,
    })
    expect(input.attempt.submit).toHaveBeenCalledTimes(1)
    expect(input.attempt.requestCode).not.toHaveBeenCalled()
    expect(input.attempt.readback).not.toHaveBeenCalled()
    expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not take or submit a code from a closed or superseded dialog', async () => {
    const input = submission()
    expect(
      await runEmailCodeSubmission({ ...input, isCurrent: () => false }),
    ).toEqual({ kind: 'stale' })
    expect(input.takeCode).not.toHaveBeenCalled()
    expect(input.attempt.submit).not.toHaveBeenCalled()
    expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
  })

  it.each(['success', 'failure'])(
    'ignores late %s after a dialog is closed',
    async (outcome) => {
      const input = submission()
      let current = true
      let complete!: () => void
      input.attempt.submit.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          complete = resolve
        })
        if (outcome === 'failure')
          throw new AdminError('unavailable', 'request_failed')
        return { status: 'verified' }
      })
      const pending = runEmailCodeSubmission({
        ...input,
        isCurrent: () => current,
      })
      current = false
      complete()
      expect(await pending).toEqual({ kind: 'stale' })
      expect(input.attempt.readback).not.toHaveBeenCalled()
      expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
    },
  )

  it('ignores a late readback after the originating account or dialog changes', async () => {
    const input = submission()
    let current = true
    let complete!: () => void
    let started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    input.attempt.submit.mockRejectedValue(
      new AdminError('transport', 'request_failed'),
    )
    input.attempt.readback.mockImplementation(async () => {
      started()
      await new Promise<void>((resolve) => {
        complete = resolve
      })
      return true
    })
    const pending = runEmailCodeSubmission({
      ...input,
      isCurrent: () => current,
    })
    await reading
    current = false
    complete()
    expect(await pending).toEqual({ kind: 'stale' })
    expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown result when submission and canonical readback both fail', async () => {
    const input = submission()
    const error = new AdminError('transport', 'request_failed')
    input.attempt.submit.mockRejectedValue(error)
    input.attempt.readback.mockRejectedValue(
      new AdminError('unavailable', 'request_failed'),
    )
    expect(await runEmailCodeSubmission(input)).toEqual({
      kind: 'unknown',
      error,
    })
    expect(input.attempt.submit).toHaveBeenCalledTimes(1)
    expect(input.attempt.dispose).toHaveBeenCalledTimes(1)
  })
})
