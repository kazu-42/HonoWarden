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
          INQUIRY_DB: db as unknown as D1Database,
          VAULT_OBJECTS: {} as unknown as R2Bucket,
        },
        context,
      ),
    ).resolves.toBeUndefined()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledWith(db, '2026-07-08T00:00:00.000Z', {
      auditEvents: false,
      requestQuotaBuckets: false,
    })
    expect(context.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('runs bounded audit-event retention cleanup from the scheduled handler', async () => {
    const db = new FakeD1Database('0007', [])
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    await expect(
      worker.scheduled(
        {
          scheduledTime: Date.UTC(2026, 6, 9, 0, 0, 0),
          cron: '0 * * * *',
          type: 'scheduled',
          noRetry: vi.fn(),
        } as ScheduledController,
        {
          DB: db as unknown as D1Database,
          INQUIRY_DB: db as unknown as D1Database,
          HONOWARDEN_AUDIT_LOGS: 'true',
          VAULT_OBJECTS: {} as unknown as R2Bucket,
        },
        context,
      ),
    ).resolves.toBeUndefined()

    expect(db.auditEventCleanupDeletes).toEqual([
      {
        expiredBefore: '2025-07-09T00:00:00.000Z',
        limit: 100,
      },
    ])
    expect(context.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('skips audit-event cleanup while audit logging is disabled', async () => {
    const db = new FakeD1Database('0006', [])
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    await expect(
      worker.scheduled(
        {
          scheduledTime: Date.UTC(2026, 6, 9, 0, 0, 0),
          cron: '0 * * * *',
          type: 'scheduled',
          noRetry: vi.fn(),
        } as ScheduledController,
        {
          DB: db as unknown as D1Database,
          INQUIRY_DB: db as unknown as D1Database,
          HONOWARDEN_AUDIT_LOGS: 'false',
          VAULT_OBJECTS: {} as unknown as R2Bucket,
        },
        context,
      ),
    ).resolves.toBeUndefined()

    expect(db.auditEventCleanupDeletes).toEqual([])
    expect(context.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('runs bounded request quota cleanup when global request quotas are enabled', async () => {
    const db = new FakeD1Database('0008', [])
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    await expect(
      worker.scheduled(
        {
          scheduledTime: Date.UTC(2026, 6, 9, 0, 0, 0),
          cron: '0 * * * *',
          type: 'scheduled',
          noRetry: vi.fn(),
        } as ScheduledController,
        {
          DB: db as unknown as D1Database,
          INQUIRY_DB: db as unknown as D1Database,
          HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
          VAULT_OBJECTS: {} as unknown as R2Bucket,
        },
        context,
      ),
    ).resolves.toBeUndefined()

    expect(db.requestQuotaCleanupDeletes).toEqual([
      {
        expiredBefore: '2026-07-08T23:00:00.000Z',
        now: '2026-07-09T00:00:00.000Z',
        limit: 100,
      },
    ])
    expect(context.waitUntil).toHaveBeenCalledTimes(1)
  })
})
