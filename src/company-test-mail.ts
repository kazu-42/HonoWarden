import { readCompanySettings } from './company-settings'
import {
  organizationCollectionAccessCte,
  organizationAccessActorValues,
} from './repositories/organization-collection-access-sql'
import type { OrganizationPolicyActor } from './repositories/organization-policy-sql'

export function parseCompanyTestMailRequest(
  value: unknown,
): { revision: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  return Object.keys(row).length === 1 &&
    typeof row.revision === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(row.revision)
    ? { revision: row.revision }
    : null
}

export async function requestCompanyTestMail(
  database: Pick<D1Database, 'prepare' | 'batch'>,
  mailer: Pick<Fetcher, 'fetch'>,
  input: {
    organizationId: string
    actor: OrganizationPolicyActor
    revision: string
    now: string
    requestId: string
  },
): Promise<
  | 'accepted'
  | 'not_found'
  | 'conflict'
  | 'recipient_required'
  | 'rate_limited'
  | 'delivery_unknown'
> {
  const id = crypto.randomUUID()
  const threshold = new Date(Date.parse(input.now) - 300_000).toISOString()
  // The required audit row is also the atomic cooldown claim. No claim means no
  // external request. Its timestamp remains after an ambiguous provider result.
  const claim = await database
    .prepare(
      `${organizationCollectionAccessCte}
    INSERT INTO audit_events (id,schema_version,name,outcome,request_id,occurred_at,actor_user_id,actor_device_identifier,target_type,target_id,context_json)
    SELECT ?,1,'organization.mail_test.request','success',?,?,?,?,'organization',settings.organization_id,json_object('organizationId',settings.organization_id)
    FROM organization_company_settings settings
    JOIN confirmed_memberships membership ON membership.organizationId = settings.organization_id AND membership.type = 0
    WHERE settings.organization_id = ? AND settings.revision = ? AND settings.mail_test_recipient IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM audit_events recent
        WHERE recent.name = 'organization.mail_test.request' AND recent.occurred_at > ?
        AND (recent.actor_user_id = ? OR recent.target_id = ?))
    RETURNING id, (SELECT mail_test_recipient FROM organization_company_settings WHERE organization_id = ?) AS recipientEmail
  `,
    )
    .bind(
      ...organizationAccessActorValues(input.actor.userId, input.actor),
      id,
      input.requestId,
      input.now,
      input.actor.userId,
      input.actor.deviceIdentifier,
      input.organizationId,
      input.revision,
      threshold,
      input.actor.userId,
      input.organizationId,
      input.organizationId,
    )
    .first<{ id: string; recipientEmail: string }>()
  if (!claim) {
    const current = await readCompanySettings(database, input)
    if (!current?.canEdit) return 'not_found'
    if (current.revision !== input.revision) return 'conflict'
    if (!current.mailTestRecipient) return 'recipient_required'
    return 'rate_limited'
  }
  if (claim.id !== id || typeof claim.recipientEmail !== 'string')
    throw new Error('Company mail claim is invalid.')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const response = await Promise.race([
      mailer
        .fetch('https://organization-membership-mailer.internal/test', {
          method: 'POST',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            recipientEmail: claim.recipientEmail,
            testId: id,
          }),
        })
        .then(async (response) => {
          const accepted = response.status === 202
          await response.body?.cancel().catch(() => undefined)
          return accepted
        }),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          resolve(false)
          controller.abort()
        }, 12_000)
      }),
    ])
    if (response) return 'accepted'
  } catch {
    // Provider errors may contain addresses or credentials. Project a fixed event.
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  console.error(
    JSON.stringify({
      event: 'company_test_mail_delivery_unknown',
      requestId: input.requestId,
    }),
  )
  return 'delivery_unknown'
}
