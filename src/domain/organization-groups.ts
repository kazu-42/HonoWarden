export type OrganizationGroupCollectionGrant = {
  id: string
  readOnly: boolean
  hidePasswords: boolean
  manage: boolean
}

export type OrganizationGroupWriteRequest = {
  name: string
  collections: OrganizationGroupCollectionGrant[]
  users: string[]
}

export type OrganizationGroupRecord = OrganizationGroupWriteRequest & {
  id: string
  organizationId: string
  revisionDate: string
}

export const organizationGroupPolicy = {
  maxNameLength: 100,
  maxCollections: 100,
  maxMembers: 100,
  maxIdLength: 128,
  maxBodyBytes: 128 * 1024,
} as const

export function isOrganizationGroupIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)
}

export function parseOrganizationGroupWriteRequest(
  body: unknown,
): { ok: true; value: OrganizationGroupWriteRequest } | { ok: false } {
  const object = normalize(body)
  if (!object || !only(object, ['name', 'collections', 'users']))
    return { ok: false }
  const name = object.get('name')
  const collections = object.get('collections')
  const users = object.get('users')
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    name.length > organizationGroupPolicy.maxNameLength ||
    [...name].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !Array.isArray(collections) ||
    collections.length > organizationGroupPolicy.maxCollections ||
    !Array.isArray(users) ||
    users.length > organizationGroupPolicy.maxMembers ||
    !users.every(isOrganizationGroupIdentifier) ||
    new Set(users).size !== users.length
  )
    return { ok: false }
  const grants: OrganizationGroupCollectionGrant[] = []
  const seen = new Set<string>()
  for (const collection of collections) {
    const grant = normalize(collection)
    const id = grant?.get('id')
    if (
      !grant ||
      !only(grant, ['id', 'readonly', 'hidepasswords', 'manage']) ||
      !isOrganizationGroupIdentifier(id) ||
      seen.has(id)
    )
      return { ok: false }
    const readOnly = grant.get('readonly') ?? false
    const hidePasswords = grant.get('hidepasswords') ?? false
    const manage = grant.get('manage') ?? false
    if (
      (grant.has('readonly') && typeof grant.get('readonly') !== 'boolean') ||
      (grant.has('hidepasswords') &&
        typeof grant.get('hidepasswords') !== 'boolean') ||
      (grant.has('manage') && typeof grant.get('manage') !== 'boolean')
    )
      return { ok: false }
    seen.add(id)
    grants.push({
      id,
      readOnly: readOnly as boolean,
      hidePasswords: hidePasswords as boolean,
      manage: manage as boolean,
    })
  }
  return { ok: true, value: { name, collections: grants, users: [...users] } }
}

export function projectOrganizationGroup(
  record: OrganizationGroupRecord,
  details = false,
) {
  return {
    Object: details ? 'groupDetails' : 'group',
    Id: record.id,
    OrganizationId: record.organizationId,
    Name: record.name,
    ExternalId: null,
    ...(details
      ? {
          Collections: record.collections.map((grant) => ({
            Id: grant.id,
            ReadOnly: grant.readOnly,
            HidePasswords: grant.hidePasswords,
            Manage: grant.manage,
          })),
        }
      : {}),
  }
}

export function organizationGroupEtag(record: {
  id: string
  revisionDate: string
}): string {
  return `"${record.id}:${record.revisionDate}"`
}

export function parseOrganizationGroupIfMatch(
  value: string | undefined,
  groupId: string,
): { ok: true; expectedRevisionDate?: string } | { ok: false } {
  if (value === undefined) return { ok: true }
  const prefix = `"${groupId}:`
  if (!value.startsWith(prefix) || !value.endsWith('"')) return { ok: false }
  const revision = value.slice(prefix.length, -1)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(revision) ||
    !Number.isFinite(Date.parse(revision))
  )
    return { ok: false }
  return { ok: true, expectedRevisionDate: revision }
}

function normalize(value: unknown): Map<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const result = new Map<string, unknown>()
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase()
    if (result.has(normalized)) return null
    result.set(normalized, entry)
  }
  return result
}

function only(object: Map<string, unknown>, allowed: string[]): boolean {
  return [...object.keys()].every((key) => allowed.includes(key))
}
