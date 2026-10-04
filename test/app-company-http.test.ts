import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app'
import type { Bindings } from '../src/bindings'
import type { AuthUserRecord } from '../src/repositories/auth-repository'
import * as authRepository from '../src/repositories/auth-repository'
import * as totpRepository from '../src/repositories/totp-repository'
import * as mfaRepository from '../src/repositories/mfa-session-repository'
import * as organizationRepository from '../src/repositories/organization-repository'
import * as cipherRepository from '../src/repositories/cipher-repository'
import * as policyRepository from '../src/repositories/organization-policy-repository'
import * as folderRepository from '../src/repositories/folder-repository'
import * as attachmentRepository from '../src/repositories/attachment-repository'
import * as domainRepository from '../src/repositories/domain-settings-repository'
import * as userRepository from '../src/repositories/user-repository'
import { signAccessToken } from '../src/domain/tokens'
import { encryptTotpSecret } from '../src/domain/totp-secret'
import { hotp } from '../src/domain/totp'

const now = '2026-10-04T00:00:00.000Z'
const tokenSecret = 'synthetic-http-token-secret'
const wrappingSecret = 'synthetic-http-wrapping-secret'
const factor = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const actor = {
  userId: 'owner',
  deviceIdentifier: 'desktop',
  sessionId: 'family',
}
const user: AuthUserRecord = {
  id: actor.userId,
  email: 'owner@example.test',
  emailNormalized: 'owner@example.test',
  emailVerifiedAt: now,
  displayName: null,
  kdfAlgorithm: 'pbkdf2-sha256',
  kdfIterations: 600000,
  kdfMemory: null,
  kdfParallelism: null,
  masterPasswordHash: 'synthetic-hash',
  userKey: '2.synthetic-wrapper',
  publicKey: null,
  privateKey: null,
  securityStamp: 'stamp',
  revisionDate: now,
  createdAt: now,
  disabledAt: null,
  loginFailedCount: 0,
  loginFailedAt: null,
  loginLockedUntil: null,
  totpEnabled: true,
  totpEncryptedSecret: null,
  totpLastAcceptedStep: null,
  totpCredentialGeneration: 'generation',
}
const database = {
  prepare: vi.fn(() => {
    throw new Error('Unexpected D1 call')
  }),
} as unknown as D1Database

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.spyOn(authRepository, 'findAuthUserBySession').mockResolvedValue(user)
  vi.spyOn(authRepository, 'revokeCurrentDeviceSession').mockResolvedValue({
    status: 'revoked',
    deviceId: 'owner:desktop',
    revokedAt: now,
  })
  vi.spyOn(mfaRepository, 'findSessionTotpAssurance').mockResolvedValue(false)
  vi.spyOn(mfaRepository, 'consumeTotpSessionStepUp').mockResolvedValue(true)
  vi.spyOn(totpRepository, 'findTotpSetupByUserId').mockImplementation(
    async () => ({
      userId: actor.userId,
      encryptedSecret: await encryptTotpSecret(wrappingSecret, factor),
      enabled: true,
      verifiedAt: now,
      lastAcceptedStep: null,
      credentialGeneration: 'generation',
      pendingEncryptedSecret: null,
      pendingCreatedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  )
  vi.spyOn(
    organizationRepository,
    'listConfirmedOrganizationMemberships',
  ).mockResolvedValue([])
  vi.spyOn(
    organizationRepository,
    'listAccessibleOrganizationCollections',
  ).mockResolvedValue([])
  vi.spyOn(cipherRepository, 'listAccessibleCiphersByUser').mockResolvedValue(
    [],
  )
  vi.spyOn(folderRepository, 'listFoldersByUser').mockResolvedValue([])
  vi.spyOn(
    attachmentRepository,
    'listCipherAttachmentsByUser',
  ).mockResolvedValue([])
  vi.spyOn(domainRepository, 'getDomainSettingsForUser').mockResolvedValue({
    equivalentDomains: [],
    excludedGlobalEquivalentDomains: [],
  })
  vi.spyOn(userRepository, 'getAccountRevisionDate').mockResolvedValue(now)
  vi.spyOn(
    policyRepository,
    'listOrganizationPoliciesForUser',
  ).mockResolvedValue([
    {
      id: 'policy',
      organizationId: 'org',
      type: 0,
      enabled: true,
      revisionDate: now,
    },
  ])
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('central company HTTP integration', () => {
  it('passes the trusted family to sync organization access while projecting persisted policy with management off', async () => {
    const response = await request('/api/sync')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      policies: unknown[]
      policiesNew: unknown[]
    }
    expect(body.policies).toEqual([
      {
        Object: 'policy',
        Id: 'policy',
        OrganizationId: 'org',
        Type: 0,
        Enabled: true,
        Data: null,
        RevisionDate: now,
      },
    ])
    expect(body.policiesNew).toEqual(body.policies)
    for (const operation of [
      organizationRepository.listConfirmedOrganizationMemberships,
      organizationRepository.listAccessibleOrganizationCollections,
      cipherRepository.listAccessibleCiphersByUser,
      policyRepository.listOrganizationPoliciesForUser,
    ]) {
      expect(operation).toHaveBeenCalledWith(database, actor.userId, actor)
    }
  })

  it.each([false, true])(
    'advertises mounted group and policy behavior only when management is enabled: %s',
    async (enabled) => {
      vi.mocked(
        organizationRepository.listConfirmedOrganizationMemberships,
      ).mockResolvedValue([
        {
          id: 'org',
          name: 'Team',
          billingEmail: null,
          planType: 0,
          publicKey: 'opaque-public',
          privateKey: '2.opaque-private',
          enabled: true,
          useTotp: true,
          revisionDate: now,
          organizationUserId: 'membership',
          orgKey: '2.opaque-org-key',
          status: 2,
          type: 0,
          permissions: null,
        },
      ])
      const response = await request('/api/sync', 'GET', undefined, {
        HONOWARDEN_ORGANIZATION_GROUPS_ENABLED: String(enabled),
        HONOWARDEN_ORGANIZATION_POLICIES_ENABLED: String(enabled),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        profile: {
          organizations: [
            { UseGroups: enabled, UsePolicies: enabled, UseEvents: false },
          ],
        },
      })
      expect(
        policyRepository.listOrganizationPoliciesForUser,
      ).toHaveBeenCalledWith(database, actor.userId, actor)
    },
  )

  it.each(['/api/policies', '/api/policies/new'])(
    'projects persisted policy for remediation without enabling policy administration: %s',
    async (path) => {
      const response = await request(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toMatchObject({
        object: 'list',
        data: [{ OrganizationId: 'org', Type: 0, Enabled: true }],
      })
    },
  )

  it('passes the current family to revision lookup', async () => {
    const response = await request('/api/accounts/revision-date')
    expect(response.status).toBe(200)
    expect(userRepository.getAccountRevisionDate).toHaveBeenCalledWith(
      database,
      actor.userId,
      actor,
    )
  })

  it('refuses an offboarded family before shared access queries', async () => {
    vi.mocked(authRepository.findAuthUserBySession).mockResolvedValue(null)
    const response = await request('/api/sync')
    expect(response.status).toBe(401)
    expect(
      organizationRepository.listConfirmedOrganizationMemberships,
    ).not.toHaveBeenCalled()
    expect(cipherRepository.listAccessibleCiphersByUser).not.toHaveBeenCalled()
  })
  it('reads persisted assurance for the exact verified refresh-token family', async () => {
    const response = await request('/identity/accounts/totp/assurance')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      object: 'totpSession',
      verified: false,
    })
    expect(mfaRepository.findSessionTotpAssurance).toHaveBeenCalledWith(
      database,
      actor,
    )
  })

  it('steps up a refresh-authenticated family after actual code verification', async () => {
    const code = await hotp(factor, Date.parse(now) / 30_000)
    const response = await request(
      '/identity/accounts/totp/step-up',
      'POST',
      JSON.stringify({ code }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      object: 'totpSession',
      verified: true,
    })
    expect(mfaRepository.consumeTotpSessionStepUp).toHaveBeenCalledWith(
      database,
      {
        ...actor,
        credentialGeneration: 'generation',
        acceptedStep: Date.parse(now) / 30_000,
        now,
      },
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    '{"code":"wrong"}',
    '{}',
    'null',
    '{"code":"123456","extra":true}',
    JSON.stringify({ code: '1'.repeat(4096) }),
  ])(
    'rejects malformed bounded step-up body %# without consuming replay state',
    async (body) => {
      const response = await request(
        '/identity/accounts/totp/step-up',
        'POST',
        body,
      )
      expect(response.status).toBe(400)
      expect(mfaRepository.consumeTotpSessionStepUp).not.toHaveBeenCalled()
    },
  )

  it('keeps disabled company features free of quota writes when global quota is enabled', async () => {
    const response = await app.request(
      '/api/organizations/org/groups',
      {},
      { DB: database, HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true' },
    )
    expect(response.status).toBe(501)
    expect(authRepository.findAuthUserBySession).not.toHaveBeenCalled()
    expect(database.prepare).not.toHaveBeenCalled()
  })

  it('rejects a stale security stamp before reading or changing assurance', async () => {
    vi.mocked(authRepository.findAuthUserBySession).mockResolvedValue({
      ...user,
      securityStamp: 'new-stamp',
    })
    const response = await request('/identity/accounts/totp/assurance')
    expect(response.status).toBe(401)
    expect(mfaRepository.findSessionTotpAssurance).not.toHaveBeenCalled()
  })

  it('logs out the exact verified refresh-authenticated family', async () => {
    const response = await request('/identity/accounts/logout', 'POST')
    expect(response.status).toBe(200)
    expect(authRepository.revokeCurrentDeviceSession).toHaveBeenCalledWith(
      database,
      { ...actor, revokedAt: now },
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('fails observably when assurance D1 lookup fails without logging infrastructure exception text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(mfaRepository.findSessionTotpAssurance).mockRejectedValue(
      new Error('sensitive exception detail'),
    )
    const response = await request('/identity/accounts/totp/assurance')
    expect(response.status).toBe(503)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('mfa_session_failed'),
    )
    expect(log.mock.calls.flat().join(' ')).not.toContain(
      'sensitive exception detail',
    )
  })

  it.each([
    '/api/organizations/org/groups',
    '/api/organizations/org/policies',
    '/api/organizations/org/audit-events',
  ])(
    'mounts default-off company route %s without touching authentication or D1',
    async (path) => {
      const response = await app.request(path, {}, { DB: database })
      expect(response.status).toBe(501)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(authRepository.findAuthUserBySession).not.toHaveBeenCalled()
    },
  )
})

async function request(
  path: string,
  method = 'GET',
  body?: string,
  overrides: Partial<Bindings> = {},
) {
  const accessToken = await signAccessToken(tokenSecret, {
    sub: actor.userId,
    email: user.email,
    device: actor.deviceIdentifier,
    sessionId: actor.sessionId,
    securityStamp: 'stamp',
    iat: Date.parse(now) / 1000,
    exp: Date.parse(now) / 1000 + 3600,
    authMethod: 'refresh',
  })
  return app.request(
    path,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body }),
    },
    {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: tokenSecret,
      HONOWARDEN_TOTP_SECRET: wrappingSecret,
      ...overrides,
    },
  )
}
