import { execFile } from 'node:child_process'
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
})

function statusById(report: AlphaTagPreflightReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
