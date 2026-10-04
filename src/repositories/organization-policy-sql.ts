export type OrganizationPolicyActor = {
  userId: string
  sessionId: string
  deviceIdentifier: string
}

type EnrollmentSqlInput = { organizationId: string; userId: string }
type SessionSqlInput = {
  userId: string
  sessionId: string
  deviceIdentifier: string
}

// Arguments are qualified SQL aliases, never values taken from an HTTP request.
// Bare columns can resolve to these inner tables and turn comparisons into tautologies.
export function organizationSessionTotpVerifiedSql(
  input: SessionSqlInput,
): string {
  validateIdentifiers(Object.values(input))
  return `EXISTS (
    SELECT 1 FROM user_totp required_totp
    JOIN devices required_session ON required_session.user_id = required_totp.user_id
    WHERE required_totp.user_id = ${input.userId}
      AND required_totp.enabled = 1 AND required_totp.verified_at IS NOT NULL
      AND required_totp.credential_generation IS NOT NULL
      AND required_session.identifier = ${input.deviceIdentifier}
      AND required_session.session_id = ${input.sessionId}
      AND required_session.revoked_at IS NULL
      AND required_session.mfa_totp_credential_generation = required_totp.credential_generation
      AND required_session.mfa_verified_at IS NOT NULL
  )`
}

export function organizationTotpEnrollmentAllowsSql(
  input: EnrollmentSqlInput,
): string {
  validateIdentifiers(Object.values(input))
  return `(
    NOT EXISTS (
      SELECT 1 FROM organization_policies required_policy
      WHERE required_policy.organization_id = ${input.organizationId}
        AND required_policy.type = 0 AND required_policy.enabled = 1
    ) OR EXISTS (
      SELECT 1 FROM user_totp required_totp
      WHERE required_totp.user_id = ${input.userId}
        AND required_totp.enabled = 1 AND required_totp.verified_at IS NOT NULL
        AND required_totp.credential_generation IS NOT NULL
    )
  )`
}

export function organizationPolicyAllowsSql(
  input: EnrollmentSqlInput & SessionSqlInput,
): string {
  validateIdentifiers(Object.values(input))
  return `(
    NOT EXISTS (
      SELECT 1 FROM organization_policies required_policy
      WHERE required_policy.organization_id = ${input.organizationId}
        AND required_policy.type = 0 AND required_policy.enabled = 1
    ) OR ${organizationSessionTotpVerifiedSql(input)}
  )`
}

function validateIdentifiers(values: string[]): void {
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/
  if (values.some((value) => !identifier.test(value)))
    throw new Error('Organization policy SQL requires fixed SQL identifiers.')
}
