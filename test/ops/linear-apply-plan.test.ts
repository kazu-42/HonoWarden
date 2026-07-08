import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const applyPlanScript = join(
  repoRoot,
  'scripts/honowarden-linear-apply-plan.mjs',
)
const seedFile = join(repoRoot, 'ops/linear/honowarden.seed.json')

type ApplyPlanReport = {
  schemaVersion: 1
  status: 'ready' | 'blocked'
  blockingReason: string | null
  seed: {
    counts: {
      labels: number
      projects: number
      milestones: number
      issues: number
      views: number
      documents: number
      pulse: number
    }
  }
  preflight: null | {
    status: string | null
    workspaceSlug: string | null
    seedFingerprint: null | {
      algorithm: 'sha256'
      value: string
    }
    team: {
      id: string | null
      key: string | null
      name: string | null
    }
  }
  summary: {
    total: number
    byAction: Record<string, number>
    byKind: Record<string, number>
  }
  operations: Array<{
    id: string
    kind: string
    name?: string
    title?: string
    action: string
    dependencies: string[]
    fields?: Record<string, unknown>
  }>
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
}

describe('Linear apply plan', () => {
  it('emits a blocked local plan without a preflight report or network access', async () => {
    const { env, fetchCalledPath } = await noNetworkEnv()

    const result = await execFileAsync('node', [applyPlanScript], { env })
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('linear_preflight_report_missing')
    expect(report.preflight).toBeNull()
    expect(report.seed.counts).toMatchObject({
      labels: 15,
      projects: 3,
      milestones: 7,
      issues: 18,
      views: 7,
      documents: 1,
      pulse: 1,
    })
    expect(report.summary.total).toBe(55)
    expect(report.summary.byAction).toEqual({ pending_preflight: 55 })
    expect(statusById(report, 'linear_preflight_report')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-apply-plan-token')
    await expect(fileExists(fetchCalledPath)).resolves.toBe(false)
  })

  it('exits non-zero in strict mode when the plan is blocked', async () => {
    await expect(
      execFileAsync('node', [applyPlanScript, '--', '--strict'], {
        env: cleanEnv(),
      }),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('linear_preflight_report_missing'),
    })
  })

  it('propagates a blocked preflight report and strict mode failure', async () => {
    const preflightPath = await writeJsonFixture('blocked-preflight', {
      status: 'not_ready',
      blockingReason: 'linear_api_key_missing',
      expected: {
        workspaceSlug: 'honowarden',
        team: { key: 'HW', name: 'HonoWarden' },
      },
    })

    await expect(
      execFileAsync(
        'node',
        [applyPlanScript, '--preflight-report', preflightPath, '--strict'],
        { env: cleanEnv() },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        'linear_preflight_linear_api_key_missing',
      ),
    })
  })

  it('classifies seed operations with a ready preflight report', async () => {
    const preflightPath = await writeJsonFixture(
      'ready-preflight',
      await readyPreflightReport(),
    )

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--preflight-report', preflightPath, '--strict'],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.preflight?.workspaceSlug).toBe('honowarden')
    expect(report.preflight?.team.id).toBe('team-hw')
    expect(report.summary.byAction).toEqual({
      confirm_existing: 21,
      create: 5,
      create_or_update: 26,
      manual_confirm: 3,
    })

    expect(operationById(report, 'linear:label:area:api').action).toBe('create')
    expect(operationById(report, 'linear:project:website-domain').action).toBe(
      'create',
    )
    expect(operationById(report, 'linear:view:Website and Domain').action).toBe(
      'manual_confirm',
    )
    expect(
      operationById(report, 'linear:view:Alpha Command Center'),
    ).toMatchObject({
      dependencies: expect.arrayContaining([
        'linear:project:alpha-api',
        'linear:project:ops-readiness',
        'linear:project:website-domain',
      ]),
      fields: {
        filters: {
          project: [
            'HonoWarden v0.1.0-alpha',
            'Operations Readiness',
            'Website and Domain',
          ],
          statusType: ['backlog', 'unstarted', 'started'],
        },
      },
    })
    expect(operationById(report, 'linear:issue:backup-restore')).toMatchObject({
      action: 'create_or_update',
      dependencies: expect.arrayContaining([
        'linear:project:alpha-api',
        'linear:milestone:alpha-api:Week 20 - Backup and restore',
        'linear:label:area:ops',
      ]),
      fields: {
        labels: expect.arrayContaining(['area:ops', 'release:alpha']),
        description: expect.stringContaining('Acceptance criteria:'),
      },
    })
    expect(
      operationById(report, 'linear:initiative:HonoWarden Alpha Launch'),
    ).toMatchObject({
      seedKey: 'alpha-launch',
      fields: {
        summary: expect.stringContaining('v0.1.0-alpha'),
        targetDate: '2027-01-03',
        priority: 2,
      },
    })
    expect(
      operationById(report, 'linear:document:HonoWarden Tracking Overview'),
    ).toMatchObject({
      fields: {
        projectKey: 'alpha-api',
        content: expect.stringContaining('Operating rules:'),
      },
    })
    expect(
      operationById(report, 'linear:pulse:first-update:alpha-api'),
    ).toMatchObject({
      fields: {
        projectKey: 'alpha-api',
        health: 'atRisk',
        body: expect.stringContaining('Remaining risk is operational setup'),
      },
    })
    expect(statusById(report, 'workspace')).toBe('pass')
    expect(statusById(report, 'team')).toBe('pass')
  })

  it('fails closed when the ready preflight report points at another workspace', async () => {
    const preflightPath = await writeJsonFixture(
      'wrong-workspace-preflight',
      await readyPreflightReport({
        workspace: { id: 'org-interx', name: 'InterX', urlKey: 'interx' },
      }),
    )

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--preflight-report', preflightPath],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('linear_preflight_workspace_mismatch')
    expect(statusById(report, 'workspace')).toBe('fail')
    expect(report.summary.byAction).toEqual({ pending_preflight: 55 })
  })

  it('fails closed when a ready preflight report lacks actual workspace readback', async () => {
    const preflightPath = await writeJsonFixture(
      'missing-workspace-preflight',
      await readyPreflightReport({
        workspace: null,
      }),
    )

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--preflight-report', preflightPath],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('linear_preflight_workspace_mismatch')
    expect(statusById(report, 'workspace')).toBe('fail')
    expect(report.summary.byAction).toEqual({ pending_preflight: 55 })
  })

  it('fails closed when the ready preflight report lacks a team id', async () => {
    const preflightPath = await writeJsonFixture(
      'missing-team-preflight',
      await readyPreflightReport({
        team: { id: null, key: 'HW', name: 'HonoWarden' },
      }),
    )

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--preflight-report', preflightPath],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('linear_preflight_team_missing')
    expect(statusById(report, 'team')).toBe('fail')
    expect(report.summary.byAction).toEqual({ pending_preflight: 55 })
  })

  it('fails closed when a ready preflight report was generated for a different seed', async () => {
    const preflight = await readyPreflightReport()
    preflight.seedFingerprint = {
      algorithm: 'sha256',
      value: 'different-seed-fingerprint',
    }
    const preflightPath = await writeJsonFixture(
      'stale-seed-preflight',
      preflight,
    )

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--preflight-report', preflightPath],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('linear_preflight_seed_mismatch')
    expect(statusById(report, 'seed_fingerprint')).toBe('fail')
    expect(report.summary.byAction).toEqual({ pending_preflight: 55 })
  })

  it('fails closed when ready preflight inventory does not list current seed names', async () => {
    const preflight = await readyPreflightReport()
    preflight.inventory.labels = {
      complete: true,
      expectedNames: [],
      missingNames: [],
    }
    const preflightPath = await writeJsonFixture(
      'stale-inventory-preflight',
      preflight,
    )

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--preflight-report', preflightPath],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('linear_preflight_inventory_mismatch')
    expect(statusById(report, 'inventory_seed')).toBe('fail')
    expect(report.summary.byAction).toEqual({ pending_preflight: 55 })
  })

  it('fails closed when ready preflight inventory is paginated', async () => {
    const preflight = await readyPreflightReport()
    preflight.inventory.projects.complete = false
    const preflightPath = await writeJsonFixture(
      'paginated-inventory-preflight',
      preflight,
    )

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--preflight-report', preflightPath],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('linear_preflight_inventory_incomplete')
    expect(statusById(report, 'inventory_complete')).toBe('fail')
    expect(report.summary.byAction).toEqual({ pending_preflight: 55 })
  })

  it('supports custom seed paths', async () => {
    const seed = JSON.parse(await readFile(seedFile, 'utf8')) as {
      labels: Array<{ name: string }>
      projects: unknown[]
      milestones: unknown[]
      issues: unknown[]
      views: unknown[]
      documents: unknown[]
    }
    seed.labels = seed.labels.slice(0, 1)
    seed.projects = []
    seed.milestones = []
    seed.issues = []
    seed.views = []
    seed.documents = []
    const seedPath = await writeJsonFixture('custom-seed', seed)

    const result = await execFileAsync(
      'node',
      [applyPlanScript, '--seed', seedPath],
      { env: cleanEnv() },
    )
    const report = JSON.parse(result.stdout) as ApplyPlanReport

    expect(report.seed.counts.labels).toBe(1)
    expect(report.summary.total).toBe(5)
    expect(report.summary.byAction).toEqual({ pending_preflight: 5 })
  })
})

async function readyPreflightReport(overrides: Record<string, unknown> = {}) {
  const seed = JSON.parse(await readFile(seedFile, 'utf8')) as {
    labels: Array<{ name: string }>
    projects: Array<{ name: string }>
    initiative: { name: string }
    documents: Array<{ title: string }>
    views: Array<{ name: string; scope: string }>
  }

  return {
    status: 'ready',
    blockingReason: null,
    seedFingerprint: fingerprintJson(seed),
    expected: {
      workspaceSlug: 'honowarden',
      team: { key: 'HW', name: 'HonoWarden' },
    },
    workspace: { id: 'org-hw', name: 'HonoWarden', urlKey: 'honowarden' },
    team: { id: 'team-hw', key: 'HW', name: 'HonoWarden' },
    inventory: {
      labels: {
        complete: true,
        expectedNames: seed.labels.map((label) => label.name),
        missingNames: ['area:api'],
      },
      initiative: {
        complete: true,
        expectedNames: [seed.initiative.name],
        missingNames: ['HonoWarden Alpha Launch'],
      },
      projects: {
        complete: true,
        expectedNames: seed.projects.map((project) => project.name),
        missingNames: ['Website and Domain'],
      },
      documents: {
        complete: true,
        expectedNames: seed.documents.map((document) => document.title),
        missingNames: ['HonoWarden Tracking Overview'],
      },
      views: {
        complete: true,
        expectedNames: seed.views
          .filter(
            (view) => view.scope !== 'project' && view.scope !== 'initiative',
          )
          .map((view) => view.name),
        missingNames: ['Agent Queue'],
        manualProjectScoped: 1,
        manualProjectScopedNames: ['Website and Domain'],
      },
    },
    ...overrides,
  }
}

function fingerprintJson(value: unknown) {
  return {
    algorithm: 'sha256' as const,
    value: createHash('sha256').update(stableJson(value)).digest('hex'),
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const record = value as Record<string, unknown>
        return `${JSON.stringify(key)}:${stableJson(record[key])}`
      })
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function operationById(report: ApplyPlanReport, id: string) {
  const operation = report.operations.find((item) => item.id === id)
  if (!operation) {
    throw new Error(`missing operation ${id}`)
  }

  return operation
}

function statusById(report: ApplyPlanReport, id: string): 'pass' | 'fail' {
  const status = report.checks.find((check) => check.id === id)?.status
  if (!status) {
    throw new Error(`missing check ${id}`)
  }

  return status
}

async function noNetworkEnv() {
  const dir = await fixtureDir('linear-apply-plan-network')
  const fetchCalledPath = join(dir, 'fetch-called')
  const mockPath = join(dir, 'mock-fetch.mjs')
  await writeFile(
    mockPath,
    [
      "import { writeFileSync } from 'node:fs'",
      'globalThis.fetch = async () => {',
      '  writeFileSync(process.env.FETCH_CALLED_PATH, "called")',
      '  throw new Error("fetch should not be called")',
      '}',
      '',
    ].join('\n'),
  )

  return {
    fetchCalledPath,
    env: cleanEnv({
      FETCH_CALLED_PATH: fetchCalledPath,
      LINEAR_API_KEY: 'test-linear-apply-plan-token',
      NODE_OPTIONS: `--import=${mockPath}`,
    }),
  }
}

async function writeJsonFixture(
  label: string,
  value: unknown,
): Promise<string> {
  const dir = await fixtureDir(label)
  const path = join(dir, 'fixture.json')
  await writeFile(path, JSON.stringify(value, null, 2))

  return path
}

async function fixtureDir(label: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `${label}-`))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    ...extra,
  }
}
