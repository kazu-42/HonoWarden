import { parseOrganizationMembershipInviteRequest } from './domain/organization-membership'
import {
  organizationCollectionAccessCte,
  organizationAccessActorValues,
} from './repositories/organization-collection-access-sql'
import type { OrganizationPolicyActor } from './repositories/organization-policy-sql'

export type CompanySettingsInput = {
  name: string
  defaultEmailDomain: string | null
  expectedMemberCount: number | null
  mailTestRecipient: string | null
  revision: string | null
}
export type CompanySettings = CompanySettingsInput & {
  object: 'companySettings'
  canEdit: boolean
}
type Scope = { organizationId: string; actor: OrganizationPolicyActor }
type Database = Pick<D1Database, 'prepare' | 'batch'>
const fields = [
  'name',
  'defaultEmailDomain',
  'expectedMemberCount',
  'mailTestRecipient',
  'revision',
]
const nullableText = (value: unknown) =>
  value === null || value === ''
    ? null
    : typeof value === 'string'
      ? value.trim().toLowerCase()
      : undefined

export function parseCompanySettings(
  value: unknown,
): CompanySettingsInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    Object.keys(row).length !== fields.length ||
    Object.keys(row).some((key) => !fields.includes(key))
  )
    return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (
    !name ||
    name.length > 100 ||
    [...name].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null
  const domain = nullableText(row.defaultEmailDomain)
  if (
    domain === undefined ||
    (domain !== null &&
      (domain.length > 253 ||
        !domain.includes('.') ||
        !domain
          .split('.')
          .every((label) =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
          )))
  )
    return null
  const email = nullableText(row.mailTestRecipient)
  if (
    email === undefined ||
    (email !== null &&
      !parseOrganizationMembershipInviteRequest({ emails: [email], type: 2 })
        .ok)
  )
    return null
  const count = row.expectedMemberCount
  if (
    count !== null &&
    (typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 100000)
  )
    return null
  const revision = row.revision
  if (
    revision !== null &&
    (typeof revision !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(revision))
  )
    return null
  return {
    name,
    defaultEmailDomain: domain,
    expectedMemberCount: count as number | null,
    mailTestRecipient: email,
    revision: revision as string | null,
  }
}

export async function readCompanySettings(
  database: Database,
  input: Scope,
): Promise<CompanySettings | null> {
  const row = await database
    .prepare(
      `${organizationCollectionAccessCte}
    SELECT organization.name, settings.default_email_domain AS defaultEmailDomain,
      settings.expected_member_count AS expectedMemberCount, settings.mail_test_recipient AS mailTestRecipient,
      settings.revision, membership.type AS role
    FROM organizations organization JOIN confirmed_memberships membership ON membership.organizationId = organization.id
    LEFT JOIN organization_company_settings settings ON settings.organization_id = organization.id
    WHERE organization.id = ? AND membership.type IN (0, 1) LIMIT 1`,
    )
    .bind(
      ...organizationAccessActorValues(input.actor.userId, input.actor),
      input.organizationId,
    )
    .first<CompanySettingsInput & { role: number }>()
  if (!row) return null
  const { role, ...settings } = row
  return { object: 'companySettings', ...settings, canEdit: role === 0 }
}

export async function updateCompanySettings(
  database: Database,
  input: Scope & {
    settings: CompanySettingsInput
    now: string
    requestId: string
  },
): Promise<
  | { status: 'success'; settings: CompanySettings }
  | { status: 'not_found' | 'conflict' }
> {
  const revision = crypto.randomUUID()
  const next = input.settings
  const statements = [
    database
      .prepare(
        `${organizationCollectionAccessCte}
      INSERT INTO organization_company_settings (organization_id,default_email_domain,expected_member_count,mail_test_recipient,revision,updated_at)
      SELECT organization.id,?,?,?,?,? FROM organizations organization
      JOIN confirmed_memberships membership ON membership.organizationId = organization.id AND membership.type = 0
      LEFT JOIN organization_company_settings existing ON existing.organization_id = organization.id
      WHERE organization.id = ? AND existing.revision IS ?
      ON CONFLICT(organization_id) DO UPDATE SET default_email_domain = excluded.default_email_domain,
        expected_member_count = excluded.expected_member_count, mail_test_recipient = excluded.mail_test_recipient,
        revision = excluded.revision, updated_at = excluded.updated_at`,
      )
      .bind(
        ...organizationAccessActorValues(input.actor.userId, input.actor),
        next.defaultEmailDomain,
        next.expectedMemberCount,
        next.mailTestRecipient,
        revision,
        input.now,
        input.organizationId,
        next.revision,
      ),
    database
      .prepare(
        `UPDATE organizations SET name = ?, updated_at = ?,
      revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?), '+0.001 seconds')
      WHERE id = ? AND EXISTS (SELECT 1 FROM organization_company_settings WHERE organization_id = ? AND revision = ?)`,
      )
      .bind(
        next.name,
        input.now,
        input.now,
        input.organizationId,
        input.organizationId,
        revision,
      ),
    database
      .prepare(
        `INSERT INTO audit_events (id,schema_version,name,outcome,request_id,occurred_at,actor_user_id,actor_device_identifier,target_type,target_id,context_json)
      SELECT ?,1,'organization.settings.update','success',?,?,?,?,'organization',?,json_object('organizationId',?)
      FROM organization_company_settings WHERE organization_id = ? AND revision = ?`,
      )
      .bind(
        revision,
        input.requestId,
        input.now,
        input.actor.userId,
        input.actor.deviceIdentifier,
        input.organizationId,
        input.organizationId,
        input.organizationId,
        revision,
      ),
    // A missing required audit/name write must abort the entire D1 batch.
    database
      .prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM organization_company_settings WHERE organization_id = ? AND revision = ?)
      AND (NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR NOT EXISTS (SELECT 1 FROM organizations WHERE id = ? AND name = ?))
      THEN json('mandatory company settings write missing') ELSE 1 END AS valid`,
      )
      .bind(
        input.organizationId,
        revision,
        revision,
        input.organizationId,
        next.name,
      ),
    database
      .prepare(
        `UPDATE users SET revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?,
      COALESCE((SELECT MAX(revision_date) FROM folders WHERE user_id = users.id), revision_date),
      COALESCE((SELECT MAX(revision_date) FROM ciphers WHERE user_id = users.id), revision_date),
      COALESCE((SELECT MAX(o.revision_date) FROM organizations o JOIN organization_users m ON m.organization_id = o.id WHERE m.user_id = users.id), revision_date)
      ), '+0.001 seconds') WHERE id IN (SELECT user_id FROM organization_users WHERE organization_id = ?)
      AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(input.now, input.organizationId, revision),
    database
      .prepare(
        'SELECT revision FROM organization_company_settings WHERE organization_id = ? AND revision = ?',
      )
      .bind(input.organizationId, revision),
  ]
  const results = await database.batch(statements)
  if (
    results.length !== statements.length ||
    results.some((result) => !result.success)
  )
    throw new Error('Company settings transaction failed.')
  const written = results[5]?.results[0] as { revision?: unknown } | undefined
  if (written?.revision === revision)
    return {
      status: 'success',
      settings: { ...next, revision, object: 'companySettings', canEdit: true },
    }
  const current = await readCompanySettings(database, input)
  return { status: current?.canEdit ? 'conflict' : 'not_found' }
}
