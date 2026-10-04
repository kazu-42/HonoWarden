import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  issueOrganizationAuditCursor,
  organizationAuditEventNames,
  organizationAuditPolicy,
  parseOrganizationAuditQuery,
  projectOrganizationAuditRecord,
  serializeAuditCsvCell,
  serializeOrganizationAuditCsv,
  type OrganizationAuditQuery,
} from '../src/domain/organization-audit'

const now = '2026-10-04T12:00:00.250Z'
const secret = 'organization-audit-cursor-secret-32-bytes'
const request = {
  operation: 'query' as const,
  organizationId: 'org-a',
  actorUserId: 'admin-a',
  now,
  cursorSecret: secret,
}
const position = { occurredAt: '2026-10-03T12:00:00.250Z', id: 'audit-a' }
const storedRecord = {
  id: 'audit-a',
  schemaVersion: 1,
  name: 'organization.member.invite',
  outcome: 'success',
  occurredAt: position.occurredAt,
  actorUserId: 'admin-a',
  targetType: 'organization_user',
  targetId: 'member-a',
}
type RequestOverrides = Partial<
  Parameters<typeof parseOrganizationAuditQuery>[1]
>

async function parse(
  queries: Record<string, string[]> = {},
  overrides: RequestOverrides = {},
) {
  return parseOrganizationAuditQuery(queries, { ...request, ...overrides })
}

async function parsedQuery(
  queries: Record<string, string[]> = {},
): Promise<OrganizationAuditQuery> {
  const result = await parse(queries)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected a valid organization audit query.')
  return result.value
}

async function issue(query: OrganizationAuditQuery) {
  return issueOrganizationAuditCursor({
    query,
    organizationId: request.organizationId,
    actorUserId: request.actorUserId,
    position,
    cursorSecret: secret,
  })
}

function decodedPayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[0]!, 'base64url').toString(),
  ) as Record<string, unknown>
}

function independentlySignedPayload(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(`honowarden:organization-audit-cursor:v1\0${encoded}`)
    .digest('base64url')
  return `${encoded}.${signature}`
}

describe('organization audit query validation', () => {
  it('keeps the durable administration vocabulary and bounded query/export policy explicit', () => {
    expect(organizationAuditEventNames).toEqual([
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
    ])
    expect(organizationAuditPolicy).toEqual({
      defaultLimit: 50,
      maxLimit: 100,
      maxExportRows: 1_000,
      maxWindowDays: 31,
      defaultWindowDays: 7,
      cursorLifetimeSeconds: 900,
      maxCursorBytes: 4_096,
      minCursorSecretBytes: 32,
    })
  })

  it('defaults to a seven-day window with a fifteen-minute cursor lifetime', async () => {
    const issuedAt = Math.floor(Date.parse(now) / 1_000)
    expect(await parse()).toEqual({
      ok: true,
      value: {
        from: '2026-09-27T12:00:00.250Z',
        to: now,
        eventName: null,
        filterActorUserId: null,
        limit: 50,
        cursor: null,
        issuedAt,
        expiresAt: issuedAt + 900,
      },
    })
  })

  it('anchors an omitted start to the supplied end and accepts both limit boundaries', async () => {
    const to = '2026-10-01T12:00:00.000Z'
    for (const limit of ['1', '100']) {
      const query = await parsedQuery({ to: [to], limit: [limit] })
      expect(query).toMatchObject({
        from: '2026-09-24T12:00:00.000Z',
        to,
        limit: Number(limit),
      })
    }
  })

  it.each(organizationAuditEventNames)(
    'accepts supported administration event %s and an independent actor filter',
    async (eventName) => {
      expect(
        await parsedQuery({
          eventName: [eventName],
          actorUserId: ['member-a'],
        }),
      ).toMatchObject({ eventName, filterActorUserId: 'member-a' })
    },
  )

  const invalidQueries: Array<[string, Record<string, string[]>]> = [
    ['unknown parameter', { unexpected: ['value'] }],
    ['different parameter casing', { From: [now] }],
    ['legacy cursor parameter', { cursor: ['token'] }],
    ['empty value list', { from: [] }],
    ['empty string', { eventName: [''] }],
    ['repeated equal parameter', { limit: ['50', '50'] }],
    ['repeated different parameter', { actorUserId: ['admin-a', 'admin-b'] }],
    ['unsupported event', { eventName: ['auth.password_grant'] }],
    ['actor containing whitespace', { actorUserId: [' member-a'] }],
    ['actor containing a separator', { actorUserId: ['member/a'] }],
    ['oversized actor', { actorUserId: ['a'.repeat(129)] }],
    ['zero limit', { limit: ['0'] }],
    ['negative limit', { limit: ['-1'] }],
    ['limit over maximum', { limit: ['101'] }],
    ['fractional limit', { limit: ['1.5'] }],
    ['leading-zero limit', { limit: ['050'] }],
    ['signed limit', { limit: ['+50'] }],
    ['limit with whitespace', { limit: [' 50'] }],
    ['exponential limit', { limit: ['1e2'] }],
    ['unsafe integer limit', { limit: ['9007199254740992'] }],
  ]
  it.each(invalidQueries)(
    'rejects %s without a partial query',
    async (_, queries) => {
      expect(await parse(queries)).toEqual({ ok: false })
    },
  )

  it.each([
    '2026-10-03',
    '2026-10-03T12:00:00Z',
    '2026-10-03T12:00:00.25Z',
    '2026-10-03T12:00:00.2500Z',
    '2026-10-03T12:00:00.250+00:00',
    '2026-10-03t12:00:00.250z',
    '2026-10-03T12:00:00.250Z ',
    '2026-02-30T12:00:00.250Z',
    '2026-10-03T24:00:00.000Z',
    '2026-10-03T12:00:60.000Z',
  ])('requires a real canonical UTC timestamp: %s', async (timestamp) => {
    expect(await parse({ from: [timestamp] })).toEqual({ ok: false })
    expect(await parse({ to: [timestamp] })).toEqual({ ok: false })
  })

  it('accepts exactly 31 days and rejects wider, empty, reversed and future windows', async () => {
    const from = '2026-09-03T12:00:00.250Z'
    expect(await parsedQuery({ from: [from], to: [now] })).toMatchObject({
      from,
      to: now,
    })
    const invalidWindows: Record<string, string[]>[] = [
      { from: ['2026-09-03T12:00:00.249Z'], to: [now] },
      { from: [now], to: [now] },
      { from: [now], to: ['2026-10-03T12:00:00.250Z'] },
      { to: ['2026-10-04T12:00:00.251Z'] },
    ]
    for (const queries of invalidWindows) {
      expect(await parse(queries)).toEqual({ ok: false })
    }
  })

  it('rejects invalid request bindings and a noncanonical request clock', async () => {
    const invalidRequests: RequestOverrides[] = [
      { organizationId: 'org/a' },
      { actorUserId: 'admin a' },
      { now: '2026-10-04T12:00:00Z' },
    ]
    for (const overrides of invalidRequests) {
      expect(await parse({}, overrides)).toEqual({ ok: false })
    }
  })

  it('uses the fixed export bound and rejects every pagination parameter', async () => {
    const result = await parse(
      { actorUserId: ['admin-a'] },
      { operation: 'export' },
    )
    expect(result).toMatchObject({
      ok: true,
      value: { limit: 1_000, cursor: null, filterActorUserId: 'admin-a' },
    })
    const token = await issue(await parsedQuery())
    const paginationQueries: Record<string, string[]>[] = [
      { limit: ['50'] },
      { continuationToken: [token] },
    ]
    for (const queries of paginationQueries) {
      expect(await parse(queries, { operation: 'export' })).toEqual({
        ok: false,
      })
    }
  })
})

describe('organization audit continuation cursor', () => {
  it('restores a token-only query and preserves the original window and lifetime', async () => {
    const query = await parsedQuery({
      eventName: ['organization.member.confirm'],
      actorUserId: ['member-a'],
      limit: ['17'],
    })
    const token = await issue(query)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u)
    expect(
      await parse(
        { continuationToken: [token] },
        { now: '2026-10-04T12:10:00.750Z' },
      ),
    ).toEqual({ ok: true, value: { ...query, cursor: position } })

    const continued = await parse({
      continuationToken: [token],
      from: [query.from],
      to: [query.to],
      eventName: [query.eventName!],
      actorUserId: [query.filterActorUserId!],
      limit: [String(query.limit)],
    })
    expect(continued).toEqual({
      ok: true,
      value: { ...query, cursor: position },
    })

    const nextToken = await issueOrganizationAuditCursor({
      query: { ...query, cursor: position },
      organizationId: 'org-a',
      actorUserId: 'admin-a',
      position: { occurredAt: '2026-10-02T00:00:00.000Z', id: 'audit-b' },
      cursorSecret: secret,
    })
    expect(decodedPayload(nextToken)).toMatchObject({
      issuedAt: query.issuedAt,
      expiresAt: query.expiresAt,
      occurredAt: '2026-10-02T00:00:00.000Z',
      id: 'audit-b',
    })
  })

  it('binds a continuation to organization, authenticated actor, secret and every query filter', async () => {
    const query = await parsedQuery({
      eventName: ['organization.member.confirm'],
      actorUserId: ['member-a'],
      limit: ['17'],
    })
    const token = await issue(query)
    const mismatchedBindings: RequestOverrides[] = [
      { organizationId: 'org-b' },
      { actorUserId: 'admin-b' },
      { cursorSecret: `${secret}-other` },
      { cursorSecret: 'short' },
    ]
    for (const overrides of mismatchedBindings) {
      expect(await parse({ continuationToken: [token] }, overrides)).toEqual({
        ok: false,
      })
    }
    const mismatchedFilters: Record<string, string[]>[] = [
      { from: ['2026-09-28T12:00:00.250Z'] },
      { to: ['2026-10-04T11:59:59.250Z'] },
      { eventName: ['organization.member.invite'] },
      { actorUserId: ['member-b'] },
      { limit: ['18'] },
    ]
    for (const filters of mismatchedFilters) {
      expect(await parse({ continuationToken: [token], ...filters })).toEqual({
        ok: false,
      })
    }
  })

  it('expires at the original fifteen-minute boundary and rejects clocks preceding issuance', async () => {
    const token = await issue(await parsedQuery())
    expect(
      (
        await parse(
          { continuationToken: [token] },
          { now: '2026-10-04T12:14:59.999Z' },
        )
      ).ok,
    ).toBe(true)
    for (const changedNow of [
      '2026-10-04T12:15:00.000Z',
      '2026-10-04T11:59:59.999Z',
    ]) {
      expect(
        await parse({ continuationToken: [token] }, { now: changedNow }),
      ).toEqual({ ok: false })
    }
  })

  it('rejects payload/signature tampering, malformed encoding and oversized tokens', async () => {
    const token = await issue(await parsedQuery())
    const [payload, signature] = token.split('.') as [string, string]
    const payloadChanged = `${payload[0] === 'A' ? 'B' : 'A'}${payload.slice(1)}`
    const signatureChanged = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    for (const invalidToken of [
      `${payloadChanged}.${signature}`,
      `${payload}.${signatureChanged}`,
      `${token}.extra`,
      `${payload}=.${signature}`,
      `${payload}.${signature}=`,
      `!.${signature}`,
      `${payload}.${signature.slice(1)}`,
      'x'.repeat(4_097),
      'é'.repeat(4_097),
    ]) {
      expect(await parse({ continuationToken: [invalidToken] })).toEqual({
        ok: false,
      })
    }
  })

  it('validates signed payload shape and position even when the signature is valid', async () => {
    const query = await parsedQuery()
    const payload = decodedPayload(await issue(query))
    const invalidChanges: Record<string, unknown>[] = [
      { v: 2 },
      { purpose: 'different-purpose' },
      { unknown: 'not-permitted' },
      { id: 'audit/a' },
      { occurredAt: '2026-10-03T12:00:00Z' },
      { occurredAt: '2026-09-27T12:00:00.249Z' },
      { occurredAt: query.to },
      { from: '2026-09-01T12:00:00.250Z' },
      { eventName: 'auth.password_grant' },
      { filterActorUserId: 'member/a' },
      { limit: 101 },
      { limit: '50' },
      { issuedAt: query.issuedAt + 1, expiresAt: query.expiresAt + 1 },
      { expiresAt: query.expiresAt + 1 },
    ]
    for (const change of invalidChanges) {
      const token = independentlySignedPayload({ ...payload, ...change })
      expect(await parse({ continuationToken: [token] })).toEqual({ ok: false })
    }
    const missingId = { ...payload }
    delete missingId.id
    expect(
      await parse({
        continuationToken: [independentlySignedPayload(missingId)],
      }),
    ).toEqual({ ok: false })
    expect(
      await parse({ continuationToken: [independentlySignedPayload([])] }),
    ).toEqual({ ok: false })
  })

  it('allows a position at the inclusive start but refuses invalid position/configuration on issue', async () => {
    const query = await parsedQuery()
    const input = {
      query,
      organizationId: 'org-a',
      actorUserId: 'admin-a',
      position,
      cursorSecret: secret,
    }
    const startPosition = { occurredAt: query.from, id: 'audit-start' }
    const token = await issueOrganizationAuditCursor({
      ...input,
      position: startPosition,
    })
    expect(await parse({ continuationToken: [token] })).toEqual({
      ok: true,
      value: { ...query, cursor: startPosition },
    })
    for (const invalidPosition of [
      { occurredAt: query.to, id: 'audit-a' },
      { occurredAt: '2026-09-27T12:00:00.249Z', id: 'audit-a' },
      { occurredAt: position.occurredAt, id: 'audit/a' },
      { occurredAt: 'not-a-timestamp', id: 'audit-a' },
    ]) {
      await expect(
        issueOrganizationAuditCursor({ ...input, position: invalidPosition }),
      ).rejects.toThrow(/position/u)
    }
    await expect(
      issueOrganizationAuditCursor({ ...input, cursorSecret: 'x'.repeat(31) }),
    ).rejects.toThrow(/configuration/u)
    const utf8Secret = 'é'.repeat(16)
    const utf8Token = await issueOrganizationAuditCursor({
      ...input,
      cursorSecret: utf8Secret,
    })
    expect(
      (
        await parse(
          { continuationToken: [utf8Token] },
          { cursorSecret: utf8Secret },
        )
      ).ok,
    ).toBe(true)
  })
})

describe('organization audit public projection', () => {
  it.each([
    ['organization.group.create', 'organization_group'],
    ['organization.group.update', 'organization_group'],
    ['organization.group.delete', 'organization_group'],
    ['organization.group.member.remove', 'organization_group'],
    ['organization.policy.update', 'organization'],
  ])('accepts the exact durable target contract for %s', (name, targetType) => {
    expect(
      projectOrganizationAuditRecord({ ...storedRecord, name, targetType }),
    ).toMatchObject({ name, targetType })
    expect(() =>
      projectOrganizationAuditRecord({ ...storedRecord, name }),
    ).toThrow(/projection/u)
  })

  it('projects only approved metadata and excludes raw context, request and device fields', () => {
    const row = {
      ...storedRecord,
      requestId: 'must-not-leak-request-id',
      deviceIdentifier: 'must-not-leak-device',
      actor: {
        userId: 'admin-a',
        deviceIdentifier: 'must-not-leak-nested-device',
      },
      context: {
        email: 'must-not-leak@example.test',
        encryptedPayload: 'must-not-leak-ciphertext',
      },
      rawEventJson: '{"secret":"must-not-leak"}',
      organizationId: 'org-a',
    }
    const projected = projectOrganizationAuditRecord(row)
    expect(projected).toEqual({
      object: 'organizationAuditEvent',
      ...storedRecord,
    })
    expect(JSON.stringify(projected)).not.toContain('must-not-leak')
    expect(projected).not.toHaveProperty('organizationId')
  })

  it.each([null, '', 'member/a', 'member a', 'member\0a', 'x'.repeat(129)])(
    'maps malformed or absent optional identities to null: %s',
    (id) => {
      expect(
        projectOrganizationAuditRecord({
          ...storedRecord,
          actorUserId: id,
          targetId: id,
        }),
      ).toMatchObject({ actorUserId: null, targetId: null })
    },
  )

  it('preserves valid optional identifier boundaries', () => {
    expect(
      projectOrganizationAuditRecord({
        ...storedRecord,
        actorUserId: 'x',
        targetId: 'x'.repeat(128),
      }),
    ).toMatchObject({ actorUserId: 'x', targetId: 'x'.repeat(128) })
  })

  it.each([
    { id: '' },
    { id: 'audit/a' },
    { id: 'x'.repeat(129) },
    { occurredAt: 'not-a-timestamp' },
    { occurredAt: '2026-02-30T12:00:00.250Z' },
    { occurredAt: '2026-10-03T12:00:00Z' },
    { schemaVersion: 2 },
    { name: 'auth.password_grant' },
    { outcome: 'failure' },
    { targetType: 'account' },
  ])('fails loudly for invalid required event metadata %#', (change) => {
    expect(() =>
      projectOrganizationAuditRecord({ ...storedRecord, ...change }),
    ).toThrow(/projection/u)
  })
})

describe('organization audit CSV serialization', () => {
  it('quotes every header and value, uses CRLF and represents absent IDs with an empty quoted cell', () => {
    const first = projectOrganizationAuditRecord(storedRecord)
    const second = projectOrganizationAuditRecord({
      ...storedRecord,
      id: 'audit-b',
      actorUserId: null,
      targetId: null,
    })
    const header =
      '"id","occurredAt","name","outcome","actorUserId","targetType","targetId"\r\n'
    expect(serializeOrganizationAuditCsv([])).toBe(header)
    expect(serializeOrganizationAuditCsv([first, second])).toBe(
      header +
        '"audit-a","2026-10-03T12:00:00.250Z","organization.member.invite","success","admin-a","organization_user","member-a"\r\n' +
        '"audit-b","2026-10-03T12:00:00.250Z","organization.member.invite","success","","organization_user",""\r\n',
    )
  })

  it.each([
    [null, '""'],
    ['', '""'],
    ['a,b', '"a,b"'],
    ['a"b', '"a""b"'],
    ['日本語,é', '"日本語,é"'],
    ['line one\r\nline two', '"line one\r\nline two"'],
    ['space before safe value', '"space before safe value"'],
    ['  42', '"  42"'],
    ['safe=value', '"safe=value"'],
    ["'already safe", '"\'already safe"'],
  ])('round-trips quoted literal cell %#', (value, expected) => {
    expect(serializeAuditCsvCell(value)).toBe(expected)
  })

  it.each([
    '=HYPERLINK("https://example.test")',
    '+1+1',
    '-1+1',
    '@SUM(1,1)',
    '   =1+1',
    '\u00a0+1+1',
    '\u2003@SUM(1,1)',
    '\0=1+1',
    '\u0001\u001f-1+1',
    '\tplain text',
    '\rplain text',
    '\nplain text',
    '\t \0=1+1',
  ])(
    'prefixes spreadsheet formulas or dangerous leading controls: %j',
    (value) => {
      const escaped = value.replace(/"/gu, '""')
      expect(serializeAuditCsvCell(value)).toBe(`"'${escaped}"`)
    },
  )

  it('accepts exactly the export bound and fails loudly instead of truncating overflow', () => {
    const record = projectOrganizationAuditRecord(storedRecord)
    const atBound = Array.from({ length: 1_000 }, () => record)
    expect(serializeOrganizationAuditCsv(atBound).split('\r\n')).toHaveLength(
      1_002,
    )
    expect(() => serializeOrganizationAuditCsv([...atBound, record])).toThrow(
      /bound/u,
    )
  })
})
