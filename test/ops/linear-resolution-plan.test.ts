import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const linearResolutionPlanScript = join(
  repoRoot,
  'scripts/honowarden-linear-resolution-plan.mjs',
)

type ResolutionRequestStep = {
  id: string | null
  seedKey: string | null
  kind: string | null
  name: string | null
  title: string | null
  action: string | null
  dependencies: string[]
  fields: Record<string, unknown>
  intent: string | null
  requires: string[]
}

type ResolvedRequestStep = ResolutionRequestStep & {
  workspaceId: string | null
  teamId: string | null
  initiativeId: string | null
  projectId: string | null
  projectIds: string[]
  milestoneId: string | null
  stateId: string | null
  stateIds: string[]
  labelIds: string[]
  blockedByIssueIds: string[]
}

type ResolutionPlanReport = {
  schemaVersion: 1
  generatedAt: string
  mode: 'resolution_plan'
  status: 'ready' | 'blocked'
  blockingReason: string | null
  summary: {
    total: number
    byAction: Record<string, number>
    byKind: Record<string, number>
  }
  resolvedRequestSteps: ResolvedRequestStep[]
  confirmations: Array<
    Omit<ResolutionRequestStep, 'requires'> & {
      intent: string | null
    }
  >
  manualConfirmations: Array<
    Omit<ResolutionRequestStep, 'requires'> & {
      intent: string | null
    }
  >
  missingResolutions: Array<{
    stepId: string | null
    seedKey: string | null
    stepIndex: number
    requirement: string
    reference: string
  }>
  unsupportedRequirements: Array<{
    stepId: string | null
    seedKey: string | null
    stepIndex: number
    requirement: string
  }>
  malformedRequestSteps: Array<
    ResolutionRequestStep & {
      malformedReasons: string[]
    }
  >
  limitations: string[]
}

describe('Linear resolution plan', () => {
  it('requires a request plan path', async () => {
    await expect(
      execFileAsync('node', [linearResolutionPlanScript], {
        env: cleanEnv(),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('--request-plan is required'),
    })
  })

  it('blocks when the map is missing', async () => {
    const requestPlanPath = await writeJsonFixture('missing-map', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'ready',
      requestSteps: [
        {
          id: 'linear:label:area:api',
          seedKey: 'label-api',
          kind: 'label',
          name: 'area:api',
          action: 'create',
          dependencies: [],
          fields: { color: '#ff0000', description: 'API area' },
          intent: 'ensure_label',
          requires: ['teamId'],
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })

    const result = await execFileAsync(
      'node',
      [linearResolutionPlanScript, '--request-plan', requestPlanPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('resolution_map_missing')
    expect(report.resolvedRequestSteps).toEqual([])
    expect(report.confirmations).toEqual([])
    expect(report.manualConfirmations).toEqual([])
    expect(report.missingResolutions).toEqual([])
    expect(report.unsupportedRequirements).toEqual([])
    expect(report.malformedRequestSteps).toEqual([])
  })

  it('resolves request step requirements with a complete map', async () => {
    const requestPlanPath = await writeJsonFixture('ready-plan', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'ready',
      requestSteps: [
        {
          id: 'linear:label:area:api',
          seedKey: 'label-api',
          kind: 'label',
          name: 'area:api',
          action: 'create',
          dependencies: [],
          fields: {
            color: '#ff0000',
            description: 'API area',
          },
          intent: 'ensure_label',
          requires: ['teamId'],
        },
        {
          id: 'linear:initiative:alpha-launch',
          seedKey: 'alpha-launch',
          kind: 'initiative',
          name: 'HonoWarden Alpha Launch',
          action: 'create',
          dependencies: [],
          fields: {
            summary: 'alpha launch',
            targetDate: '2026-10-01',
          },
          intent: 'ensure_initiative',
          requires: ['workspaceId'],
        },
        {
          id: 'linear:project:alpha-api',
          seedKey: 'alpha-api',
          kind: 'project',
          name: 'HonoWarden v0.1.0-alpha',
          action: 'create_or_update',
          dependencies: ['linear:initiative:alpha-launch'],
          fields: {
            summary: 'Alpha API',
            labels: ['area:api', 'release:alpha'],
            state: 'active',
            startDate: '2026-07-01',
            targetDate: '2026-08-01',
          },
          intent: 'ensure_project',
          requires: ['teamId', 'initiativeId', 'labelIds'],
        },
        {
          id: 'linear:milestone:alpha-api:Week 26 - v0.1.0-alpha',
          seedKey: 'alpha-milestone',
          kind: 'milestone',
          name: 'Week 26 - v0.1.0-alpha',
          action: 'create',
          dependencies: ['linear:project:alpha-api'],
          fields: {
            dueDate: '2026-07-31',
          },
          intent: 'ensure_milestone',
          requires: ['projectId'],
        },
        {
          id: 'linear:issue:alpha-release',
          seedKey: 'alpha-release',
          kind: 'issue',
          title: 'Alpha release',
          action: 'create_or_update',
          dependencies: [
            'linear:project:alpha-api',
            'linear:milestone:alpha-api:Week 26 - v0.1.0-alpha',
            'linear:issue:env-setup',
            'linear:label:area:api',
          ],
          fields: {
            projectKey: 'alpha-api',
            milestone: 'Week 26 - v0.1.0-alpha',
            blockedBy: ['env-setup'],
            stateType: 'started',
            labels: ['release:alpha'],
            priority: 2,
          },
          intent: 'ensure_issue',
          requires: [
            'teamId',
            'projectId',
            'milestoneId',
            'stateId',
            'labelIds',
            'blockedByIssueIds',
          ],
        },
        {
          id: 'linear:view:alpha-queue',
          seedKey: 'alpha-queue',
          kind: 'view',
          name: 'Alpha Queue',
          action: 'create',
          dependencies: [
            'linear:initiative:alpha-launch',
            'linear:project-name:Website',
          ],
          fields: {
            scope: 'project',
            type: 'issue',
            layout: 'list',
            filters: {
              project: ['Website'],
              label: ['agent:codex'],
              statusType: ['backlog', 'completed'],
            },
          },
          intent: 'ensure_view',
          requires: ['projectId', 'labelIds', 'stateIds'],
        },
      ],
      confirmations: [
        {
          id: 'linear:view:alpha-existing-view',
          seedKey: 'alpha-existing-view',
          kind: 'view',
          name: 'Existing view',
          action: 'confirm_existing',
          dependencies: ['linear:project:alpha-api'],
          fields: {
            scope: 'team',
          },
          intent: 'ensure_view',
          requires: ['teamId'],
        },
      ],
      manualConfirmations: [
        {
          id: 'linear:document:release-overview',
          seedKey: 'release-overview',
          kind: 'document',
          name: 'Release overview',
          action: 'manual_confirm',
          dependencies: ['linear:project:alpha-api'],
          fields: {
            projectKey: 'alpha-api',
            content: 'Runbook check',
          },
          intent: 'ensure_document',
          requires: ['projectId'],
        },
      ],
    })
    const resolutionMapPath = await writeJsonFixture('ready-map', {
      schemaVersion: 1,
      workspaceId: 'workspace-hono-id',
      teamId: 'team-hono-id',
      refs: {
        'linear:label:area:api': 'label-area-id',
        'linear:label:release:alpha': 'label-release-id',
        'linear:label:agent:codex': 'label-codex-id',
        'linear:initiative:alpha-launch': 'initiative-alpha-id',
        'linear:project:alpha-api': 'project-alpha-api-id',
        'linear:project-name:Website': 'project-alpha-api-id',
        'linear:milestone:alpha-api:Week 26 - v0.1.0-alpha':
          'milestone-week26-id',
        'linear:issue:env-setup': 'issue-env-setup-id',
      },
      stateIds: {
        backlog: 'state-backlog-id',
        started: 'state-started-id',
        completed: 'state-completed-id',
      },
    })

    const result = await execFileAsync(
      'node',
      [
        linearResolutionPlanScript,
        '--',
        '--request-plan',
        requestPlanPath,
        '--resolution-map',
        resolutionMapPath,
      ],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.mode).toBe('resolution_plan')
    expect(report.unsupportedRequirements).toEqual([])
    expect(report.malformedRequestSteps).toEqual([])
    expect(report.summary).toEqual({
      total: 6,
      byAction: {
        create: 4,
        create_or_update: 2,
      },
      byKind: {
        label: 1,
        initiative: 1,
        project: 1,
        milestone: 1,
        issue: 1,
        view: 1,
      },
    })

    const steps = Object.fromEntries(
      report.resolvedRequestSteps.map((step) => [step.id ?? '', step]),
    )
    expect(steps['linear:initiative:alpha-launch']).toMatchObject({
      initiativeId: null,
      workspaceId: 'workspace-hono-id',
    })
    expect(steps['linear:project:alpha-api']).toMatchObject({
      id: 'linear:project:alpha-api',
      teamId: 'team-hono-id',
      initiativeId: 'initiative-alpha-id',
      labelIds: ['label-area-id', 'label-release-id'],
    })
    expect(steps['linear:issue:alpha-release']).toMatchObject({
      teamId: 'team-hono-id',
      projectId: 'project-alpha-api-id',
      milestoneId: 'milestone-week26-id',
      stateId: 'state-started-id',
      labelIds: expect.arrayContaining(['label-area-id', 'label-release-id']),
      blockedByIssueIds: ['issue-env-setup-id'],
    })
    expect(steps['linear:view:alpha-queue']).toMatchObject({
      projectId: 'project-alpha-api-id',
      projectIds: ['project-alpha-api-id'],
      labelIds: ['label-codex-id'],
      stateIds: ['state-backlog-id', 'state-completed-id'],
    })
    expect(
      steps['linear:milestone:alpha-api:Week 26 - v0.1.0-alpha'],
    ).toMatchObject({
      projectId: 'project-alpha-api-id',
    })
    expect(steps['linear:label:area:api']).toMatchObject({
      teamId: 'team-hono-id',
    })

    expect(report.confirmations).toHaveLength(1)
    expect(report.confirmations[0]).toMatchObject({
      id: 'linear:view:alpha-existing-view',
      action: 'confirm_existing',
      intent: 'ensure_view',
    })
    expect(report.manualConfirmations).toHaveLength(1)
    expect(report.manualConfirmations[0]).toMatchObject({
      id: 'linear:document:release-overview',
      action: 'manual_confirm',
      intent: 'ensure_document',
    })
  })

  it('blocks when any project-filtered view project is unresolved', async () => {
    const requestPlanPath = await writeJsonFixture('multi-project-view-plan', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'ready',
      requestSteps: [
        {
          id: 'linear:view:multi-project',
          seedKey: 'multi-project',
          kind: 'view',
          name: 'Multi Project',
          action: 'create',
          dependencies: ['linear:project:alpha', 'linear:project:ops'],
          fields: {
            scope: 'team',
            type: 'issue',
            layout: 'list',
            filters: {
              project: ['Alpha', 'Ops'],
            },
          },
          intent: 'ensure_view',
          requires: ['teamId', 'projectId'],
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })
    const resolutionMapPath = await writeJsonFixture('multi-project-view-map', {
      schemaVersion: 1,
      workspaceId: 'workspace-id',
      teamId: 'team-id',
      refs: {
        'linear:project:alpha': 'project-alpha-id',
        'linear:project-name:Alpha': 'project-alpha-id',
      },
      stateIds: {},
    })

    const result = await execFileAsync(
      'node',
      [
        linearResolutionPlanScript,
        '--request-plan',
        requestPlanPath,
        '--resolution-map',
        resolutionMapPath,
      ],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toContain('missing linear resolutions')
    expect(report.resolvedRequestSteps).toEqual([])
    expect(report.missingResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'linear:view:multi-project',
          requirement: 'projectId',
          reference: 'linear:project:ops',
        }),
        expect.objectContaining({
          stepId: 'linear:view:multi-project',
          requirement: 'projectId',
          reference: 'linear:project-name:Ops',
        }),
      ]),
    )
  })

  it('reports missingResolutions for unresolved references', async () => {
    const requestPlanPath = await writeJsonFixture('missing-entry-plan', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'ready',
      requestSteps: [
        {
          id: 'linear:project:alpha-api',
          seedKey: 'alpha-api',
          kind: 'project',
          name: 'Alpha API',
          action: 'create_or_update',
          dependencies: ['linear:initiative:alpha-launch'],
          fields: {},
          intent: 'ensure_project',
          requires: ['teamId', 'initiativeId'],
        },
        {
          id: 'linear:issue:alpha-release',
          seedKey: 'alpha-release',
          kind: 'issue',
          title: 'Alpha release',
          action: 'create_or_update',
          dependencies: ['linear:project:alpha-api'],
          fields: {
            projectKey: 'alpha-api',
            milestone: 'Missing milestone',
            blockedBy: ['blocked-issue'],
            stateType: 'started',
            labels: ['area:api', 'missing-label'],
          },
          intent: 'ensure_issue',
          requires: [
            'teamId',
            'projectId',
            'milestoneId',
            'stateId',
            'labelIds',
            'blockedByIssueIds',
          ],
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })
    const resolutionMapPath = await writeJsonFixture('missing-entry-map', {
      schemaVersion: 1,
      workspaceId: 'workspace-hono-id',
      teamId: 'team-hono-id',
      refs: {
        'linear:project:alpha-api': 'project-alpha-id',
        'linear:label:area:api': 'label-area-id',
      },
      stateIds: {
        started: 'state-started-id',
      },
    })

    const result = await execFileAsync(
      'node',
      [
        linearResolutionPlanScript,
        '--request-plan',
        requestPlanPath,
        '--resolution-map',
        resolutionMapPath,
      ],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toContain('missing linear resolutions')
    expect(report.resolvedRequestSteps).toEqual([])
    expect(report.missingResolutions.length).toBeGreaterThanOrEqual(4)
    expect(report.missingResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'linear:project:alpha-api',
          requirement: 'initiativeId',
          reference: 'linear:initiative:alpha-launch',
        }),
        expect.objectContaining({
          stepId: 'linear:issue:alpha-release',
          requirement: 'milestoneId',
          reference: 'linear:milestone:Missing milestone',
        }),
        expect.objectContaining({
          stepId: 'linear:issue:alpha-release',
          requirement: 'milestoneId',
          reference: 'linear:milestone:alpha-api:Missing milestone',
        }),
        expect.objectContaining({
          stepId: 'linear:issue:alpha-release',
          requirement: 'labelIds',
          reference: 'linear:label:missing-label',
        }),
      ]),
    )
  })

  it('blocks request plans with unsupported requirements', async () => {
    const requestPlanPath = await writeJsonFixture(
      'unsupported-requirement-plan',
      {
        schemaVersion: 1,
        mode: 'request_plan',
        status: 'ready',
        requestSteps: [
          {
            id: 'linear:issue:alpha-release',
            seedKey: 'alpha-release',
            kind: 'issue',
            title: 'Alpha release',
            action: 'create_or_update',
            dependencies: [],
            fields: {
              projectKey: 'alpha-api',
            },
            intent: 'ensure_issue',
            requires: ['teamId', 'unknownFutureId'],
          },
        ],
        confirmations: [],
        manualConfirmations: [],
      },
    )
    const resolutionMapPath = await writeJsonFixture(
      'unsupported-requirement-map',
      {
        schemaVersion: 1,
        workspaceId: 'workspace-id',
        teamId: 'team-id',
        refs: {},
        stateIds: {},
      },
    )

    const result = await execFileAsync(
      'node',
      [
        linearResolutionPlanScript,
        '--request-plan',
        requestPlanPath,
        '--resolution-map',
        resolutionMapPath,
      ],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe(
      'unsupported request requirements: linear:issue:alpha-release:unknownFutureId',
    )
    expect(report.resolvedRequestSteps).toEqual([])
    expect(report.unsupportedRequirements).toEqual([
      expect.objectContaining({
        stepId: 'linear:issue:alpha-release',
        requirement: 'unknownFutureId',
      }),
    ])
    expect(report.malformedRequestSteps).toEqual([])
  })

  it('blocks malformed request steps', async () => {
    const requestPlanPath = await writeJsonFixture('malformed-request-plan', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'ready',
      requestSteps: [
        {
          id: null,
          seedKey: 'missing-id',
          kind: 'project',
          name: 'Missing id',
          action: 'create',
          dependencies: [],
          fields: {},
          intent: 'ensure_project',
          requires: ['teamId'],
        },
        {
          id: 'linear:label:missing-shape',
          seedKey: 'missing-shape',
          kind: 'label',
          name: 'missing shape',
          action: 'create',
          intent: 'ensure_label',
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })
    const resolutionMapPath = await writeJsonFixture('malformed-request-map', {
      schemaVersion: 1,
      workspaceId: 'workspace-id',
      teamId: 'team-id',
      refs: {},
      stateIds: {},
    })

    const result = await execFileAsync(
      'node',
      [
        linearResolutionPlanScript,
        '--request-plan',
        requestPlanPath,
        '--resolution-map',
        resolutionMapPath,
      ],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toContain('malformed request steps')
    expect(report.resolvedRequestSteps).toEqual([])
    expect(report.unsupportedRequirements).toEqual([])
    expect(report.malformedRequestSteps).toHaveLength(2)
    expect(report.malformedRequestSteps[0]).toMatchObject({
      id: null,
      seedKey: 'missing-id',
      kind: 'project',
      malformedReasons: expect.arrayContaining(['missing-id']),
    })
    expect(report.malformedRequestSteps[1]).toMatchObject({
      id: 'linear:label:missing-shape',
      seedKey: 'missing-shape',
      kind: 'label',
      malformedReasons: expect.arrayContaining([
        'missing-dependencies',
        'missing-fields',
        'missing-requires',
      ]),
    })
  })

  it('keeps blocked request plans closed and no resolved buckets', async () => {
    const requestPlanPath = await writeJsonFixture('blocked-request-plan', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'not_ready',
      requestSteps: [
        {
          id: 'linear:project:alpha-api',
          seedKey: 'alpha-api',
          kind: 'project',
          name: 'Alpha API',
          action: 'create',
          dependencies: [],
          fields: {},
          intent: 'ensure_project',
          requires: ['teamId'],
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })
    const resolutionMapPath = await writeJsonFixture(
      'blocked-request-plan-map',
      {
        schemaVersion: 1,
        workspaceId: 'workspace-id',
        teamId: 'team-id',
        refs: {},
        stateIds: {},
      },
    )

    const result = await execFileAsync(
      'node',
      [
        linearResolutionPlanScript,
        '--request-plan',
        requestPlanPath,
        '--resolution-map',
        resolutionMapPath,
      ],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe(
      'status mismatch: expected "ready", got "not_ready"',
    )
    expect(report.resolvedRequestSteps).toEqual([])
    expect(report.confirmations).toEqual([])
    expect(report.manualConfirmations).toEqual([])
  })

  it('fails strict mode for non-ready plans', async () => {
    const requestPlanPath = await writeJsonFixture('strict-fail-plan', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'not_ready',
      requestSteps: [],
      confirmations: [],
      manualConfirmations: [],
    })
    const resolutionMapPath = await writeJsonFixture('strict-fail-map', {
      schemaVersion: 1,
      workspaceId: 'workspace-id',
      teamId: 'team-id',
      refs: {},
      stateIds: {},
    })

    await expect(
      execFileAsync(
        'node',
        [
          linearResolutionPlanScript,
          '--strict',
          '--request-plan',
          requestPlanPath,
          '--resolution-map',
          resolutionMapPath,
        ],
        {
          env: cleanEnv(),
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        'linear resolution plan is not ready: status mismatch: expected "ready", got "not_ready"',
      ),
    })
  })

  it('does not call fetch and does not leak credentials in output', async () => {
    const requestPlanPath = await writeJsonFixture('no-network-plan', {
      schemaVersion: 1,
      mode: 'request_plan',
      status: 'ready',
      requestSteps: [
        {
          id: 'linear:project:alpha-api',
          seedKey: 'alpha-api',
          kind: 'project',
          name: 'alpha-api',
          action: 'create',
          dependencies: ['linear:initiative:alpha-launch'],
          fields: {
            labels: ['release:alpha'],
          },
          intent: 'ensure_project',
          requires: ['teamId', 'initiativeId', 'labelIds'],
        },
        {
          id: 'linear:initiative:alpha-launch',
          seedKey: 'alpha-launch',
          kind: 'initiative',
          name: 'HonoWarden Alpha Launch',
          action: 'create',
          dependencies: [],
          fields: {},
          intent: 'ensure_initiative',
          requires: ['workspaceId'],
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })
    const resolutionMapPath = await writeJsonFixture('no-network-map', {
      schemaVersion: 1,
      workspaceId: 'workspace-hono-id',
      teamId: 'team-hono-id',
      refs: {
        'linear:initiative:alpha-launch': 'initiative-id',
        'linear:project:alpha-api': 'project-id',
        'linear:label:release:alpha': 'label-release-id',
      },
      stateIds: {},
    })

    const { env, fetchCalledPath } = await noNetworkEnv()
    const result = await execFileAsync(
      'node',
      [
        linearResolutionPlanScript,
        '--request-plan',
        requestPlanPath,
        '--resolution-map',
        resolutionMapPath,
      ],
      {
        env,
      },
    )
    const report = JSON.parse(result.stdout) as ResolutionPlanReport

    expect(report.status).toBe('ready')
    expect(result.stdout).not.toContain('test-linear-resolution-token')
    expect(report.limitations).toContain(
      'This resolution plan is local-only and does not read credentials, fetch, or perform network calls.',
    )

    await expect(fileExists(fetchCalledPath)).resolves.toBe(false)
  })
})

async function writeJsonFixture(label: string, value: unknown) {
  const dir = await fixtureDir(label)
  const path = join(dir, 'request-plan.json')
  await writeFile(path, JSON.stringify(value, null, 2))
  return path
}

async function fixtureDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${label}-`))
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    ...extra,
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function noNetworkEnv() {
  const dir = await fixtureDir('linear-resolution-plan-network')
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
    env: cleanEnv({
      FETCH_CALLED_PATH: fetchCalledPath,
      LINEAR_API_KEY: 'test-linear-resolution-token',
      NODE_OPTIONS: `--import=${mockPath}`,
    }),
    fetchCalledPath,
  }
}
