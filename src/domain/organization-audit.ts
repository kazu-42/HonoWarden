export const organizationAuditEventNames = [
  'organization.member.invite',
  'organization.member.reinvite',
  'organization.member.accept',
  'organization.member.confirm',
  'organization.member.update',
  'organization.member.revoke',
  'organization.member.remove',
  'organization.group.create',
  'organization.group.update',
  'organization.group.delete',
  'organization.group.member.remove',
  'organization.policy.update',
  'organization.settings.update',
  'organization.mail_test.request',
] as const

export type OrganizationAuditEventName =
  (typeof organizationAuditEventNames)[number]

export const organizationAuditEventTargets: Record<
  OrganizationAuditEventName,
  OrganizationAuditTargetType
> = {
  'organization.member.invite': 'organization_user',
  'organization.member.reinvite': 'organization_user',
  'organization.member.accept': 'organization_user',
  'organization.member.confirm': 'organization_user',
  'organization.member.update': 'organization_user',
  'organization.member.revoke': 'organization_user',
  'organization.member.remove': 'organization_user',
  'organization.group.create': 'organization_group',
  'organization.group.update': 'organization_group',
  'organization.group.delete': 'organization_group',
  'organization.group.member.remove': 'organization_group',
  'organization.policy.update': 'organization',
  'organization.settings.update': 'organization',
  'organization.mail_test.request': 'organization',
}

export type OrganizationAuditTargetType =
  'organization_user' | 'organization_group' | 'organization'

export const organizationAuditPolicy = {
  defaultLimit: 50,
  maxLimit: 100,
  maxExportRows: 1_000,
  maxWindowDays: 31,
  defaultWindowDays: 7,
  cursorLifetimeSeconds: 900,
  maxCursorBytes: 4_096,
  minCursorSecretBytes: 32,
} as const

export type OrganizationAuditPosition = { occurredAt: string; id: string }
export type OrganizationAuditQuery = {
  from: string
  to: string
  eventName: OrganizationAuditEventName | null
  filterActorUserId: string | null
  limit: number
  cursor: OrganizationAuditPosition | null
  issuedAt: number
  expiresAt: number
}

export type OrganizationAuditRecord = {
  object: 'organizationAuditEvent'
  id: string
  schemaVersion: 1
  name: OrganizationAuditEventName
  outcome: 'success'
  occurredAt: string
  actorUserId: string | null
  targetType: OrganizationAuditTargetType
  targetId: string | null
}

export type OrganizationAuditStoredProjection = {
  id: string
  schemaVersion: number
  name: string
  outcome: string
  occurredAt: string
  actorUserId: string | null
  targetType: string
  targetId: string | null
}

type CursorPayload = {
  v: 1
  purpose: 'organization-audit'
  organizationId: string
  actorUserId: string
  from: string
  to: string
  eventName: OrganizationAuditEventName | null
  filterActorUserId: string | null
  limit: number
  occurredAt: string
  id: string
  issuedAt: number
  expiresAt: number
}

const cursorPurpose = 'honowarden:organization-audit-cursor:v1\0'
const millisecondsPerDay = 86_400_000
const queryKeys = ['from', 'to', 'eventName', 'actorUserId']
const cursorKeys = [
  'v',
  'purpose',
  'organizationId',
  'actorUserId',
  'from',
  'to',
  'eventName',
  'filterActorUserId',
  'limit',
  'occurredAt',
  'id',
  'issuedAt',
  'expiresAt',
]

export function isOrganizationAuditId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

export function isOrganizationAuditCursorSecret(
  secret: unknown,
): secret is string {
  return (
    typeof secret === 'string' &&
    new TextEncoder().encode(secret).byteLength >=
      organizationAuditPolicy.minCursorSecretBytes
  )
}

export async function parseOrganizationAuditQuery(
  queries: Record<string, string[]>,
  input: {
    operation: 'query' | 'export'
    organizationId: string
    actorUserId: string
    now: string
    cursorSecret: string
  },
): Promise<{ ok: true; value: OrganizationAuditQuery } | { ok: false }> {
  const allowedKeys =
    input.operation === 'query'
      ? [...queryKeys, 'limit', 'continuationToken']
      : queryKeys
  if (
    !isOrganizationAuditId(input.organizationId) ||
    !isOrganizationAuditId(input.actorUserId) ||
    !isCanonicalTimestamp(input.now) ||
    Object.entries(queries).some(
      ([key, values]) =>
        !allowedKeys.includes(key) ||
        values.length !== 1 ||
        typeof values[0] !== 'string' ||
        values[0].length === 0,
    )
  ) {
    return { ok: false }
  }
  const read = (key: string): string | undefined => queries[key]?.[0]
  const nowSeconds = Math.floor(Date.parse(input.now) / 1_000)
  const rawToken = read('continuationToken')
  const token = rawToken
    ? await verifyCursor(rawToken, input.cursorSecret, nowSeconds)
    : null
  if (
    rawToken &&
    (!token ||
      token.organizationId !== input.organizationId ||
      token.actorUserId !== input.actorUserId)
  ) {
    return { ok: false }
  }
  const to = read('to') ?? token?.to ?? input.now
  const from =
    read('from') ??
    token?.from ??
    (isCanonicalTimestamp(to)
      ? new Date(
          Date.parse(to) -
            organizationAuditPolicy.defaultWindowDays * millisecondsPerDay,
        ).toISOString()
      : '')
  const rawEventName = read('eventName') ?? token?.eventName ?? null
  const filterActorUserId =
    read('actorUserId') ?? token?.filterActorUserId ?? null
  const rawLimit = read('limit')
  const limit =
    input.operation === 'export'
      ? organizationAuditPolicy.maxExportRows
      : rawLimit === undefined
        ? (token?.limit ?? organizationAuditPolicy.defaultLimit)
        : parseLimit(rawLimit)
  if (
    !validWindow(from, to, input.now) ||
    (rawEventName !== null && !isEventName(rawEventName)) ||
    (filterActorUserId !== null && !isOrganizationAuditId(filterActorUserId)) ||
    limit === null ||
    (token &&
      (from !== token.from ||
        to !== token.to ||
        rawEventName !== token.eventName ||
        filterActorUserId !== token.filterActorUserId ||
        limit !== token.limit))
  ) {
    return { ok: false }
  }
  return {
    ok: true,
    value: {
      from,
      to,
      eventName: rawEventName as OrganizationAuditEventName | null,
      filterActorUserId,
      limit,
      cursor: token ? { occurredAt: token.occurredAt, id: token.id } : null,
      issuedAt: token?.issuedAt ?? nowSeconds,
      expiresAt:
        token?.expiresAt ??
        nowSeconds + organizationAuditPolicy.cursorLifetimeSeconds,
    },
  }
}

export async function issueOrganizationAuditCursor(input: {
  query: OrganizationAuditQuery
  organizationId: string
  actorUserId: string
  position: OrganizationAuditPosition
  cursorSecret: string
}): Promise<string> {
  if (!isOrganizationAuditCursorSecret(input.cursorSecret))
    throw new Error('Organization audit cursor configuration is unavailable.')
  const payload: CursorPayload = {
    v: 1,
    purpose: 'organization-audit',
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    from: input.query.from,
    to: input.query.to,
    eventName: input.query.eventName,
    filterActorUserId: input.query.filterActorUserId,
    limit: input.query.limit,
    occurredAt: input.position.occurredAt,
    id: input.position.id,
    issuedAt: input.query.issuedAt,
    expiresAt: input.query.expiresAt,
  }
  if (!validCursorPayload(payload, payload.issuedAt))
    throw new Error('Organization audit cursor position is invalid.')
  const encoded = encodeBytes(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await cursorKey(input.cursorSecret, ['sign'])
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(cursorPurpose + encoded),
  )
  const token = `${encoded}.${encodeBytes(new Uint8Array(signature))}`
  if (token.length > organizationAuditPolicy.maxCursorBytes)
    throw new Error('Organization audit cursor exceeds its bound.')
  return token
}

export function projectOrganizationAuditRecord(
  row: OrganizationAuditStoredProjection,
): OrganizationAuditRecord {
  if (
    !isOrganizationAuditId(row.id) ||
    !isCanonicalTimestamp(row.occurredAt) ||
    row.schemaVersion !== 1 ||
    !isEventName(row.name) ||
    row.outcome !== 'success' ||
    row.targetType !== organizationAuditEventTargets[row.name]
  ) {
    throw new Error('Organization audit record projection is invalid.')
  }
  return {
    object: 'organizationAuditEvent',
    id: row.id,
    schemaVersion: 1,
    name: row.name,
    outcome: 'success',
    occurredAt: row.occurredAt,
    actorUserId: isOrganizationAuditId(row.actorUserId)
      ? row.actorUserId
      : null,
    targetType: organizationAuditEventTargets[row.name],
    targetId: isOrganizationAuditId(row.targetId) ? row.targetId : null,
  }
}

export function organizationAuditAvailability(
  optionalAuditLoggingEnabled: boolean,
) {
  return {
    coverage: 'partial' as const,
    recordedActivity: 'committed_organization_administration' as const,
    persistence: 'required_transactional' as const,
    outcomes: ['success'] as const,
    eventNames: organizationAuditEventNames,
    optionalAuditLoggingEnabled,
    optionalAuditLoggingHistory: 'unknown' as const,
    retentionDays: 365,
  }
}

export function serializeAuditCsvCell(value: string | null): string {
  let cell = value ?? ''
  if (/^[\t\r\n]/u.test(cell) || /^[\s\p{Cc}]*[=+\-@]/u.test(cell))
    cell = `'${cell}`
  return `"${cell.replace(/"/g, '""')}"`
}

export function serializeOrganizationAuditCsv(
  records: readonly OrganizationAuditRecord[],
): string {
  if (records.length > organizationAuditPolicy.maxExportRows)
    throw new Error('Organization audit export exceeds its bound.')
  const columns = [
    'id',
    'occurredAt',
    'name',
    'outcome',
    'actorUserId',
    'targetType',
    'targetId',
  ] as const
  return (
    [
      columns.map(serializeAuditCsvCell).join(','),
      ...records.map((record) =>
        columns
          .map((column) => serializeAuditCsvCell(record[column]))
          .join(','),
      ),
    ].join('\r\n') + '\r\n'
  )
}

function isEventName(value: unknown): value is OrganizationAuditEventName {
  return (
    typeof value === 'string' &&
    (organizationAuditEventNames as readonly string[]).includes(value)
  )
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return false
  const timestamp = Date.parse(value)
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  )
}

function validWindow(from: string, to: string, now: string): boolean {
  return (
    isCanonicalTimestamp(from) &&
    isCanonicalTimestamp(to) &&
    from < to &&
    Date.parse(to) - Date.parse(from) <=
      organizationAuditPolicy.maxWindowDays * millisecondsPerDay &&
    to <= now
  )
}

function parseLimit(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) &&
    parsed <= organizationAuditPolicy.maxLimit
    ? parsed
    : null
}

async function verifyCursor(
  token: string,
  secret: string,
  nowSeconds: number,
): Promise<CursorPayload | null> {
  if (
    token.length > organizationAuditPolicy.maxCursorBytes ||
    !isOrganizationAuditCursorSecret(secret)
  )
    return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadEncoded, signatureEncoded] = parts
  if (!payloadEncoded || !signatureEncoded || signatureEncoded.length !== 43)
    return null
  let signature: Uint8Array<ArrayBuffer> | null
  let payloadBytes: Uint8Array<ArrayBuffer> | null
  try {
    signature = decodeBytes(signatureEncoded)
    payloadBytes = decodeBytes(payloadEncoded)
  } catch {
    return null
  }
  if (!signature || !payloadBytes || signature.byteLength !== 32) return null
  const key = await cursorKey(secret, ['verify'])
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(cursorPurpose + payloadEncoded),
    ))
  )
    return null
  try {
    const payload: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        payloadBytes,
      ),
    )
    return validCursorPayload(payload, nowSeconds) ? payload : null
  } catch {
    return null
  }
}

function validCursorPayload(
  value: unknown,
  nowSeconds: number,
): value is CursorPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const payload = value as Record<string, unknown>
  if (
    Object.keys(payload).length !== cursorKeys.length ||
    Object.keys(payload).some((key) => !cursorKeys.includes(key)) ||
    payload.v !== 1 ||
    payload.purpose !== 'organization-audit' ||
    !isOrganizationAuditId(payload.organizationId) ||
    !isOrganizationAuditId(payload.actorUserId) ||
    !isCanonicalTimestamp(payload.from) ||
    !isCanonicalTimestamp(payload.to) ||
    !isCanonicalTimestamp(payload.occurredAt) ||
    !isOrganizationAuditId(payload.id) ||
    (payload.eventName !== null && !isEventName(payload.eventName)) ||
    (payload.filterActorUserId !== null &&
      !isOrganizationAuditId(payload.filterActorUserId)) ||
    typeof payload.limit !== 'number' ||
    !Number.isInteger(payload.limit) ||
    payload.limit < 1 ||
    payload.limit > organizationAuditPolicy.maxLimit ||
    typeof payload.issuedAt !== 'number' ||
    !Number.isSafeInteger(payload.issuedAt) ||
    typeof payload.expiresAt !== 'number' ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.issuedAt > nowSeconds ||
    payload.expiresAt !==
      payload.issuedAt + organizationAuditPolicy.cursorLifetimeSeconds ||
    payload.expiresAt <= nowSeconds
  )
    return false
  return (
    validWindow(
      payload.from,
      payload.to,
      new Date(nowSeconds * 1_000 + 999).toISOString(),
    ) &&
    payload.occurredAt >= payload.from &&
    payload.occurredAt < payload.to
  )
}

async function cursorKey(
  secret: string,
  usages: ('sign' | 'verify')[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return encodeBytes(bytes) === value ? bytes : null
}
