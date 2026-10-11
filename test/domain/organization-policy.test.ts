import { describe, expect, it } from 'vitest'

import {
  organizationPolicyType,
  parseOrganizationPolicyUpdateRequest,
  projectOrganizationPolicy,
} from '../../src/domain/organization-policy'
import { organizationPolicyAllowsSql } from '../../src/repositories/organization-policy-sql'

const invalid = { ok: false, code: 'invalid_request' }
const unsupported = { ok: false, code: 'unsupported_feature' }

describe('required TOTP organization policy validation', () => {
  it('uses the required TOTP policy type', () => {
    expect(organizationPolicyType.requiredTotp).toBe(0)
  })

  it.each([true, false])('accepts enabled=%s', (enabled) => {
    expect(parseOrganizationPolicyUpdateRequest({ enabled })).toEqual({
      ok: true,
      value: { enabled, type: 0 },
    })
  })

  it.each([undefined, null, {}])(
    'accepts neutral data without inventing policy configuration %#',
    (data) => {
      const body =
        data === undefined ? { enabled: true } : { enabled: true, data }

      expect(parseOrganizationPolicyUpdateRequest(body, 0)).toEqual({
        ok: true,
        value: { enabled: true, type: 0 },
      })
    },
  )

  it('normalizes field casing without changing the requested type', () => {
    expect(
      parseOrganizationPolicyUpdateRequest({
        EnAbLeD: false,
        TYPE: 0,
        Data: {},
      }),
    ).toEqual({ ok: true, value: { enabled: false, type: 0 } })
  })

  it.each([
    undefined,
    null,
    [],
    [{ enabled: true }],
    true,
    false,
    0,
    'enabled',
    {},
    { type: 0 },
    { data: null },
    { enabled: null },
    { enabled: undefined },
    { enabled: 'true' },
    { enabled: 'false' },
    { enabled: 0 },
    { enabled: 1 },
    { enabled: [] },
    { enabled: {} },
  ])('rejects malformed bodies and non-boolean enabled values %#', (body) => {
    expect(parseOrganizationPolicyUpdateRequest(body)).toEqual(invalid)
  })

  it.each([
    { enabled: true, Enabled: true },
    { enabled: true, ENABLED: false },
    { enabled: true, type: 0, Type: 0 },
    { enabled: true, data: null, Data: {} },
  ])('rejects duplicate normalized field names %#', (body) => {
    expect(parseOrganizationPolicyUpdateRequest(body)).toEqual(invalid)
  })

  it.each([
    { enabled: true, extra: false },
    { enabled: true, organizationId: 'another-organization' },
    { enabled: true, id: 'caller-selected-policy' },
    { enabled: true, revisionDate: '2026-10-04T00:00:00.000Z' },
  ])('rejects fields outside the update contract %#', (body) => {
    expect(parseOrganizationPolicyUpdateRequest(body)).toEqual(invalid)
  })

  it.each([
    null,
    '0',
    true,
    [],
    {},
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects malformed policy type values in the body %#', (type) => {
    expect(
      parseOrganizationPolicyUpdateRequest({ enabled: true, type }),
    ).toEqual(invalid)
  })

  it.each([1, 2, 10])('rejects unsupported body type %i', (type) => {
    expect(
      parseOrganizationPolicyUpdateRequest({ enabled: true, type }),
    ).toEqual(unsupported)
  })

  it.each([1, 2, 10])('rejects unsupported requested type %i', (type) => {
    expect(
      parseOrganizationPolicyUpdateRequest({ enabled: true }, type),
    ).toEqual(unsupported)
  })

  it.each([
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects malformed requested policy types %#', (type) => {
    expect(
      parseOrganizationPolicyUpdateRequest({ enabled: true }, type),
    ).toEqual(invalid)
  })

  it.each([
    { data: [] },
    { data: [0] },
    { data: true },
    { data: false },
    { data: 0 },
    { data: '' },
    { data: 'unsupported' },
    { data: new Date('2026-10-04T00:00:00.000Z') },
    { data: Object.create({ enabled: true }) as unknown },
  ])('rejects data that is neither null nor a plain object %#', (fields) => {
    expect(
      parseOrganizationPolicyUpdateRequest({ enabled: true, ...fields }),
    ).toEqual(invalid)
  })

  it.each([
    { requireTotp: true },
    { unsupportedOption: false },
    { nested: {} },
    { neutralLookingOption: null },
  ])('rejects nonempty configuration %#', (data) => {
    expect(
      parseOrganizationPolicyUpdateRequest({ enabled: true, data }),
    ).toEqual(unsupported)
  })

  it('does not mutate a valid caller-owned update body', () => {
    const body = Object.freeze({
      Enabled: true,
      Type: 0,
      Data: Object.freeze({}),
    })

    expect(parseOrganizationPolicyUpdateRequest(body)).toEqual({
      ok: true,
      value: { enabled: true, type: 0 },
    })
    expect(body).toEqual({ Enabled: true, Type: 0, Data: {} })
  })
})

describe('organization policy projection', () => {
  it('projects an absent policy as a disabled default', () => {
    expect(
      projectOrganizationPolicy({
        id: null,
        organizationId: 'organization-a',
        type: 0,
        enabled: false,
        revisionDate: null,
      }),
    ).toEqual({
      Object: 'policy',
      Id: null,
      OrganizationId: 'organization-a',
      Type: 0,
      Enabled: false,
      Data: null,
      RevisionDate: null,
    })
  })

  it.each([true, false])(
    'projects a stored policy with enabled=%s',
    (enabled) => {
      const record = Object.freeze({
        id: 'policy-a',
        organizationId: 'organization-a',
        type: 0 as const,
        enabled,
        revisionDate: '2026-10-04T00:00:00.000Z',
      })

      expect(projectOrganizationPolicy(record)).toEqual({
        Object: 'policy',
        Id: 'policy-a',
        OrganizationId: 'organization-a',
        Type: 0,
        Enabled: enabled,
        Data: null,
        RevisionDate: '2026-10-04T00:00:00.000Z',
      })
    },
  )
})

describe('organization policy SQL boundary', () => {
  const expressions = {
    organizationId: 'scope.organization_id',
    userId: 'actor.user_id',
    sessionId: 'actor.session_id',
    deviceIdentifier: 'actor.device_identifier',
  }

  it('uses the supplied identities and requires an active session family', () => {
    const sql = organizationPolicyAllowsSql(expressions)

    for (const expression of Object.values(expressions)) {
      expect(sql).toContain(expression)
    }
    expect(sql).toMatch(/\bsession_id\s*=\s*actor\.session_id\b/u)
    expect(sql).toMatch(/\brevoked_at\s+IS\s+NULL\b/iu)
  })

  it('ties verified MFA to the current TOTP credential generation', () => {
    const sql = organizationPolicyAllowsSql(expressions)

    expect(sql).toMatch(/\bmfa_verified_at\s+IS\s+NOT\s+NULL\b/iu)
    expect(sql).toMatch(
      /\bmfa_totp_credential_generation\s*=\s*[A-Za-z_][A-Za-z0-9_]*\.credential_generation\b/u,
    )
  })

  it.each([
    'organizationId',
    'userId',
    'sessionId',
    'deviceIdentifier',
  ] as const)('rejects an unqualified identifier in %s', (field) => {
    expect(() =>
      organizationPolicyAllowsSql({
        ...expressions,
        [field]: expressions[field].split('.')[1] ?? '',
      }),
    ).toThrow()
  })

  it.each([
    'organizationId',
    'userId',
    'sessionId',
    'deviceIdentifier',
  ] as const)('rejects caller text in the %s SQL expression', (field) => {
    for (const expression of [
      '',
      '?',
      '0',
      'unqualified_column',
      "'caller-value'",
      'actor.*',
      'actor.user id',
      'actor.user_id OR 1 = 1',
      'actor.user_id; SELECT 1',
      'actor.user_id--',
      'actor.user_id\nOR 1 = 1',
      '"actor"."user_id"',
    ]) {
      expect(() =>
        organizationPolicyAllowsSql({ ...expressions, [field]: expression }),
      ).toThrow()
    }
  })
})
