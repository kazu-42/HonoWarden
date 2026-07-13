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
      authRequests: false,
      refreshTokens: false,
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

  it('expires active auth requests and removes terminal rows past retention', async () => {
    const authRequests = [
      {
        id: 'expired-active',
        status: 'pending',
        expiresAt: '2026-07-10T23:00:00.000Z',
        retentionDeleteAfter: '2026-08-10T23:00:00.000Z',
      },
      {
        id: 'retained-terminal',
        status: 'denied',
        expiresAt: '2026-06-01T00:00:00.000Z',
        retentionDeleteAfter: '2026-07-10T22:00:00.000Z',
      },
    ]
    const db = new FakeD1Database('0012', [], { authRequests })
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    await worker.scheduled(
      {
        scheduledTime: Date.UTC(2026, 6, 11, 0, 0, 0),
        cron: '0 * * * *',
        type: 'scheduled',
        noRetry: vi.fn(),
      } as ScheduledController,
      {
        DB: db as unknown as D1Database,
        INQUIRY_DB: db as unknown as D1Database,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        VAULT_OBJECTS: {} as unknown as R2Bucket,
      },
      context,
    )

    expect(authRequests).toEqual([
      expect.objectContaining({ id: 'expired-active', status: 'expired' }),
    ])
  })

  it('deletes one bounded refresh-token retention slice when enabled', async () => {
    const refreshTokens: Record<string, unknown>[] = Array.from(
      { length: 101 },
      (_, index) => ({
        id: `expired-token-${index.toString().padStart(3, '0')}`,
        expiresAt: new Date(
          Date.UTC(2026, 4, 1, 0, 0, 0) + index * 60_000,
        ).toISOString(),
        revokedAt: '2026-06-01T00:00:00.000Z',
      }),
    ).reverse()
    refreshTokens.push(
      {
        id: 'active-token',
        expiresAt: '2026-08-01T00:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'revoked-but-unexpired-token',
        expiresAt: '2026-07-15T00:00:00.000Z',
        revokedAt: '2026-06-20T00:00:00.000Z',
      },
    )
    const db = new FakeD1Database('0001', [], { refreshTokens })
    const prepare = vi.spyOn(db, 'prepare')
    const context = executionContext()

    await worker.scheduled(
      scheduledController(Date.UTC(2026, 6, 31, 0, 0, 0)),
      {
        DB: db as unknown as D1Database,
        INQUIRY_DB: db as unknown as D1Database,
        HONOWARDEN_REFRESH_TOKEN_RETENTION_ENABLED: 'true',
        VAULT_OBJECTS: {} as unknown as R2Bucket,
      },
      context,
    )

    expect(db.refreshTokenCleanupDeletes).toEqual([
      {
        expiredBefore: '2026-07-01T00:00:00.000Z',
        limit: 100,
        deleted: 100,
      },
    ])
    expect(refreshTokens.map((row) => row.id)).toEqual([
      'expired-token-100',
      'active-token',
      'revoked-but-unexpired-token',
    ])
    expect(
      prepare.mock.calls.some(([query]) =>
        /DELETE\s+FROM\s+refresh_tokens/.test(query),
      ),
    ).toBe(true)
  })

  it.each([undefined, 'false'])(
    'issues no refresh-token cleanup statement when the flag is %s',
    async (flag) => {
      const refreshTokens = [
        {
          id: 'expired-token',
          expiresAt: '2026-05-01T00:00:00.000Z',
          revokedAt: '2026-05-02T00:00:00.000Z',
        },
      ]
      const db = new FakeD1Database('0001', [], { refreshTokens })
      const prepare = vi.spyOn(db, 'prepare')
      const context = executionContext()

      await worker.scheduled(
        scheduledController(Date.UTC(2026, 6, 31, 0, 0, 0)),
        {
          DB: db as unknown as D1Database,
          INQUIRY_DB: db as unknown as D1Database,
          ...(flag === undefined
            ? {}
            : { HONOWARDEN_REFRESH_TOKEN_RETENTION_ENABLED: flag }),
          VAULT_OBJECTS: {} as unknown as R2Bucket,
        },
        context,
      )

      expect(refreshTokens).toHaveLength(1)
      expect(
        prepare.mock.calls.some(([query]) =>
          /DELETE\s+FROM\s+refresh_tokens/.test(query),
        ),
      ).toBe(false)
    },
  )

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

function scheduledController(scheduledTime: number): ScheduledController {
  return {
    scheduledTime,
    cron: '0 * * * *',
    type: 'scheduled',
    noRetry: vi.fn(),
  } as ScheduledController
}

function executionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext
}
