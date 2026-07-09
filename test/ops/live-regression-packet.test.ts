import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const packetScript = join(
  repoRoot,
  'scripts/honowarden-live-regression-packet.mjs',
)

type LiveRegressionPacket = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  blockingReason: string | null
  targetVerificationLevel: 'live_regression'
  matrix: {
    surface: string
    currentVerificationLevel: string | null
    currentVersion: string | null
  }
  client: {
    surface: string
    version: string | null
    build: string | null
  }
  environment: {
    kind: string
    serverUrl: string | null
    sourceCommit: string | null
    runId: string
    evidenceDir: string
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
    requestLogPath: string
    prohibitedContent: string[]
  }
  limitations: string[]
}

const completeFlows = [
  'config',
  'prelogin',
  'password_grant',
  'initial_sync',
  'post_mutation_sync',
  'cipher_create',
  'cipher_update',
  'cipher_soft_delete',
  'cipher_permanent_delete',
  'refresh_grant',
  'session_revoke',
  'device_revoke',
]

describe('live regression packet', () => {
  it('records a ready synthetic CLI regression packet', async () => {
    const result = await execFileAsync('node', [
      packetScript,
      '--surface',
      'cli',
      '--environment',
      'local',
      '--server-url',
      'https://localhost:8791',
      '--source-commit',
      '1234567890ab',
      '--run-id',
      '20260709T220000Z',
      '--generated-at',
      '2026-07-09T22:00:00Z',
      ...completeFlows.flatMap((flow) => ['--flow', flow]),
    ])
    const report = JSON.parse(result.stdout) as LiveRegressionPacket

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.targetVerificationLevel).toBe('live_regression')
    expect(report.matrix).toMatchObject({
      surface: 'cli',
      currentVerificationLevel: 'live_smoke',
      currentVersion: '2026.6.0',
    })
    expect(report.client).toMatchObject({
      surface: 'cli',
      version: '2026.6.0',
      build: null,
    })
    expect(report.environment).toMatchObject({
      kind: 'local',
      serverUrl: 'https://localhost:8791',
      sourceCommit: '1234567890ab',
      runId: '20260709T220000Z',
      evidenceDir: 'docs/release/live-regression-evidence/cli/20260709T220000Z',
    })
    expect(
      report.flowCoverage.groups.every((group) => group.status === 'pass'),
    ).toBe(true)
    expect(statusById(report, 'synthetic_data_only')).toBe('pass')
    expect(report.evidenceTemplate.summaryPath).toBe(
      'docs/release/live-regression-evidence/cli/20260709T220000Z/summary.md',
    )
    expect(report.evidenceTemplate.prohibitedContent).toContain('passwords')
    expect(report.limitations).toContain(
      'This packet generator does not run a live client binary.',
    )
  })

  it('fails strict mode when required regression flows are missing', async () => {
    await expect(
      execFileAsync('node', [
        packetScript,
        '--strict',
        '--surface',
        'cli',
        '--environment',
        'local',
        '--server-url',
        'https://localhost:8791',
        '--source-commit',
        '1234567890ab',
        '--run-id',
        '20260709T220000Z',
        '--flow',
        'config',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('live regression packet is not ready'),
    })
  })

  it('redacts credentials and query strings from server URLs', async () => {
    const result = await execFileAsync('node', [
      packetScript,
      '--surface',
      'cli',
      '--environment',
      'staging',
      '--server-url',
      'https://user:secret@example.test/path?token=leak',
      '--source-commit',
      '1234567890ab',
      '--run-id',
      '20260709T220000Z',
      ...completeFlows.flatMap((flow) => ['--flow', flow]),
    ])
    const report = JSON.parse(result.stdout) as LiveRegressionPacket

    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'environment_recorded')).toBe('fail')
    expect(result.stdout).not.toContain('secret')
    expect(result.stdout).not.toContain('token=leak')
    expect(report.environment.serverUrl).toBe('https://example.test/path')
  })

  it('keeps evidence paths under release live-regression evidence', async () => {
    const result = await execFileAsync('node', [
      packetScript,
      '--surface',
      'cli',
      '--environment',
      'local',
      '--server-url',
      'https://localhost:8791',
      '--source-commit',
      '1234567890ab',
      '--run-id',
      '20260709T220000Z',
      '--evidence-dir',
      '../outside',
      ...completeFlows.flatMap((flow) => ['--flow', flow]),
    ])
    const report = JSON.parse(result.stdout) as LiveRegressionPacket

    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'evidence_dir_safe')).toBe('fail')
  })
})

function statusById(
  report: LiveRegressionPacket,
  id: string,
): string | undefined {
  return report.requirements.find((requirement) => requirement.id === id)
    ?.status
}
