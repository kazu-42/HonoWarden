import { buildAuditEvent } from './domain/audit'
import {
  finalizeAccountPurge,
  recordAccountPurgeProgress,
  startAccountPurge,
} from './repositories/account-lifecycle-repository'

export async function purgeRecoverableAccount(
  database: D1Database,
  bucket: R2Bucket,
  input: {
    userId: string
    lifecycleGeneration: string
    confirmedLifecycleGeneration: string
    requestId: string
    now: string
  },
): Promise<
  | { status: 'tombstoned'; deletedObjectCount: number }
  | {
      status: 'purging_r2'
      deletedObjectCount: number
      remainingObjectCount: number
    }
  | { status: 'conflict' }
> {
  if (
    !input.lifecycleGeneration ||
    input.confirmedLifecycleGeneration !== input.lifecycleGeneration
  ) {
    throw new Error('Account purge generation confirmation is invalid.')
  }

  const started = await startAccountPurge(database, {
    userId: input.userId,
    lifecycleGeneration: input.lifecycleGeneration,
    now: input.now,
  })
  if (started.status === 'conflict') return started

  let deletedCount = started.deletedCount
  try {
    if (started.objectKeys.length > 0) {
      await bucket.delete(started.objectKeys)
      deletedCount += started.objectKeys.length
    }
  } catch {
    await recordAccountPurgeProgress(database, {
      userId: input.userId,
      lifecycleGeneration: input.lifecycleGeneration,
      deletedCount: started.deletedCount,
      now: input.now,
      errorCode: 'r2_delete_failed',
    }).catch(() => ({ status: 'unavailable' as const }))
    throw new Error('Account R2 purge failed.')
  }
  const progress = await recordAccountPurgeProgress(database, {
    userId: input.userId,
    lifecycleGeneration: input.lifecycleGeneration,
    deletedCount,
    now: input.now,
    errorCode: null,
  })
  if (progress.status !== 'updated') {
    throw new Error('Account purge progress persistence failed.')
  }

  if (deletedCount < started.expectedCount) {
    if (started.objectKeys.length === 0) {
      throw new Error('Account R2 purge inventory is incomplete.')
    }
    return {
      status: 'purging_r2',
      deletedObjectCount: deletedCount,
      remainingObjectCount: started.expectedCount - deletedCount,
    }
  }
  if (deletedCount !== started.expectedCount) {
    throw new Error('Account R2 purge progress exceeded its inventory.')
  }

  const tombstoneDigest = await digestTombstoneIdentity(
    input.userId,
    input.lifecycleGeneration,
  )
  const auditEventId = crypto.randomUUID()
  const auditEvent = buildAuditEvent({
    name: 'account.deletion.purge',
    outcome: 'success',
    requestId: input.requestId,
    occurredAt: input.now,
    target: { type: 'account', id: input.userId },
    context: {
      personalR2DeletedCount: deletedCount,
      lifecycleGeneration: input.lifecycleGeneration,
      organizationDataRetained: true,
      opaqueTombstoneRetained: true,
    },
  })
  const finalized = await finalizeAccountPurge(database, {
    userId: input.userId,
    lifecycleGeneration: input.lifecycleGeneration,
    tombstoneEmail: `deleted+${tombstoneDigest.slice(0, 32)}@invalid`,
    tombstoneMasterPasswordHash: `tombstone:${crypto.randomUUID()}`,
    nextSecurityStamp: crypto.randomUUID(),
    now: input.now,
    auditEventId,
    auditEvent,
  })
  if (finalized.status !== 'tombstoned') {
    await recordAccountPurgeProgress(database, {
      userId: input.userId,
      lifecycleGeneration: input.lifecycleGeneration,
      deletedCount,
      now: input.now,
      errorCode: 'd1_finalize_conflict',
    }).catch(() => ({ status: 'unavailable' as const }))
    return { status: 'conflict' }
  }
  return { status: 'tombstoned', deletedObjectCount: started.expectedCount }
}

async function digestTombstoneIdentity(
  userId: string,
  lifecycleGeneration: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `honowarden:account-tombstone:v1\0${userId}\0${lifecycleGeneration}`,
    ),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
