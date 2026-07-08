import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const linearMutationPacketScript = join(
  repoRoot,
  'scripts/honowarden-linear-mutation-packet.mjs',
)

type MutationPacketReport = {
  schemaVersion: 1
  status: 'ready' | 'blocked'
  blockingReason: string | null
  summary: {
    total: number
    byAction: Record<string, number>
    byKind: Record<string, number>
  }
  unsupportedOperations: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown> | null
  }>
  malformedOperations: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown> | null
    malformedReasons: string[]
  }>
  mutationSteps: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown> | null
  }>
  confirmations: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown> | null
  }>
  manualConfirmations: Array<{
    id: string | null
    seedKey: string | null
    kind: string | null
    name: string | null
    title: string | null
    action: string | null
    dependencies: string[]
    fields: Record<string, unknown> | null
  }>
  limitations: string[]
}

describe('Linear mutation packet', () => {
  it('requires an apply plan path', async () => {
    await expect(
      execFileAsync('node', [linearMutationPacketScript], {
        env: cleanEnv(),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('--apply-plan is required'),
    })
  })

  it('keeps blocked plans closed and omits executable buckets', async () => {
    const applyPlanPath = await writeJsonFixture('blocked-plan', {
      schemaVersion: 1,
      mode: 'plan',
      status: 'not_ready',
      operations: [
        {
          id: 'linear:label:area:api',
          kind: 'label',
          name: 'area:api',
          action: 'create',
          dependencies: [],
          fields: { color: '#ff0000' },
        },
        {
          id: 'linear:issue:ready-check',
          kind: 'issue',
          title: 'Ready check',
          action: 'confirm_existing',
          dependencies: [],
          fields: { stateType: 'backlog' },
        },
        {
          id: 'linear:view:Manual scope',
          kind: 'view',
          name: 'Manual scope',
          action: 'manual_confirm',
          dependencies: ['linear:project:alpha'],
          fields: {},
        },
      ],
    })
    const result = await execFileAsync(
      'node',
      [linearMutationPacketScript, '--', '--apply-plan', applyPlanPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as MutationPacketReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe(
      'status mismatch: expected "ready", got "not_ready"',
    )
    expect(report.summary.total).toBe(3)
    expect(report.summary.byAction).toEqual({
      create: 1,
      confirm_existing: 1,
      manual_confirm: 1,
    })
    expect(report.summary.byKind).toEqual({
      label: 1,
      issue: 1,
      view: 1,
    })
    expect(report.mutationSteps).toEqual([])
    expect(report.confirmations).toEqual([])
    expect(report.manualConfirmations).toEqual([])
    expect(report.unsupportedOperations).toEqual([])
    expect(report.malformedOperations).toEqual([])
    expect(report.limitations).toContain(
      'Blocked packets intentionally omit mutation steps and confirmations.',
    )
  })

  it('emits ready mutation, confirm, and manual confirmation packets for a ready plan', async () => {
    const applyPlanPath = await writeJsonFixture('ready-plan', {
      schemaVersion: 1,
      mode: 'plan',
      status: 'ready',
      operations: [
        {
          id: 'linear:issue:issue-a',
          seedKey: 'issue-a',
          kind: 'issue',
          title: 'Issue A',
          action: 'create_or_update',
          dependencies: ['linear:project:alpha'],
          fields: {
            projectKey: 'alpha',
            priority: 2,
            estimate: 3,
            stateType: 'started',
            labels: ['area:api'],
            description: 'Issue A description',
          },
        },
        {
          id: 'linear:issue:existing-b',
          seedKey: 'existing-b',
          kind: 'issue',
          title: 'Issue B',
          action: 'confirm_existing',
          dependencies: ['linear:issue:issue-a'],
          fields: {
            projectKey: 'alpha',
            priority: 2,
            estimate: 2,
            stateType: 'started',
            labels: ['area:api'],
            description: 'Issue B description',
          },
        },
        {
          id: 'linear:view:view-a',
          kind: 'view',
          name: 'Scoped View',
          action: 'manual_confirm',
          dependencies: ['linear:project:alpha'],
          fields: {
            scope: 'project',
            type: 'issue',
            layout: 'board',
            filters: { project: ['alpha'] },
          },
        },
      ],
    })
    const result = await execFileAsync(
      'node',
      [linearMutationPacketScript, '--apply-plan', applyPlanPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as MutationPacketReport

    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.summary.total).toBe(3)
    expect(report.unsupportedOperations).toEqual([])
    expect(report.malformedOperations).toEqual([])
    expect(report.mutationSteps).toHaveLength(1)
    expect(report.confirmations).toHaveLength(1)
    expect(report.manualConfirmations).toHaveLength(1)
    expect(report.mutationSteps[0]).toMatchObject({
      id: 'linear:issue:issue-a',
      seedKey: 'issue-a',
      kind: 'issue',
      title: 'Issue A',
      action: 'create_or_update',
      dependencies: ['linear:project:alpha'],
      fields: expect.objectContaining({
        projectKey: 'alpha',
        estimate: 3,
      }),
    })
    expect(report.confirmations[0]).toMatchObject({
      id: 'linear:issue:existing-b',
      seedKey: 'existing-b',
      title: 'Issue B',
      action: 'confirm_existing',
      dependencies: ['linear:issue:issue-a'],
    })
    expect(report.manualConfirmations[0]).toMatchObject({
      id: 'linear:view:view-a',
      name: 'Scoped View',
      action: 'manual_confirm',
      dependencies: ['linear:project:alpha'],
    })
  })

  it('blocks ready plans that contain unsupported operation actions', async () => {
    const applyPlanPath = await writeJsonFixture('unsupported-action-plan', {
      schemaVersion: 1,
      mode: 'plan',
      status: 'ready',
      operations: [
        {
          id: 'linear:issue:stale',
          seedKey: 'stale',
          kind: 'issue',
          title: 'Stale issue',
          action: 'pending_preflight',
          dependencies: [],
          fields: { projectKey: 'alpha' },
        },
      ],
    })

    await expect(
      execFileAsync(
        'node',
        [linearMutationPacketScript, '--apply-plan', applyPlanPath, '--strict'],
        {
          env: cleanEnv(),
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"status": "blocked"'),
      stderr: expect.stringContaining('unsupported operation actions'),
    })

    const result = await execFileAsync(
      'node',
      [linearMutationPacketScript, '--apply-plan', applyPlanPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as MutationPacketReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe(
      'unsupported operation actions: linear:issue:stale:pending_preflight',
    )
    expect(report.unsupportedOperations).toEqual([
      expect.objectContaining({
        id: 'linear:issue:stale',
        seedKey: 'stale',
        action: 'pending_preflight',
      }),
    ])
    expect(report.malformedOperations).toEqual([])
    expect(report.mutationSteps).toEqual([])
    expect(report.confirmations).toEqual([])
    expect(report.manualConfirmations).toEqual([])
  })

  it('blocks ready plans without an operations array', async () => {
    const applyPlanPath = await writeJsonFixture('missing-operations-plan', {
      schemaVersion: 1,
      mode: 'plan',
      status: 'ready',
    })

    await expect(
      execFileAsync(
        'node',
        [linearMutationPacketScript, '--apply-plan', applyPlanPath, '--strict'],
        {
          env: cleanEnv(),
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"status": "blocked"'),
      stderr: expect.stringContaining('operations array missing'),
    })

    const result = await execFileAsync(
      'node',
      [linearMutationPacketScript, '--apply-plan', applyPlanPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as MutationPacketReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toBe('operations array missing')
    expect(report.summary.total).toBe(0)
    expect(report.unsupportedOperations).toEqual([])
    expect(report.malformedOperations).toEqual([])
    expect(report.mutationSteps).toEqual([])
    expect(report.confirmations).toEqual([])
    expect(report.manualConfirmations).toEqual([])
  })

  it('blocks ready plans with malformed supported operations', async () => {
    const applyPlanPath = await writeJsonFixture('malformed-operation-plan', {
      schemaVersion: 1,
      mode: 'plan',
      status: 'ready',
      operations: [
        {
          id: null,
          seedKey: 'missing-id',
          kind: 'issue',
          title: 'Missing id',
          action: 'create',
          dependencies: [],
          fields: { projectKey: 'alpha' },
        },
        {
          id: 'linear:project:missing-kind',
          name: 'Missing kind',
          action: 'create_or_update',
          dependencies: [],
          fields: { summary: 'missing kind' },
        },
        {
          id: 'linear:label:missing-shape',
          kind: 'label',
          name: 'missing shape',
          action: 'create',
        },
      ],
    })

    await expect(
      execFileAsync(
        'node',
        [linearMutationPacketScript, '--apply-plan', applyPlanPath, '--strict'],
        {
          env: cleanEnv(),
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"status": "blocked"'),
      stderr: expect.stringContaining('malformed operations'),
    })

    const result = await execFileAsync(
      'node',
      [linearMutationPacketScript, '--apply-plan', applyPlanPath],
      {
        env: cleanEnv(),
      },
    )
    const report = JSON.parse(result.stdout) as MutationPacketReport

    expect(report.status).toBe('blocked')
    expect(report.blockingReason).toContain('malformed operations:')
    expect(report.malformedOperations).toHaveLength(3)
    expect(report.malformedOperations[0]).toMatchObject({
      id: null,
      seedKey: 'missing-id',
      kind: 'issue',
      action: 'create',
      malformedReasons: expect.arrayContaining(['missing-id']),
    })
    expect(report.malformedOperations[1]).toMatchObject({
      id: 'linear:project:missing-kind',
      kind: null,
      action: 'create_or_update',
      malformedReasons: expect.arrayContaining(['missing-kind']),
    })
    expect(report.malformedOperations[2]).toMatchObject({
      id: 'linear:label:missing-shape',
      kind: 'label',
      action: 'create',
      malformedReasons: expect.arrayContaining([
        'missing-dependencies',
        'missing-fields',
      ]),
    })
    expect(report.mutationSteps).toEqual([])
    expect(report.confirmations).toEqual([])
    expect(report.manualConfirmations).toEqual([])
  })

  it('fails strict mode when apply plan is not ready', async () => {
    const applyPlanPath = await writeJsonFixture('strict-plan', {
      schemaVersion: 1,
      mode: 'plan',
      status: 'not_ready',
      operations: [],
    })

    await expect(
      execFileAsync(
        'node',
        [
          linearMutationPacketScript,
          '--',
          '--strict',
          '--apply-plan',
          applyPlanPath,
        ],
        {
          env: cleanEnv(),
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"status": "blocked"'),
    })
  })

  it('does not call fetch and does not leak credentials in output', async () => {
    const { env, fetchCalledPath } = await noNetworkEnv()
    const applyPlanPath = await writeJsonFixture('local-only-plan', {
      schemaVersion: 1,
      mode: 'plan',
      status: 'ready',
      operations: [
        {
          id: 'linear:project:alpha',
          seedKey: 'alpha',
          kind: 'project',
          name: 'alpha',
          action: 'create',
          dependencies: [],
          fields: {
            summary: 'alpha project',
            description: 'alpha project description',
            startDate: '2026-07-08',
            targetDate: '2027-01-03',
            priority: 2,
          },
        },
      ],
    })

    const result = await execFileAsync(
      'node',
      [linearMutationPacketScript, '--apply-plan', applyPlanPath],
      {
        env,
      },
    )
    const report = JSON.parse(result.stdout) as MutationPacketReport

    expect(report.status).toBe('ready')
    expect(result.stdout).not.toContain('test-linear-mutation-token')
    expect(report.limitations).toContain(
      'Live Linear writes still require a separate guarded executor with explicit credentials and runtime approval.',
    )
    await expect(fileExists(fetchCalledPath)).resolves.toBe(false)
  })
})

async function writeJsonFixture(label: string, value: unknown) {
  const dir = await fixtureDir(label)
  const path = join(dir, 'apply-plan.json')
  await writeFile(path, JSON.stringify(value, null, 2))
  return path
}

async function fixtureDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${label}-`))
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

async function noNetworkEnv() {
  const dir = await fixtureDir('linear-mutation-packet-network')
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
      LINEAR_API_KEY: 'test-linear-mutation-token',
      NODE_OPTIONS: `--import=${mockPath}`,
    }),
    fetchCalledPath,
  }
}
