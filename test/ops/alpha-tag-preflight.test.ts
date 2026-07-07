import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const preflightScript = join(
  repoRoot,
  'scripts/honowarden-alpha-tag-preflight.mjs',
)

type AlphaTagPreflightReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  targetTag: string
  targetVersion: string
  sourceCommit: string
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  commands: {
    createTag: string
    pushTag: string
  }
  limitations: string[]
}

describe('alpha tag preflight', () => {
  it('reports repository-local tag readiness without creating a tag', async () => {
    const result = await execFileAsync('node', [
      preflightScript,
      '--allow-dirty',
      '--allow-existing-tag',
    ])
    const report = JSON.parse(result.stdout) as AlphaTagPreflightReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.sourceCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(statusById(report, 'package_version')).toBe('pass')
    expect(statusById(report, 'release_gate')).toBe('pass')
    expect(statusById(report, 'working_tree')).toBe('pass')
    expect(statusById(report, 'local_tag_absent')).toBe('pass')
    expect(report.commands.createTag).toContain('v0.1.0-alpha')
    expect(report.commands.createTag).toContain(report.sourceCommit)
    expect(report.commands.pushTag).toBe('git push origin v0.1.0-alpha')
    expect(report.limitations).toContain(
      'This preflight does not create or push a Git tag.',
    )
  })

  it('fails strict mode when the expected package version is not present', async () => {
    await expect(
      execFileAsync('node', [
        preflightScript,
        '--allow-dirty',
        '--allow-existing-tag',
        '--expected-version',
        '9.9.9-test',
        '--strict',
      ]),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"status": "not_ready"'),
    })
  })

  it('accepts a package-manager argument separator', async () => {
    const result = await execFileAsync('node', [
      preflightScript,
      '--',
      '--allow-dirty',
      '--allow-existing-tag',
    ])
    const report = JSON.parse(result.stdout) as AlphaTagPreflightReport

    expect(report.status).toBe('ready')
  })

  it('can verify remote tag absence through a read-only remote check', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-remote-tag-'))
    await execFileAsync('git', ['init', '--bare', remote])

    const result = await execFileAsync('node', [
      preflightScript,
      '--allow-dirty',
      '--allow-existing-tag',
      '--check-remote',
      '--remote',
      remote,
    ])
    const report = JSON.parse(result.stdout) as AlphaTagPreflightReport

    expect(report.status).toBe('ready')
    expect(statusById(report, 'remote_tag_absent')).toBe('pass')
    expect(report.commands.pushTag).toBe(`git push ${remote} v0.1.0-alpha`)
    expect(report.limitations).toContain(
      'GitHub release publication is not verified.',
    )
    expect(report.limitations).not.toContain(
      'Remote tag absence and GitHub release publication are not verified.',
    )
  })

  it('fails strict mode when the remote tag already exists', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-remote-tag-'))
    await execFileAsync('git', ['init', remote])
    await execFileAsync('git', [
      '-C',
      remote,
      'config',
      'user.email',
      'ci@example.invalid',
    ])
    await execFileAsync('git', ['-C', remote, 'config', 'user.name', 'CI'])
    await execFileAsync('git', [
      '-C',
      remote,
      'commit',
      '--allow-empty',
      '-m',
      'init',
    ])
    await execFileAsync('git', ['-C', remote, 'tag', 'v0.1.0-alpha'])

    await expect(
      execFileAsync('node', [
        preflightScript,
        '--allow-dirty',
        '--allow-existing-tag',
        '--check-remote',
        '--remote',
        remote,
        '--strict',
      ]),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"id": "remote_tag_absent"'),
    })
  })
})

function statusById(report: AlphaTagPreflightReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
