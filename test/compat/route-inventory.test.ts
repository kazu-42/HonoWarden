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
