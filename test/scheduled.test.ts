import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from '../src/index'
import * as retentionCleanup from '../src/maintenance/retention-cleanup'
import { FakeD1Database } from './support/fake-d1'

describe('HonoWarden scheduled maintenance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs shared bounded cleanup for scheduled auth cleanup', async () => {
    const cleanup = vi
      .spyOn(retentionCleanup, 'cleanupTransientAuthData')
      .mockResolvedValue()

    const db = new FakeD1Database('0001', [])
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    await expect(
      worker.scheduled(
        {
          scheduledTime: Date.UTC(2026, 6, 8, 0, 0, 0),
          cron: '0 * * * *',
          type: 'scheduled',
          noRetry: vi.fn(),
        } as ScheduledController,
        {
          DB: db as unknown as D1Database,
          VAULT_OBJECTS: {} as unknown as R2Bucket,
        },
        context,
      ),
    ).resolves.toBeUndefined()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledWith(db, '2026-07-08T00:00:00.000Z')
    expect(context.waitUntil).toHaveBeenCalledTimes(1)
  })
})
