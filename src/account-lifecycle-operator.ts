import { WorkerEntrypoint } from 'cloudflare:workers'

import type { Bindings } from './bindings'
import { purgeRecoverableAccount } from './account-lifecycle-purge'
import { buildAuditEvent } from './domain/audit'
import {
  markAccountPurgeReady,
  planAccountDeletion,
  recoverAccountDeletion,
} from './repositories/account-lifecycle-repository'

type OperatorTarget = {
  userId: string
  lifecycleGeneration: string
  requestId: string
  reason: string
}

type ConfirmedOperatorTarget = OperatorTarget & {
  confirmedLifecycleGeneration: string
}

export class AccountLifecycleOperator extends WorkerEntrypoint<Bindings> {
  async plan(input: OperatorTarget) {
    const target = validateOperatorTarget(input)
    return planAccountDeletion(this.env.DB, {
      userId: target.userId,
      lifecycleGeneration: target.lifecycleGeneration,
      now: new Date().toISOString(),
    })
  }

  async recover(input: ConfirmedOperatorTarget) {
    const target = validateConfirmedOperatorTarget(input)
    const state = await readRecoverableOperatorState(
      this.env.DB,
      target.userId,
      target.lifecycleGeneration,
    )
    if (!state) return { status: 'conflict' as const }

    const now = new Date().toISOString()
    const auditEvent = buildAuditEvent({
      name: 'account.deletion.recover',
      outcome: 'success',
      requestId: target.requestId,
      occurredAt: now,
      target: { type: 'account', id: target.userId },
      context: {
        lifecycleGeneration: target.lifecycleGeneration,
        operatorReasonProvided: true,
        sessionsRemainRevoked: true,
      },
    })
    return recoverAccountDeletion(this.env.DB, {
      userId: target.userId,
      lifecycleGeneration: target.lifecycleGeneration,
      expectedDisabledSecurityStamp: state.securityStamp,
      now,
      nextSecurityStamp: crypto.randomUUID(),
      auditEventId: crypto.randomUUID(),
      auditEvent,
    })
  }

  async preparePurge(input: ConfirmedOperatorTarget) {
    const target = validateConfirmedOperatorTarget(input)
    const now = new Date().toISOString()
    const plan = await planAccountDeletion(this.env.DB, {
      userId: target.userId,
      lifecycleGeneration: target.lifecycleGeneration,
      now,
    })
    if (plan.status === 'not_found' || !plan.purgeAllowed) {
      return { status: 'conflict' as const }
    }
    return markAccountPurgeReady(this.env.DB, {
      userId: target.userId,
      lifecycleGeneration: target.lifecycleGeneration,
      now,
      expectedPersonalAttachmentCount: plan.personalAttachmentCount,
    })
  }

  async purge(input: ConfirmedOperatorTarget) {
    const target = validateConfirmedOperatorTarget(input)
    return purgeRecoverableAccount(this.env.DB, this.env.VAULT_OBJECTS, {
      userId: target.userId,
      lifecycleGeneration: target.lifecycleGeneration,
      confirmedLifecycleGeneration: target.confirmedLifecycleGeneration,
      requestId: target.requestId,
      now: new Date().toISOString(),
    })
  }
}

function validateConfirmedOperatorTarget(
  input: ConfirmedOperatorTarget,
): ConfirmedOperatorTarget {
  const target = validateOperatorTarget(input)
  if (input.confirmedLifecycleGeneration !== target.lifecycleGeneration) {
    throw new Error('Account lifecycle generation confirmation is invalid.')
  }
  return { ...target, confirmedLifecycleGeneration: target.lifecycleGeneration }
}

function validateOperatorTarget(input: OperatorTarget): OperatorTarget {
  return {
    userId: requireBoundedOperatorValue(input.userId, 'userId', 128),
    lifecycleGeneration: requireBoundedOperatorValue(
      input.lifecycleGeneration,
      'lifecycleGeneration',
      128,
    ),
    requestId: requireBoundedOperatorValue(input.requestId, 'requestId', 128),
    reason: requireBoundedOperatorValue(input.reason, 'reason', 256),
  }
}

function requireBoundedOperatorValue(
  value: string,
  name: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    throw new Error(`Account lifecycle operator ${name} is invalid.`)
  }
  return value
}

async function readRecoverableOperatorState(
  database: D1Database,
  userId: string,
  lifecycleGeneration: string,
): Promise<{ securityStamp: string } | null> {
  return database
    .prepare(
      `
        SELECT account.security_stamp as securityStamp
        FROM users AS account
        JOIN account_deletions AS deletion ON deletion.user_id = account.id
        WHERE account.id = ?
          AND account.disabled_at IS NOT NULL
          AND deletion.lifecycle_generation = ?
          AND deletion.state = 'recoverable'
          AND deletion.recover_until > ?
        LIMIT 1
      `,
    )
    .bind(userId, lifecycleGeneration, new Date().toISOString())
    .first<{ securityStamp: string }>()
}
