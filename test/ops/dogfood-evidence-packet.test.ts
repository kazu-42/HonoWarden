import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const packetScript = join(
  repoRoot,
  'scripts/honowarden-dogfood-evidence-packet.mjs',
)

type DogfoodEvidencePacket = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  blockingReason: string | null
  targetEvidenceLevel: 'synthetic_dogfood'
  release: {
    version: string | null
    target: string
  }
  environment: {
    kind: string
    serverUrl: string | null
    sourceCommit: string | null
    runId: string
    evidenceDir: string
  }
  subjects: {
    syntheticUsers: string[]
    containsRealUserData: boolean
  }
  flowCoverage: {
    observedFlows: string[]
    groups: Array<{
      id: string
      status: 'pass' | 'fail'
      observedFlows: string[]
      missingFlows: string[]
    }>
  }
  requirements: Array<{
    id: string
    status: 'pass' | 'fail'
    blocker: string | null
  }>
  evidenceTemplate: {
    summaryPath: string
    prohibitedContent: string[]
  }
  limitations: string[]
}

const completeFlows = [
  'bootstrap_user_a',
  'bootstrap_user_b',
  'user_a_initial_sync',
  'user_b_initial_sync',
  'cross_user_sync_isolation',
  'cross_user_read_denied',
  'cross_user_mutation_denied',
  'disable_user',
  'disabled_password_grant_denied',
  'disabled_refresh_grant_denied',
  'disabled_sync_denied',
  'disabled_vault_crud_denied',
  'enable_user_rollback_plan',
]

describe('dogfood evidence packet', () => {
  it('records a ready synthetic two-user dogfood packet', async () => {
    const result = await execFileAsync('node', [
      packetScript,
      '--environment',
      'local',
      '--server-url',
      'https://localhost:8791',
      '--source-commit',
      '1234567890ab',
      '--run-id',
      '20260710T072500Z',
      '--generated-at',
      '2026-07-09T22:25:00Z',
      '--synthetic-user',
      'dogfood-user-a',
      '--synthetic-user',
      'dogfood-user-b',
      ...completeFlows.flatMap((flow) => ['--flow', flow]),
    ])
    const report = JSON.parse(result.stdout) as DogfoodEvidencePacket

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.targetEvidenceLevel).toBe('synthetic_dogfood')
    expect(report.release).toMatchObject({
      version: '0.1.0-alpha',
      target: 'v0.1.0-alpha',
    })
    expect(report.environment).toMatchObject({
      kind: 'local',
      serverUrl: 'https://localhost:8791',
      sourceCommit: '1234567890ab',
      runId: '20260710T072500Z',
      evidenceDir: 'docs/release/two-user-dogfood-evidence/20260710T072500Z',
    })
    expect(report.subjects).toEqual({
      syntheticUsers: ['dogfood-user-a', 'dogfood-user-b'],
      containsRealUserData: false,
    })
    expect(
      report.flowCoverage.groups.every((group) => group.status === 'pass'),
    ).toBe(true)
    expect(statusById(report, 'synthetic_data_only')).toBe('pass')
    expect(report.evidenceTemplate.summaryPath).toBe(
      'docs/release/two-user-dogfood-evidence/20260710T072500Z/summary.md',
    )
    expect(report.evidenceTemplate.prohibitedContent).toContain(
      'personal email addresses',
    )
    expect(report.limitations).toContain(
      'The default packet is for local synthetic evidence; production account lifecycle execution remains operator-gated.',
    )
  })

  it('fails strict mode when required dogfood flows are missing', async () => {
    await expect(
      execFileAsync('node', [
        packetScript,
        '--strict',
        '--environment',
        'local',
        '--server-url',
        'https://localhost:8791',
        '--source-commit',
        '1234567890ab',
        '--run-id',
        '20260710T072500Z',
        '--flow',
        'bootstrap_user_a',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('dogfood evidence packet is not ready'),
    })
  })

  it('redacts credentials and query strings from server URLs', async () => {
    const result = await execFileAsync('node', [
      packetScript,
      '--environment',
      'staging',
      '--server-url',
      'https://user:secret@example.test/path?token=leak',
      '--source-commit',
      '1234567890ab',
      '--run-id',
      '20260710T072500Z',
      ...completeFlows.flatMap((flow) => ['--flow', flow]),
    ])
    const report = JSON.parse(result.stdout) as DogfoodEvidencePacket

    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'environment_recorded')).toBe('fail')
    expect(result.stdout).not.toContain('secret')
    expect(result.stdout).not.toContain('token=leak')
    expect(report.environment.serverUrl).toBe('https://example.test/path')
  })

  it('rejects real-data markers and unsafe evidence paths', async () => {
    const result = await execFileAsync('node', [
      packetScript,
      '--environment',
      'local',
      '--server-url',
      'https://localhost:8791',
      '--source-commit',
      '1234567890ab',
      '--run-id',
      '20260710T072500Z',
      '--evidence-dir',
      '../outside',
      '--allow-real-data',
      ...completeFlows.flatMap((flow) => ['--flow', flow]),
    ])
    const report = JSON.parse(result.stdout) as DogfoodEvidencePacket

    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'evidence_dir_safe')).toBe('fail')
    expect(statusById(report, 'synthetic_data_only')).toBe('fail')
  })
})

function statusById(
  report: DogfoodEvidencePacket,
  id: string,
): string | undefined {
  return report.requirements.find((requirement) => requirement.id === id)
    ?.status
}
