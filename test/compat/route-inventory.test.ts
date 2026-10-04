import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

// @ts-expect-error repository verifier intentionally ships as plain ESM.
import * as routeInventory from '../../scripts/honowarden-route-inventory.mjs'

const {
  defaultRouteInventoryPaths,
  extractHonoRoutes,
  loadOfficialSurfaceCatalog,
  loadRouteInventory,
  observeRepository,
  observeMountedHonoRoutes,
  reconcileRouteInventory,
  refreshOfficialCatalog,
  routeInventorySchemaVersion,
  sendRuntimeSupportForbiddenReason,
  verifyRouteInventory,
} = routeInventory

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const inventoryPath = join(repoRoot, 'compat/route-inventory.json')
const catalogPath = join(repoRoot, 'compat/official-surface-catalog.json')
const schemaPath = join(repoRoot, 'compat/route-inventory.schema.json')
const inventoryDocPath = join(repoRoot, 'docs/compatibility-inventory.md')
const scannerPath = join(repoRoot, 'scripts/honowarden-route-inventory.mjs')

describe('route inventory closeout', () => {
  const inventory = loadRouteInventory(inventoryPath)
  const catalog = loadOfficialSurfaceCatalog(catalogPath)

  it('keeps a schema-valid checked-in inventory', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    const validate = ajv.compile(schema)

    expect(inventory.schemaVersion).toBe(routeInventorySchemaVersion)
    expect(validate(inventory), JSON.stringify(validate.errors)).toBe(true)
  })

  it('fails when observed Hono routes are unclassified', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const emptyInventory = {
      schemaVersion: 1,
      entries: [
        {
          id: 'migrations.ledger',
          kind: 'migration_set',
          classification: 'implemented',
          requirementKind: 'operator',
          ownerIssue: 'HON-201',
          rationale: 'fixture',
          evidenceLevel: 'none',
          lastReviewedAt: '2026-09-02',
          migrations: observed.migrations,
        },
        {
          id: 'adrs.ledger',
          kind: 'adr_set',
          classification: 'implemented',
          requirementKind: 'operator',
          ownerIssue: 'HON-201',
          rationale: 'fixture',
          evidenceLevel: 'none',
          lastReviewedAt: '2026-09-02',
          adrs: observed.adrs,
        },
      ],
    }

    const report = reconcileRouteInventory({
      observed,
      inventory: emptyInventory,
      catalog: { controllers: [], routes: [], tokenGrants: [] },
    })

    expect(
      report.unclassified.some(
        (item: { kind: string }) => item.kind === 'route',
      ),
    ).toBe(true)
    expect(
      report.unclassified.some(
        (item: { key: string }) =>
          item.key === 'ALL /api/sends' || item.key === 'GET /api/sync',
      ),
    ).toBe(true)
  })

  it('fails when a new official controller is unclassified', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const driftedCatalog = {
      ...catalog,
      controllers: [
        ...catalog.controllers,
        {
          tree: 'oss',
          path: 'src/Api/NewSurface/Controllers/UnclassifiedController.cs',
        },
      ],
    }

    const report = reconcileRouteInventory({
      observed,
      inventory,
      catalog: driftedCatalog,
    })

    expect(report.unclassified).toEqual(
      expect.arrayContaining([
        {
          kind: 'official_controller',
          key: 'oss:src/Api/NewSurface/Controllers/UnclassifiedController.cs',
        },
      ]),
    )
  })

  it('fails stale Send runtime support claims', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const stale = {
      ...inventory,
      entries: inventory.entries.map((entry: { id: string }) =>
        entry.id === 'sends.runtime_guard'
          ? { ...entry, classification: 'implemented', supportClaim: true }
          : entry,
      ),
    }

    const report = reconcileRouteInventory({
      observed,
      inventory: stale,
      catalog,
    })

    expect(report.staleSupportClaims).toEqual(
      expect.arrayContaining([
        {
          id: 'sends.runtime_guard',
          reason: sendRuntimeSupportForbiddenReason,
        },
      ]),
    )
  })

  it('fails orphan roadmap non-goals', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const stripped = {
      ...inventory,
      entries: inventory.entries.map(
        (entry: { roadmapAnchors?: string[] }) => ({
          ...entry,
          roadmapAnchors: (entry.roadmapAnchors ?? []).filter(
            (anchor: string) => anchor !== 'Send',
          ),
        }),
      ),
    }

    const report = reconcileRouteInventory({
      observed,
      inventory: stripped,
      catalog,
    })

    expect(report.orphanRoadmapEntries).toContain('Send')
  })

  it('refreshes official metadata as a reviewed diff without mutating classifications', () => {
    const pinOnly = refreshOfficialCatalog({ catalog })
    expect(pinOnly.mode).toBe('reviewed_diff')
    expect(pinOnly.status).toBe('pin_only')
    expect(pinOnly.changed).toBe(false)

    expect(() =>
      refreshOfficialCatalog({ catalog, writeClassifications: true }),
    ).toThrow(/must not mutate inventory classifications/)

    const officialRoot = mkdtempSync(join(tmpdir(), 'honowarden-official-'))
    mkdirSync(join(officialRoot, 'src/Api/Tools/Controllers'), {
      recursive: true,
    })
    writeFileSync(
      join(officialRoot, 'src/Api/Tools/Controllers/SendsController.cs'),
      'class SendsController {}',
    )

    const diff = refreshOfficialCatalog({
      catalog,
      officialSourceRoot: officialRoot,
    })
    expect(diff.mode).toBe('reviewed_diff')
    expect(diff.changed).toBe(true)
    expect(diff.added).toEqual([])
    expect(diff.removed.length).toBeGreaterThan(0)
  })

  it('extracts Hono routes including lifecycle GET aliases and user-key rotation POST', () => {
    const source = readFileSync(join(repoRoot, 'src/app.ts'), 'utf8')
    const routes = extractHonoRoutes(source)

    expect(routes).toEqual(
      expect.arrayContaining([
        { method: 'ALL', path: '/api/sends' },
        { method: 'ALL', path: '/api/sends/*' },
        { method: 'GET', path: '/api/accounts' },
        {
          method: 'POST',
          path: '/api/accounts/key-management/rotate-user-account-keys',
        },
      ]),
    )
  })

  it('observes only the registration export mounted on the actual app', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'honowarden-routes-'))
    const appPath = join(fixtureRoot, 'app.ts')
    writeFileSync(
      join(fixtureRoot, 'membership.ts'),
      `export function registerMembershipRoutes(app) {
        app.post('/api/organizations/:id/users/invite', handler)
      }
      export function registerUnusedRoutes(app) {
        app.get('/unused', handler)
      }`,
    )
    const source = `
      import { registerMembershipRoutes as mountMembers } from './membership'
      import { registerMissingRoutes } from './unmounted-missing'
      mountMembers(app, dependencies)
      // registerMissingRoutes(app)
    `

    expect(observeMountedHonoRoutes(source, appPath)).toEqual([
      { method: 'POST', path: '/api/organizations/:id/users/invite' },
    ])
  })

  it('fails loudly when a mounted registration source is missing', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'honowarden-routes-'))
    expect(() =>
      observeMountedHonoRoutes(
        `import { registerMembershipRoutes } from './missing'
         registerMembershipRoutes(app)`,
        join(fixtureRoot, 'app.ts'),
      ),
    ).toThrow(/mounted route module.*missing/i)
  })

  it('observes direct mounted routes built from a local constant base without executing source', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'honowarden-routes-'))
    writeFileSync(
      join(fixtureRoot, 'groups.ts'),
      'export function registerGroupRoutes(app) {\n' +
        "  const base = '/api/organizations/:id/groups'\n" +
        '  app.get(base, handler)\n' +
        '  app.put(`${base}/:groupId`, handler)\n' +
        '  app.post(`${base}/delete`, unsupported)\n' +
        "}\nthrow new Error('scanner must not execute this module')",
    )

    expect(
      observeMountedHonoRoutes(
        "import { registerGroupRoutes } from './groups'\nregisterGroupRoutes(app)",
        join(fixtureRoot, 'app.ts'),
      ),
    ).toEqual([
      { method: 'GET', path: '/api/organizations/:id/groups' },
      { method: 'PUT', path: '/api/organizations/:id/groups/:groupId' },
      { method: 'POST', path: '/api/organizations/:id/groups/delete' },
    ])
  })

  it.each([
    "let base = '/api/organizations/:id/groups'; app.get(base, handler)",
    'const base = getBase(); app.get(`${base}/details`, handler)',
    "const base = '/api/organizations/:id/groups'; function nested(base) { app.get(base, handler) }",
  ])('rejects dynamic or shadowed mounted route bases: %s', (body) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'honowarden-routes-'))
    writeFileSync(
      join(fixtureRoot, 'groups.ts'),
      `export function registerGroupRoutes(app) { ${body} }`,
    )
    expect(() =>
      observeMountedHonoRoutes(
        "import { registerGroupRoutes } from './groups'\nregisterGroupRoutes(app)",
        join(fixtureRoot, 'app.ts'),
      ),
    ).toThrow(/mounted route module requires literal paths/)
  })

  it('does not let rejected catch-alls hide a newly mounted concrete route', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const added = {
      method: 'POST',
      path: '/api/organizations/:id/users/unreviewed-action',
    }
    const report = reconcileRouteInventory({
      observed: {
        ...observed,
        routes: [...observed.routes, added],
        registeredModuleRoutes: [added],
      },
      inventory,
      catalog,
    })

    expect(report.unclassified).toContainEqual({
      kind: 'route',
      key: 'POST /api/organizations/:id/users/unreviewed-action',
    })
  })

  it('fails instead of silently omitting dynamic mounted paths', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'honowarden-routes-'))
    writeFileSync(
      join(fixtureRoot, 'membership.ts'),
      `export function registerMembershipRoutes(app) {
        app.post(invitePath, handler)
      }`,
    )
    expect(() =>
      observeMountedHonoRoutes(
        `import { registerMembershipRoutes } from './membership'
         registerMembershipRoutes(app)`,
        join(fixtureRoot, 'app.ts'),
      ),
    ).toThrow(/mounted route module requires literal paths/)
  })

  it('requires the exact mounted wildcard registration while preserving concrete-route classification', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const added = { method: 'ALL', path: '/custom-admin/*' }
    const report = reconcileRouteInventory({
      observed: {
        ...observed,
        routes: [...observed.routes, added],
        registeredModuleRoutes: [...observed.registeredModuleRoutes, added],
      },
      inventory: {
        ...inventory,
        entries: [
          ...inventory.entries,
          {
            id: 'custom-admin.assets',
            kind: 'route',
            classification: 'implemented',
            requirementKind: 'operator',
            evidenceLevel: 'local_api',
            lastReviewedAt: '2026-10-04',
            covers: [added],
            rationale: 'Explicit fixture wildcard registration',
            supportClaim: false,
          },
        ],
      },
      catalog,
    })
    expect(report.unclassified).not.toContainEqual({
      kind: 'route',
      key: 'ALL /custom-admin/*',
    })
  })

  it('records mounted membership actions without promoting client support', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const membership = inventory.entries.find(
      (entry: { id: string }) =>
        entry.id === 'organizations.membership_administration',
    )

    expect(observed.registeredModuleRoutes).toHaveLength(35)
    expect(observed.registeredModuleRoutes).toContainEqual({
      method: 'POST',
      path: '/api/organizations/:id/users/:memberId/reinvite',
    })
    expect(observed.registeredModuleRoutes).toContainEqual({
      method: 'GET',
      path: '/api/organizations/:id/users/:memberId',
    })
    expect(observed.registeredModuleRoutes).toContainEqual({
      method: 'GET',
      path: '/api/users/:userId/public-key',
    })
    expect(membership).toMatchObject({
      classification: 'implemented',
      requirementKind: 'operator',
      evidenceLevel: 'local_api',
      supportClaim: false,
      runtimeFlags: ['HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED'],
    })
    expect(membership.covers).toHaveLength(11)
    expect(membership.covers).toEqual(
      expect.arrayContaining(
        observed.registeredModuleRoutes.filter(
          ({ path }: { path: string }) =>
            path.startsWith('/api/organizations/:id/users') ||
            path === '/api/users/:userId/public-key',
        ),
      ),
    )
    expect(observed.migrations).toEqual(
      expect.arrayContaining([
        '0023_device_session_binding.sql',
        '0024_organization_invitations.sql',
        '0025_organization_groups.sql',
        '0026_organization_policies.sql',
        '0027_session_mfa_assurance.sql',
        '0028_organization_audit_scope_index.sql',
        '0029_organization_membership_mutation_marker.sql',
        '0030_organization_policy_mutation_marker.sql',
        '0031_email_verification.sql',
      ]),
    )
  })

  it('classifies EVP as a local optional integration without upstream client support', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const evp = inventory.entries.find(
      (entry: { id: string }) =>
        entry.id === 'email_verification.evp_relying_party',
    )
    const routes = observed.registeredModuleRoutes.filter(
      ({ path }: { path: string }) =>
        path.startsWith('/identity/accounts/email-verification/'),
    )

    expect(routes).toEqual([
      {
        method: 'POST',
        path: '/identity/accounts/email-verification/challenge',
      },
      {
        method: 'POST',
        path: '/identity/accounts/email-verification/verify',
      },
    ])
    expect(evp).toMatchObject({
      classification: 'implemented',
      requirementKind: 'optional_integration',
      evidenceLevel: 'local_api',
      supportClaim: false,
      runtimeFlags: ['HONOWARDEN_EMAIL_VERIFICATION_ENABLED'],
      migrations: ['0031_email_verification.sql'],
      covers: routes,
    })
    expect(evp?.sourcePin).toBeUndefined()
    expect(evp?.officialIds).toBeUndefined()
    expect(
      inventory.entries.find(
        (entry: { id: string }) => entry.id === 'config.email-verification',
      ),
    ).toMatchObject({ honowardenValue: false, supportClaim: false })
  })

  it('classifies company routes separately from deferred aliases and native Events', () => {
    const observed = observeRepository(defaultRouteInventoryPaths(repoRoot))
    const entries = new Map<string, Record<string, unknown>>(
      inventory.entries.map(
        (entry: Record<string, unknown> & { id: string }) => [entry.id, entry],
      ),
    )
    for (const id of [
      'organizations.groups_administration',
      'organizations.policy_administration',
      'organizations.audit_history',
      'administration.assets',
      'totp.session_assurance',
    ]) {
      expect(entries.get(id)).toMatchObject({
        classification: 'implemented',
        evidenceLevel: 'local_api',
        supportClaim: false,
      })
    }
    expect(entries.get('organizations.groups_deferred_aliases')).toMatchObject({
      classification: 'rejected',
      supportClaim: false,
      covers: expect.arrayContaining([
        { method: 'DELETE', path: '/api/organizations/:id/groups' },
        {
          method: 'POST',
          path: '/api/organizations/:id/groups/:groupId/delete',
        },
      ]),
    })
    expect(entries.get('official.events')).toMatchObject({
      classification: 'planned',
      supportClaim: false,
    })
    expect(
      entries.get('organizations.audit_history')?.officialIds,
    ).toBeUndefined()
    expect(observed.registeredModuleRoutes).toContainEqual({
      method: 'ALL',
      path: '/admin/*',
    })
  })

  it('verifies the checked-in inventory against current main', () => {
    const result = verifyRouteInventory({ repoRoot })

    expect(result.shapeErrors).toEqual([])
    expect(result.unclassified).toEqual([])
    expect(result.staleSupportClaims).toEqual([])
    expect(result.orphanRoadmapEntries).toEqual([])
    expect(result.enabledWithoutEvidence).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('keeps Send config and runtime support claims off', () => {
    const sendFlag = inventory.entries.find(
      (entry: { id: string }) => entry.id === 'config.send-enabled',
    )
    const sendRoute = inventory.entries.find(
      (entry: { id: string }) => entry.id === 'sends.runtime_guard',
    )
    const sendGrant = inventory.entries.find(
      (entry: { id: string }) => entry.id === 'grant.send_access',
    )

    expect(sendFlag).toMatchObject({
      honowardenValue: false,
      supportClaim: false,
    })
    expect(sendRoute.supportClaim).toBe(false)
    expect(sendRoute.classification).not.toBe('implemented')
    expect(sendGrant.supportClaim).toBe(false)
    expect(sendGrant.classification).not.toBe('implemented')
  })

  it('documents the inventory closeout and refresh rule', () => {
    const inventoryDoc = readFileSync(inventoryDocPath, 'utf8')
    const compatibilityDoc = readFileSync(
      join(repoRoot, 'docs/compatibility.md'),
      'utf8',
    )

    expect(inventoryDoc).toContain('## Classifications')
    expect(inventoryDoc).toContain('reviewed diff')
    expect(inventoryDoc).toContain('does not silently change')
    expect(inventoryDoc).toContain('/api/sends')
    expect(compatibilityDoc).toContain('docs/compatibility-inventory.md')
  })

  it('exits non-zero when catalog refresh is asked to mutate classifications', async () => {
    await expect(
      execFileAsync(
        'node',
        [scannerPath, 'refresh-catalog', '--write-classifications'],
        {
          encoding: 'utf8',
          cwd: repoRoot,
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        'must not mutate inventory classifications',
      ),
    })
  })
})
