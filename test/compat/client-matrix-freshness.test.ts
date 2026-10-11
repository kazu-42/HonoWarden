import { describe, expect, it } from 'vitest'

import { inspectClientMatrixFreshness } from '../../scripts/honowarden-client-matrix-policy.mjs'

const matrix = {
  checkedAt: '2026-08-16T03:35:28Z',
  metadataRefresh: {
    cadenceDays: 14,
    staleAfterDays: 21,
    requiredBeforeRelease: true,
  },
}

describe('client matrix metadata freshness', () => {
  it.each([
    ['2026-08-30T03:35:27Z', 'fresh', true],
    ['2026-08-30T03:35:28Z', 'refresh_due', false],
    ['2026-09-06T03:35:27Z', 'refresh_due', false],
    ['2026-09-06T03:35:28Z', 'stale', false],
    ['2026-09-22T00:00:00Z', 'stale', false],
  ])('evaluates the exact boundary at %s', (asOf, status, releaseReady) => {
    expect(inspectClientMatrixFreshness(matrix, asOf)).toMatchObject({
      status,
      releaseReady,
      refreshDueAt: '2026-08-30T03:35:28.000Z',
      staleAt: '2026-09-06T03:35:28.000Z',
    })
  })

  it.each([
    {},
    { ...matrix, checkedAt: '2026-02-31T00:00:00Z' },
    { ...matrix, checkedAt: '2027-01-01T00:00:00Z' },
    {
      ...matrix,
      metadataRefresh: { ...matrix.metadataRefresh, cadenceDays: 0 },
    },
    {
      ...matrix,
      metadataRefresh: { ...matrix.metadataRefresh, staleAfterDays: 13 },
    },
    {
      ...matrix,
      metadataRefresh: { ...matrix.metadataRefresh, staleAfterDays: Infinity },
    },
  ])('blocks malformed or future-dated metadata', (candidate) => {
    expect(
      inspectClientMatrixFreshness(candidate, '2026-09-22T00:00:00Z'),
    ).toMatchObject({ status: 'invalid', releaseReady: false })
  })

  it('rejects an invalid observation time', () => {
    expect(inspectClientMatrixFreshness(matrix, 'not-a-date')).toMatchObject({
      status: 'invalid',
      releaseReady: false,
    })
  })
})
