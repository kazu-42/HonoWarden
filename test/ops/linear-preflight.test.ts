import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const preflightScript = join(
  repoRoot,
  'scripts/honowarden-linear-preflight.mjs',
)
const seedFile = join(repoRoot, 'ops/linear/honowarden.seed.json')

type LinearPreflightReport = {
  schemaVersion: 1
  status: 'ready' | 'not_ready'
  blockingReason: string | null
  expected: {
    workspaceSlug: string | null
  }
  workspace: null | {
    urlKey: string
  }
  team: null | {
    key: string
    missingStateTypes: string[]
  }
  inventory: null | {
    projects: InventorySummary
    labels: InventorySummary
    views: InventorySummary & {
      manualProjectScoped: number
      manualProjectScopedNames: string[]
    }
  }
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
}

type InventorySummary = {
  expected: number
  matched: number
  missing: number
}

describe('Linear API preflight', () => {
  it('reports missing Linear API key without calling the network', async () => {
    const result = await execFileAsync('node', [preflightScript], {
      env: cleanEnv(),
    })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_api_key_missing')
    expect(statusById(report, 'linear_api_key')).toBe('fail')
    expect(report.workspace).toBeNull()
    expect(report.inventory).toBeNull()
  })

  it('handles GraphQL auth failures without printing the API key', async () => {
    const env = await mockedLinearEnv({
      status: 401,
      body: {
        errors: [{ message: 'Authentication required' }],
      },
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_api_auth_failed')
    expect(statusById(report, 'linear_api_key')).toBe('pass')
    expect(statusById(report, 'linear_graphql_read')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
    expect(result.stderr).not.toContain('test-linear-preflight-token')
  })

  it('rejects API keys with control characters before fetch can echo them', async () => {
    const malformedToken = 'test-linear\npreflight-token'
    const env = await mockedFailIfCalledEnv({
      LINEAR_API_KEY: malformedToken,
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_api_key_invalid')
    expect(statusById(report, 'linear_api_key')).toBe('fail')
    expect(result.stdout).not.toContain(malformedToken)
    expect(result.stderr).not.toContain(malformedToken)
  })

  it('rejects custom GraphQL endpoints before fetch can attach the API key', async () => {
    const env = await mockedFailIfCalledEnv({
      HONOWARDEN_LINEAR_GRAPHQL_ENDPOINT: 'https://example.test/graphql',
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_endpoint_not_allowed')
    expect(statusById(report, 'linear_api_key')).toBe('pass')
    expect(statusById(report, 'linear_endpoint')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
    expect(result.stderr).not.toContain('test-linear-preflight-token')
  })

  it('rejects alternate Linear GraphQL ports before fetch can attach the API key', async () => {
    const env = await mockedFailIfCalledEnv({
      HONOWARDEN_LINEAR_GRAPHQL_ENDPOINT: 'https://api.linear.app:444/graphql',
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_endpoint_not_allowed')
    expect(statusById(report, 'linear_endpoint')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('fails closed when the workspace slug environment disagrees with the seed', async () => {
    const env = await mockedFailIfCalledEnv({
      HONOWARDEN_LINEAR_WORKSPACE_SLUG: 'interx',
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_workspace_env_mismatch')
    expect(report.expected.workspaceSlug).toBe('honowarden')
    expect(statusById(report, 'workspace_env')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('fails closed when a custom seed omits the target team', async () => {
    const customSeedPath = await writeSeedFixture('linear-preflight-seed', {
      workspaceSlug: 'honowarden',
      issues: [{ stateType: 'started' }],
    })
    const env = await mockedFailIfCalledEnv()

    const result = await execFileAsync(
      'node',
      [preflightScript, '--seed', customSeedPath],
      { env },
    )
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_seed_team_missing')
    expect(statusById(report, 'seed_team')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('fails closed when a custom seed omits the target workspace slug', async () => {
    const customSeedPath = await writeSeedFixture(
      'linear-preflight-workspace-seed',
      {
        team: { key: 'HW', name: 'HonoWarden' },
        issues: [{ stateType: 'started' }],
        views: [],
      },
    )
    const env = await mockedFailIfCalledEnv()

    const result = await execFileAsync(
      'node',
      [preflightScript, '--seed', customSeedPath],
      { env },
    )
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_seed_workspace_missing')
    expect(report.expected.workspaceSlug).toBeNull()
    expect(statusById(report, 'seed_workspace')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('fails closed when the API key belongs to another workspace', async () => {
    const env = await mockedLinearEnv({
      status: 200,
      body: { data: linearData({ workspaceSlug: 'interx' }) },
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_workspace_mismatch')
    expect(report.workspace?.urlKey).toBe('interx')
    expect(statusById(report, 'workspace_slug')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('fails closed when the expected team key is missing', async () => {
    const env = await mockedLinearEnv({
      status: 200,
      body: {
        data: linearData({ workspaceSlug: 'honowarden', teamKey: 'OTHER' }),
      },
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_team_missing')
    expect(statusById(report, 'workspace_slug')).toBe('pass')
    expect(statusById(report, 'team')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('fails closed when view filters reference missing workflow state types', async () => {
    const env = await mockedLinearEnv({
      status: 200,
      body: {
        data: linearData({
          workspaceSlug: 'honowarden',
          stateTypes: ['started', 'completed'],
        }),
      },
    })

    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as LinearPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('linear_workflow_state_missing')
    expect(report.team?.missingStateTypes).toEqual(['backlog', 'unstarted'])
    expect(statusById(report, 'workflow_state_types')).toBe('fail')
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('reports ready when workspace, team, and workflow state types match', async () => {
    const capturePath = join(
      await fixtureDir('linear-preflight-capture'),
      'auth',
    )
    const env = await mockedLinearEnv({
      status: 200,
      body: { data: linearData({ workspaceSlug: 'honowarden' }) },
      captureAuthorizationPath: capturePath,
    })

    const result = await execFileAsync(
      'node',
      [preflightScript, '--seed', seedFile],
      {
        env,
      },
    )
    const report = JSON.parse(result.stdout) as LinearPreflightReport
    const authorizationHeader = await readFile(capturePath, 'utf8')

    expect(authorizationHeader).toBe('test-linear-preflight-token')
    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.team?.key).toBe('HW')
    expect(report.team?.missingStateTypes).toEqual([])
    expect(statusById(report, 'workflow_state_types')).toBe('pass')
    expect(report.inventory?.projects).toMatchObject({
      expected: 3,
      matched: 3,
      missing: 0,
    })
    expect(report.inventory?.labels).toMatchObject({
      expected: 15,
      matched: 15,
      missing: 0,
    })
    expect(report.inventory?.views).toMatchObject({
      expected: 6,
      matched: 6,
      missing: 0,
      manualProjectScoped: 1,
      manualProjectScopedNames: ['Website and Domain'],
    })
    expect(result.stdout).not.toContain('test-linear-preflight-token')
  })

  it('exits non-zero in strict mode when not ready', async () => {
    await expect(
      execFileAsync('node', [preflightScript, '--', '--strict'], {
        env: cleanEnv(),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"status": "not_ready"'),
    })
  })
})

function statusById(report: LinearPreflightReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}

function cleanEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  }
}

function linearData({
  workspaceSlug,
  teamKey = 'HW',
  stateTypes = ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
}: {
  workspaceSlug: string
  teamKey?: string
  stateTypes?: Array<
    'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
  >
}) {
  const stateNames = {
    backlog: 'Backlog',
    unstarted: 'Todo',
    started: 'In Progress',
    completed: 'Done',
    canceled: 'Canceled',
  }

  return {
    organization: {
      id: 'org-id',
      name: workspaceSlug === 'honowarden' ? 'HonoWarden' : 'Interx',
      urlKey: workspaceSlug,
    },
    viewer: {
      id: 'viewer-id',
      name: 'Operator',
      organization: {
        id: 'org-id',
        name: workspaceSlug,
        urlKey: workspaceSlug,
      },
    },
    teams: {
      nodes: [
        {
          id: 'team-id',
          name: 'HonoWarden',
          key: teamKey,
          states: {
            nodes: stateTypes.map((stateType) => ({
              id: `state-${stateType}`,
              name: stateNames[stateType],
              type: stateType,
            })),
          },
        },
      ],
    },
    projects: {
      nodes: [
        { id: 'project-alpha', name: 'HonoWarden v0.1.0-alpha' },
        { id: 'project-ops', name: 'Operations Readiness' },
        { id: 'project-website', name: 'Website and Domain' },
      ],
    },
    initiatives: {
      nodes: [{ id: 'initiative-alpha', name: 'HonoWarden Alpha Launch' }],
    },
    issueLabels: {
      nodes: [
        'area:api',
        'area:auth',
        'area:docs',
        'area:infra',
        'area:ops',
        'area:website',
        'type:feature',
        'type:ops',
        'type:docs',
        'type:spike',
        'risk:security',
        'evidence:required',
        'agent:codex',
        'agent:spark',
        'release:alpha',
      ].map((name) => ({ id: `label-${name}`, name, team: { key: 'HW' } })),
    },
    documents: {
      nodes: [
        {
          id: 'document-tracking',
          title: 'HonoWarden Tracking Overview',
          team: { key: 'HW' },
          project: { name: 'HonoWarden v0.1.0-alpha' },
        },
      ],
    },
    customViews: {
      nodes: [
        'Alpha Command Center',
        'Week 26 Release Gate',
        'Security and Ops Risk',
        'Agent Queue',
        'Website and Domain',
        'Evidence Missing',
        'Published Alpha Evidence',
      ].map((name) => ({ id: `view-${name}`, name, team: { key: 'HW' } })),
    },
  }
}

async function mockedLinearEnv({
  status,
  body,
  captureAuthorizationPath,
}: {
  status: number
  body: unknown
  captureAuthorizationPath?: string
}) {
  const workDir = await fixtureDir('linear-preflight-fetch')
  const mockPath = join(workDir, 'mock-fetch.mjs')
  const captureLine = captureAuthorizationPath
    ? `writeFileSync(${JSON.stringify(
        captureAuthorizationPath,
      )}, String(options?.headers?.authorization ?? ''))`
    : ''

  await writeFile(
    mockPath,
    `import { writeFileSync } from 'node:fs'

globalThis.fetch = async (_url, options) => {
  ${captureLine}

  return new Response(${JSON.stringify(JSON.stringify(body))}, {
    status: ${status},
    headers: { 'content-type': 'application/json' },
  })
}
`,
  )

  return {
    ...cleanEnv(),
    LINEAR_API_KEY: 'test-linear-preflight-token',
    NODE_OPTIONS: `--import=${mockPath}`,
  }
}

async function mockedFailIfCalledEnv(extraEnv: Record<string, string> = {}) {
  const workDir = await fixtureDir('linear-preflight-fetch-blocked')
  const mockPath = join(workDir, 'mock-fetch.mjs')

  await writeFile(
    mockPath,
    `globalThis.fetch = async () => {
  throw new Error('fetch should not be called')
}
`,
  )

  return {
    ...cleanEnv(),
    LINEAR_API_KEY: 'test-linear-preflight-token',
    ...extraEnv,
    NODE_OPTIONS: `--import=${mockPath}`,
  }
}

async function writeSeedFixture(label: string, seed: unknown) {
  const workDir = await fixtureDir(label)
  const seedPath = join(workDir, 'seed.json')
  await writeFile(seedPath, JSON.stringify(seed))
  return seedPath
}

async function fixtureDir(label: string) {
  const root = join(tmpdir(), 'honowarden-tests')
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, `${label}-`))
}
