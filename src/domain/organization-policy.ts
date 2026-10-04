export const organizationPolicyType = { requiredTotp: 0 } as const

export type OrganizationPolicyRecord = {
  id: string | null
  organizationId: string
  type: 0
  enabled: boolean
  revisionDate: string | null
}

export type OrganizationPolicyUpdateRequest = { type: 0; enabled: boolean }
export type OrganizationPolicyParseResult =
  | { ok: true; value: OrganizationPolicyUpdateRequest }
  | { ok: false; code: 'invalid_request' | 'unsupported_feature' }

export function parseOrganizationPolicyUpdateRequest(
  body: unknown,
  requestedType: unknown = organizationPolicyType.requiredTotp,
): OrganizationPolicyParseResult {
  const typeResult = parsePolicyType(requestedType)
  if (typeResult) return typeResult
  if (!isPlainObject(body)) return { ok: false, code: 'invalid_request' }
  const values = new Map<string, unknown>()
  for (const [key, value] of Object.entries(body)) {
    const normalized = key.toLowerCase()
    if (
      values.has(normalized) ||
      !['type', 'enabled', 'data'].includes(normalized)
    )
      return { ok: false, code: 'invalid_request' }
    values.set(normalized, value)
  }
  if (values.has('type')) {
    const bodyTypeResult = parsePolicyType(values.get('type'))
    if (bodyTypeResult) return bodyTypeResult
  }
  const enabled = values.get('enabled')
  if (typeof enabled !== 'boolean')
    return { ok: false, code: 'invalid_request' }
  if (values.has('data')) {
    const data = values.get('data')
    if (data !== null) {
      if (!isPlainObject(data)) return { ok: false, code: 'invalid_request' }
      if (Object.keys(data).length > 0)
        return { ok: false, code: 'unsupported_feature' }
    }
  }
  return { ok: true, value: { type: 0, enabled } }
}

export function projectOrganizationPolicy(record: OrganizationPolicyRecord) {
  return {
    Object: 'policy' as const,
    Id: record.id,
    OrganizationId: record.organizationId,
    Type: organizationPolicyType.requiredTotp,
    Enabled: record.enabled,
    Data: null,
    RevisionDate: record.revisionDate,
  }
}

function parsePolicyType(
  value: unknown,
): Extract<OrganizationPolicyParseResult, { ok: false }> | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return { ok: false, code: 'invalid_request' }
  return value === organizationPolicyType.requiredTotp
    ? null
    : { ok: false, code: 'unsupported_feature' }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
