import { describe, expect, it } from 'vitest'

import {
  buildAccountFailureState,
  buildAuthAttemptBucketKey,
  extractClientAddress,
  isAccountLocked,
  loginDefensePolicy,
} from '../../src/domain/login-defense'

describe('login defense policy', () => {
  it('locks an account when repeated failures reach the threshold', () => {
    const state = buildAccountFailureState({
      currentFailedCount: loginDefensePolicy.accountFailureLimit - 1,
      lastFailedAt: '2026-07-06T00:04:00.000Z',
      now: '2026-07-06T00:05:00.000Z',
    })

    expect(state.failedCount).toBe(loginDefensePolicy.accountFailureLimit)
    expect(state.lockedUntil).toBe('2026-07-06T00:20:00.000Z')
  })

  it('resets the failure window when the previous failure is too old', () => {
    const state = buildAccountFailureState({
      currentFailedCount: 4,
      lastFailedAt: '2026-07-06T00:00:00.000Z',
      now: '2026-07-06T00:20:00.000Z',
    })

    expect(state.failedCount).toBe(1)
    expect(state.lockedUntil).toBeNull()
  })

  it('detects active temporary account locks', () => {
    expect(
      isAccountLocked({
        lockedUntil: '2026-07-06T00:20:00.000Z',
        now: '2026-07-06T00:19:59.000Z',
      }),
    ).toBe(true)

    expect(
      isAccountLocked({
        lockedUntil: '2026-07-06T00:20:00.000Z',
        now: '2026-07-06T00:20:00.000Z',
      }),
    ).toBe(false)
  })

  it('hashes client addresses before using them as auth attempt buckets', async () => {
    const bucket = await buildAuthAttemptBucketKey('ip', '203.0.113.10')

    expect(bucket).toMatch(/^ip:[A-Za-z0-9_-]+$/)
    expect(bucket).not.toContain('203.0.113.10')
  })

  it('extracts the best available client address without trusting arbitrary body input', () => {
    const direct = new Headers({
      'CF-Connecting-IP': '203.0.113.10',
      'X-Forwarded-For': '198.51.100.20, 198.51.100.21',
    })
    expect(extractClientAddress(direct)).toBe('203.0.113.10')

    const forwarded = new Headers({
      'X-Forwarded-For': '198.51.100.20, 198.51.100.21',
    })
    expect(extractClientAddress(forwarded)).toBe('198.51.100.20')

    expect(extractClientAddress(new Headers())).toBe('unknown')
  })
})
