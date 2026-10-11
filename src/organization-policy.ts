import {
  parseOrganizationPolicyUpdateRequest,
  projectOrganizationPolicy,
} from './domain/organization-policy'
import {
  listOrganizationPolicies as listPolicies,
  readOrganizationPolicy as readPolicy,
  readOrganizationPolicyImpact as readImpact,
  updateOrganizationPolicy as updatePolicy,
} from './repositories/organization-policy-repository'
import type { OrganizationPolicyActor } from './repositories/organization-policy-sql'

export type { OrganizationPolicyActor } from './repositories/organization-policy-sql'

export type OrganizationPolicyResult =
  | { status: 'success'; body: Record<string, unknown> }
  | {
      status:
        'invalid_request' | 'unsupported_feature' | 'not_found' | 'mfa_required'
    }

type Input = { organizationId: string; actor: OrganizationPolicyActor }

export async function listOrganizationPolicies(
  database: D1Database,
  input: Input,
): Promise<OrganizationPolicyResult> {
  const result = await listPolicies(database, input)
  return result.status === 'success'
    ? {
        status: 'success',
        body: {
          object: 'list',
          data: result.policies.map(projectOrganizationPolicy),
          continuationToken: null,
        },
      }
    : result
}

export async function readOrganizationPolicy(
  database: D1Database,
  input: Input,
): Promise<OrganizationPolicyResult> {
  const result = await readPolicy(database, input)
  return result.status === 'success'
    ? { status: 'success', body: projectOrganizationPolicy(result.policy) }
    : result
}

export async function readOrganizationPolicyImpact(
  database: D1Database,
  input: Input,
): Promise<OrganizationPolicyResult> {
  const result = await readImpact(database, input)
  return result.status === 'success'
    ? {
        status: 'success',
        body: { Object: 'organizationPolicyImpact', ...result.impact },
      }
    : result
}

export async function updateOrganizationPolicy(
  database: D1Database,
  input: Input & {
    body: unknown
    policyType?: number
    now: string
    requestId: string
  },
): Promise<OrganizationPolicyResult> {
  const request = parseOrganizationPolicyUpdateRequest(
    input.body,
    input.policyType,
  )
  if (!request.ok) return { status: request.code }
  const result = await updatePolicy(database, {
    organizationId: input.organizationId,
    actor: input.actor,
    enabled: request.value.enabled,
    now: input.now,
    requestId: input.requestId,
  })
  return result.status === 'success'
    ? { status: 'success', body: projectOrganizationPolicy(result.policy) }
    : result
}
