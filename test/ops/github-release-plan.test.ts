import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { writePreTagGit } from '../support/release-git'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const releasePlanScript = join(
  repoRoot,
  'scripts/honowarden-github-release-plan.mjs',
)

type GithubReleasePlanReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  targetTag: string
  targetVersion: string
  targetCommit: string
  notesFile: string
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  commands: {
    createDraft: string
    viewRelease: string
  }
  limitations: string[]
}

describe('github release plan', () => {
  it('reports a draft release command without creating a release', async () => {
    const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-release-plan-'))
    const headSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    ).stdout.trim()
    await writePreTagGit(fakeBin)

    const result = await execFileAsync(
      'node',
      [
        releasePlanScript,
        '--allow-missing-tag',
        '--allow-missing-remote-tag',
        '--check-remote',
      ],
      {
        env: {
          ...process.env,
          HONOWARDEN_TEST_HEAD_SHA: headSha,
          PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    )
    const report = JSON.parse(result.stdout) as GithubReleasePlanReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.targetCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(report.notesFile).toBe('docs/release/v0.1.0-alpha-release-notes.md')
    expect(statusById(report, 'package_version')).toBe('pass')
    expect(statusById(report, 'release_notes')).toBe('pass')
    expect(statusById(report, 'local_tag_context')).toBe('pass')
    expect(statusById(report, 'remote_tag_context')).toBe('pass')
    expect(report.commands.createDraft).toContain(
      'gh release create v0.1.0-alpha',
    )
    expect(report.commands.createDraft).toContain('--draft')
    expect(report.commands.createDraft).toContain('--prerelease')
    expect(report.commands.createDraft).toContain('--verify-tag')
    expect(report.commands.createDraft).toContain(
      '--notes-file docs/release/v0.1.0-alpha-release-notes.md',
    )
    expect(report.commands.createDraft).toContain(
      `--target ${report.targetCommit}`,
    )
    expect(report.commands.viewRelease).toBe('gh release view v0.1.0-alpha')
    expect(report.limitations).toContain(
      'This plan does not create, update, publish, or delete a GitHub release.',
    )
  })

  it('fails strict mode when the expected package version is not present', async () => {
    await expect(
      execFileAsync('node', [
        releasePlanScript,
        '--allow-missing-tag',
        '--expected-version',
        '9.9.9-test',
        '--strict',
      ]),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"status": "not_ready"'),
    })
  })
})

function statusById(report: GithubReleasePlanReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
