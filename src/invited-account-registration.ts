import {
  parseAccountRegistrationFields,
  type AccountRegistrationFields,
} from './domain/account-registration'
import { buildBootstrapUserRecord } from './domain/bootstrap'
import {
  buildOrganizationMembershipInviteTokenHash,
  parseOrganizationMembershipAcceptRequest,
} from './domain/organization-membership'

type Registration = AccountRegistrationFields & {
  invitation: { organizationId: string; membershipId: string; token: string }
}
const fields = new Set([
  'email',
  'displayName',
  'masterPasswordHash',
  'userKey',
  'publicKey',
  'privateKey',
  'invitation',
])
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function parseInvitedAccountRegistration(
  body: unknown,
): Registration | null {
  if (!object(body) || Object.keys(body).some((key) => !fields.has(key)))
    return null
  const registration = parseAccountRegistrationFields(body)
  if (!registration) return null
  const invite = body.invitation
  if (
    !object(invite) ||
    Object.keys(invite).some(
      (key) => !['organizationId', 'membershipId', 'token'].includes(key),
    ) ||
    typeof invite.organizationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(invite.organizationId) ||
    typeof invite.membershipId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(invite.membershipId) ||
    typeof invite.token !== 'string' ||
    !parseOrganizationMembershipAcceptRequest({ token: invite.token }).ok
  )
    return null
  return {
    ...registration,
    invitation: {
      organizationId: invite.organizationId,
      membershipId: invite.membershipId,
      token: invite.token,
    },
  }
}

export async function createInvitedAccount(
  database: Pick<D1Database, 'prepare'>,
  input: Registration,
  inviteSecret: string,
  now: string,
): Promise<boolean> {
  const inviteTokenHash = await buildOrganizationMembershipInviteTokenHash({
    secret: inviteSecret,
    ...input.invitation,
    emailNormalized: input.email,
  })
  const user = buildBootstrapUserRecord(
    { ...input, emailNormalized: input.email },
    {
      id: crypto.randomUUID(),
      securityStamp: crypto.randomUUID(),
      revisionDate: now,
    },
  )
  // Eligibility is evaluated in the INSERT itself. No read/check/write gap can
  // create an account after revoke/expiry, and uniqueness never replaces keys.
  const result = await database
    .prepare(
      `
    INSERT OR IGNORE INTO users (id,email,email_normalized,display_name,kdf_algorithm,kdf_iterations,kdf_memory,kdf_parallelism,master_password_hash,user_key,public_key,private_key,security_stamp,revision_date)
    SELECT ?,?,?,?,'pbkdf2-sha256',600000,NULL,NULL,?,?,?,?,?,?
    WHERE EXISTS (
      SELECT 1 FROM organization_users invitation
      INNER JOIN organizations organization ON organization.id = invitation.organization_id AND organization.enabled = 1
      WHERE invitation.id = ? AND invitation.organization_id = ? AND invitation.email = ?
        AND invitation.status = 0 AND invitation.user_id IS NULL
        AND invitation.invite_token_hash = ? AND invitation.invite_expires_at > ?
    )
    RETURNING id
  `,
    )
    .bind(
      user.id,
      user.email,
      user.emailNormalized,
      user.displayName,
      user.masterPasswordHash,
      user.userKey,
      user.publicKey,
      user.privateKey,
      user.securityStamp,
      now,
      input.invitation.membershipId,
      input.invitation.organizationId,
      input.email,
      inviteTokenHash,
      now,
    )
    .first<{ id: string }>()
  return result?.id === user.id
}
