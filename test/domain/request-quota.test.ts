import { describe, expect, it } from 'vitest'

import {
  buildRequestQuotaBucketKey,
  isGlobalRequestQuotaEnabled,
  isRequestQuotaExceeded,
  requestQuotaPolicy,
  resolveRequestQuotaScope,
} from '../../src/domain/request-quota'

describe('request quota domain', () => {
  it('hashes client addresses before using them as request quota buckets', async () => {
    const bucket = await buildRequestQuotaBucketKey('anonymous', '203.0.113.10')

    expect(bucket).toMatch(/^request:anonymous:[A-Za-z0-9_-]+$/)
    expect(bucket).not.toContain('203.0.113.10')
  })

  it('distinguishes anonymous and bearer-present request scopes', () => {
    expect(resolveRequestQuotaScope(new Headers())).toBe('anonymous')
    expect(
      resolveRequestQuotaScope(
        new Headers({
          Authorization: 'Bearer opaque-token',
        }),
      ),
    ).toBe('authenticated')
  })

  it('treats quota enablement as an explicit opt-in', () => {
    expect(isGlobalRequestQuotaEnabled(undefined)).toBe(false)
    expect(isGlobalRequestQuotaEnabled('false')).toBe(false)
    expect(isGlobalRequestQuotaEnabled('true')).toBe(true)
  })

  it('marks buckets exceeded only when the count is over the allowed limit', () => {
    expect(
      isRequestQuotaExceeded(
        {
          bucketKey: 'request:anonymous:hash',
          scope: 'anonymous',
          requestCount: requestQuotaPolicy.anonymousLimit,
          windowStartedAt: '2026-07-09T00:00:00.000Z',
          blockedUntil: null,
          updatedAt: '2026-07-09T00:00:00.000Z',
        },
        '2026-07-09T00:00:00.000Z',
      ),
    ).toBe(false)

    expect(
      isRequestQuotaExceeded(
        {
          bucketKey: 'request:anonymous:hash',
          scope: 'anonymous',
          requestCount: requestQuotaPolicy.anonymousLimit + 1,
          windowStartedAt: '2026-07-09T00:00:00.000Z',
          blockedUntil: '2026-07-09T00:01:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z',
        },
        '2026-07-09T00:00:00.000Z',
      ),
    ).toBe(true)
  })
})
