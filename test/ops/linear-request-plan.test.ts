import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const linearRequestPlanScript = join(
  repoRoot,
  'scripts/honowarden-linear-request-plan.mjs',
)

type RequestPlanReport = {
  schemaVersion: 1
  status: 'ready' | 'blocked'
  blockingReason: string | null
  summary: {
    total: number
    byAction: Record<string, number>
    byKind: Record<string, number>
  }
  requestSteps: Array<{
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
  }>
  confirmations: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown>
  }>
  manualConfirmations: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown>
  }>
  unsupportedMutationSteps: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown>
  }>
  malformedMutationSteps: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown>
    malformedReasons: string[]
  }>
  limitations: string[]
}

describe('Linear request plan', () => {
  it('requires a mutation packet path', async () => {
    await expect(
      execFileAsync('node', [linearRequestPlanScript], {
        env: cleanEnv(),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('--mutation-packet is required'),
    })
  })

  it('keeps blocked packets closed and emits no executable buckets', async () => {
    const mutationPacketPath = await writeJsonFixture('blocked-packet', {
      schemaVersion: 1,
      status: 'not_ready',
      mutationSteps: [
        {
          id: 'linear:label:area:api',
          kind: 'label',
          name: 'area:api',
          action: 'create',
          dependencies: [],
          fields: { color: '#ff0000', description: 'API label' },
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })

    const result = await execFileAsync(
      'node',
      [linearRequestPlanScript, '--mutation-packet', mutationPacketPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as RequestPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe(
      'status mismatch: expected "ready", got "not_ready"',
    )
    expect(report.requestSteps).toEqual([])
    expect(report.confirmations).toEqual([])
    expect(report.manualConfirmations).toEqual([])
    expect(report.unsupportedMutationSteps).toEqual([])
    expect(report.malformedMutationSteps).toEqual([])
  })

  it('maps a ready mutation packet to request plan intent entries', async () => {
    const mutationPacketPath = await writeJsonFixture('ready-packet', {
      schemaVersion: 1,
      status: 'ready',
      mutationSteps: [
        {
          id: 'linear:label:area:api',
          seedKey: 'area-api',
          kind: 'label',
          name: 'area:api',
          action: 'create',
          dependencies: [],
          fields: {
            color: '#ff0000',
            description: 'API owner area',
          },
        },
        {
          id: 'linear:initiative:alpha',
          seedKey: 'alpha-initiative',
          kind: 'initiative',
          name: 'Alpha',
          action: 'create_or_update',
          dependencies: [],
          fields: {
            summary: 'alpha',
            targetDate: '2026-10-01',
            priority: 2,
          },
        },
        {
          id: 'linear:project:website',
          seedKey: 'website',
          kind: 'project',
          name: 'Website',
          action: 'create',
          dependencies: [
            'linear:initiative:alpha',
            'linear:label:release:alpha',
          ],
          fields: {
            summary: 'website',
            description: 'Public website project',
            priority: 1,
            labels: ['release:alpha'],
            startDate: '2026-07-01',
            targetDate: '2026-08-01',
          },
        },
        {
          id: 'linear:issue:public-docs',
          seedKey: 'public-docs',
          kind: 'issue',
          title: 'Public docs',
          action: 'create_or_update',
          dependencies: [
            'linear:project:website',
            'linear:milestone:website:launch',
            'linear:issue:blocker',
          ],
          fields: {
            projectKey: 'website',
            milestone: 'launch',
            blockedBy: ['blocker'],
            stateType: 'started',
            labels: ['area:api'],
            priority: 2,
          },
        },
        {
          id: 'linear:view:agent-queue',
          kind: 'view',
          name: 'Agent Queue',
          action: 'create_or_update',
          dependencies: [
            'linear:label:agent:codex',
            'linear:project-name:Website',
          ],
          fields: {
            scope: 'team',
            type: 'issue',
            layout: 'list',
            filters: {
              project: ['Website'],
              label: ['agent:codex'],
              statusType: ['backlog', 'started'],
            },
          },
        },
      ],
      confirmations: [
        {
          id: 'linear:view:ops',
          kind: 'view',
          name: 'Ops view',
          action: 'confirm_existing',
          dependencies: ['linear:project:website'],
          fields: {
            scope: 'project',
            type: 'issue',
            layout: 'board',
            filters: { project: ['website'] },
          },
        },
      ],
      manualConfirmations: [
        {
          id: 'linear:document:handoff',
          kind: 'document',
          title: 'Handoff notes',
          action: 'manual_confirm',
          dependencies: ['linear:project:website'],
          fields: {
            projectKey: 'website',
            content: 'Reviewed by team.',
          },
        },
      ],
    })

    const result = await execFileAsync(
      'node',
      [linearRequestPlanScript, '--', '--mutation-packet', mutationPacketPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as RequestPlanReport

    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.unsupportedMutationSteps).toEqual([])
    expect(report.malformedMutationSteps).toEqual([])
    expect(report.requestSteps).toHaveLength(5)
    expect(report.confirmations).toHaveLength(1)
    expect(report.manualConfirmations).toHaveLength(1)
    expect(report.requestSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'label',
          intent: 'ensure_label',
          requires: ['teamId'],
        }),
        expect.objectContaining({
          kind: 'initiative',
          intent: 'ensure_initiative',
          requires: ['workspaceId'],
        }),
        expect.objectContaining({
          kind: 'project',
          intent: 'ensure_project',
          requires: ['teamId', 'initiativeId', 'labelIds'],
        }),
        expect.objectContaining({
          kind: 'issue',
          intent: 'ensure_issue',
          requires: [
            'teamId',
            'projectId',
            'milestoneId',
            'stateId',
            'labelIds',
            'blockedByIssueIds',
          ],
        }),
        expect.objectContaining({
          kind: 'view',
          intent: 'ensure_view',
          requires: ['teamId', 'projectId', 'labelIds', 'stateIds'],
        }),
      ]),
    )

    expect(report.requestSteps[0]).toMatchObject({
      id: 'linear:label:area:api',
      action: 'create',
      dependencies: [],
    })

    expect(report.confirmations[0]).toMatchObject({
      id: 'linear:view:ops',
      action: 'confirm_existing',
      dependencies: ['linear:project:website'],
    })

    expect(report.manualConfirmations[0]).toMatchObject({
      id: 'linear:document:handoff',
      action: 'manual_confirm',
      dependencies: ['linear:project:website'],
    })
  })

  it('blocks packets with unsupported mutation step kinds', async () => {
    const mutationPacketPath = await writeJsonFixture(
      'unsupported-kind-packet',
      {
        schemaVersion: 1,
        status: 'ready',
        mutationSteps: [
          {
            id: 'linear:custom:unknown',
            kind: 'legacy_template',
            name: 'Legacy',
            action: 'create',
            dependencies: [],
            fields: {},
          },
        ],
        confirmations: [],
        manualConfirmations: [],
      },
    )

    const result = await execFileAsync(
      'node',
      [linearRequestPlanScript, '--mutation-packet', mutationPacketPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as RequestPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toContain('unsupported mutation steps')
    expect(report.requestSteps).toEqual([])
    expect(report.unsupportedMutationSteps).toEqual([
      expect.objectContaining({
        id: 'linear:custom:unknown',
        kind: 'legacy_template',
        action: 'create',
      }),
    ])
    expect(report.malformedMutationSteps).toEqual([])
  })

  it('blocks packets with unsupported mutation step actions', async () => {
    const mutationPacketPath = await writeJsonFixture(
      'unsupported-action-packet',
      {
        schemaVersion: 1,
        status: 'ready',
        mutationSteps: [
          {
            id: 'linear:issue:existing',
            seedKey: 'existing',
            kind: 'issue',
            title: 'Existing issue',
            action: 'confirm_existing',
            dependencies: ['linear:project:alpha'],
            fields: {
              projectKey: 'alpha',
              priority: 2,
              estimate: 1,
              stateType: 'started',
              labels: [],
              description: 'Existing issue',
            },
          },
        ],
        confirmations: [],
        manualConfirmations: [],
      },
    )

    const result = await execFileAsync(
      'node',
      [linearRequestPlanScript, '--mutation-packet', mutationPacketPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as RequestPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe(
      'unsupported mutation steps: linear:issue:existing:issue:confirm_existing',
    )
    expect(report.requestSteps).toEqual([])
    expect(report.unsupportedMutationSteps).toEqual([
      expect.objectContaining({
        id: 'linear:issue:existing',
        kind: 'issue',
        action: 'confirm_existing',
      }),
    ])
    expect(report.malformedMutationSteps).toEqual([])
  })

  it('blocks packets with malformed mutation step shape', async () => {
    const mutationPacketPath = await writeJsonFixture('malformed-step-packet', {
      schemaVersion: 1,
      status: 'ready',
      mutationSteps: [
        {
          id: null,
          seedKey: 'missing-id',
          kind: 'project',
          name: 'Missing id',
          action: 'create',
          dependencies: [],
          fields: {
            summary: 'Missing id',
            description: 'Missing id',
            startDate: '2026-07-01',
            targetDate: '2026-08-01',
            priority: 2,
          },
        },
        {
          id: 'linear:label:missing-shape',
          kind: 'label',
          name: 'missing shape',
          action: 'create',
        },
      ],
      confirmations: [],
      manualConfirmations: [],
    })

    const result = await execFileAsync(
      'node',
      [linearRequestPlanScript, '--mutation-packet', mutationPacketPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as RequestPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toContain('malformed mutation steps')
    expect(report.requestSteps).toEqual([])
    expect(report.unsupportedMutationSteps).toEqual([])
    expect(report.malformedMutationSteps).toHaveLength(2)
    expect(report.malformedMutationSteps[0]).toMatchObject({
      id: null,
      seedKey: 'missing-id',
      kind: 'project',
      action: 'create',
      malformedReasons: expect.arrayContaining(['missing-id']),
    })
    expect(report.malformedMutationSteps[1]).toMatchObject({
      id: 'linear:label:missing-shape',
      kind: 'label',
      action: 'create',
      malformedReasons: expect.arrayContaining([
        'missing-dependencies',
        'missing-fields',
      ]),
    })
  })

  it('blocks packets missing mutationSteps array', async () => {
    const mutationPacketPath = await writeJsonFixture(
      'missing-mutation-steps',
      {
        schemaVersion: 1,
        status: 'ready',
        confirmations: [],
        manualConfirmations: [],
      },
    )

    const result = await execFileAsync(
      'node',
      [linearRequestPlanScript, '--mutation-packet', mutationPacketPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as RequestPlanReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('mutationSteps array missing')
    expect(report.requestSteps).toEqual([])
    expect(report.unsupportedMutationSteps).toEqual([])
    expect(report.malformedMutationSteps).toEqual([])
  })

  it('fails strict mode for non-ready packets', async () => {
    const mutationPacketPath = await writeJsonFixture('strict-fail-packet', {
      schemaVersion: 1,
      status: 'not_ready',
      mutationSteps: [],
    })

    await expect(
      execFileAsync(
        'node',
        [
          linearRequestPlanScript,
          '--',
          '--strict',
          '--mutation-packet',
          mutationPacketPath,
        ],
        {
          env: cleanEnv(),
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('linear request plan is not ready'),
    })
  })

  it('does not call fetch and does not leak credentials in output', async () => {
    const { env, fetchCalledPath } = await noNetworkEnv()
    const mutationPacketPath = await writeJsonFixture('local-only-plan', {
      schemaVersion: 1,
      status: 'ready',
      mutationSteps: [
        {
          id: 'linear:project:alpha',
          seedKey: 'alpha',
          kind: 'project',
          name: 'alpha',
          action: 'create',
          dependencies: [],
          fields: {
            summary: 'alpha',
            description: 'alpha',
            startDate: '2026-07-01',
            targetDate: '2026-08-01',
            priority: 2,
          },
        },
      ],
    })

    const result = await execFileAsync(
      'node',
      [linearRequestPlanScript, '--mutation-packet', mutationPacketPath],
      {
        env,
      },
    )
    const report = JSON.parse(result.stdout) as RequestPlanReport

    expect(report.status).toBe('ready')
    expect(result.stdout).not.toContain('test-linear-request-token')
    expect(report.limitations).toContain(
      'This request plan is local-only and does not read credentials, fetch, or perform network calls.',
    )

    await expect(fileExists(fetchCalledPath)).resolves.toBe(false)
  })
})

async function writeJsonFixture(label: string, value: unknown) {
  const dir = await fixtureDir(label)
  const path = join(dir, 'mutation-packet.json')
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
  const dir = await fixtureDir('linear-request-plan-network')
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
      LINEAR_API_KEY: 'test-linear-request-token',
      NODE_OPTIONS: `--import=${mockPath}`,
    }),
    fetchCalledPath,
  }
}
