import { execFile } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { writePreTagGit } from '../support/release-git'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const approvalPacketScript = join(
  repoRoot,
  'scripts/honowarden-release-approval-packet.mjs',
)

type ReleaseApprovalPacketReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  targetTag: string
  targetVersion: string
  targetCommit: string
  ci: {
    runId: string | null
    url: string | null
    missingAllowed: boolean
    verifiedRun: {
      databaseId: number | null
      workflowName: string | null
      headSha: string | null
      status: string | null
      conclusion: string | null
      url: string | null
    } | null
  }
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  commands: {
    createTag: string
    pushTag: string
    createDraft: string
    viewRelease: string
  }
  approvalText: string
  limitations: string[]
}

describe('release approval packet', () => {
  it('summarizes tag approval evidence without mutating external systems', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-approval-remote-'))
    const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-approval-bin-'))
    const headSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    ).stdout.trim()
    await execFileAsync('git', ['init', '--bare', remote])
    await writePreTagGit(fakeBin)

    const result = await execFileAsync(
      'node',
      [
        approvalPacketScript,
        '--remote',
        remote,
        '--allow-dirty',
        '--allow-missing-ci',
      ],
      {
        env: fakeEnv(fakeBin, { headSha }),
      },
    )
    const report = JSON.parse(result.stdout) as ReleaseApprovalPacketReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.targetCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(statusById(report, 'release_gate_ready')).toBe('pass')
    expect(statusById(report, 'tag_preflight_ready')).toBe('pass')
    expect(statusById(report, 'github_release_plan_ready')).toBe('pass')
    expect(statusById(report, 'ci_evidence')).toBe('pass')
    expect(statusById(report, 'commit_alignment')).toBe('pass')
    expect(report.commands.createTag).toContain('git tag -a v0.1.0-alpha')
    expect(report.commands.pushTag).toBe(`git push ${remote} v0.1.0-alpha`)
    expect(report.commands.createDraft).toContain(
      'gh release create v0.1.0-alpha',
    )
    expect(report.commands.createDraft).toContain('--repo kazu-42/HonoWarden')
    expect(report.ci.verifiedRun).toBeNull()
    expect(report.approvalText).toBe(
      `${report.targetCommit} に v0.1.0-alpha を作成して push してよい`,
    )
    expect(report.limitations).toContain(
      'This packet does not create or push a Git tag.',
    )
    expect(report.limitations).toContain(
      'This packet does not create, update, publish, or delete a GitHub release.',
    )
  })

  it('verifies CI run evidence against the target commit', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-approval-remote-'))
    const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-fake-gh-'))
    const ciUrl = 'https://example.invalid/actions/runs/12345'
    const headSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    ).stdout.trim()
    await execFileAsync('git', ['init', '--bare', remote])
    await writePreTagGit(fakeBin)
    await writeFile(
      join(fakeBin, 'gh'),
      `#!/usr/bin/env node
const runId = process.argv.find((arg) => /^\\d+$/.test(arg)) ?? '0'
process.stdout.write(JSON.stringify({
  databaseId: Number(runId),
  workflowName: 'CI',
  headSha: process.env.HONOWARDEN_TEST_HEAD_SHA,
  status: 'completed',
  conclusion: 'success',
  url: process.env.HONOWARDEN_TEST_CI_URL
}))
`,
    )
    await chmod(join(fakeBin, 'gh'), 0o755)

    const result = await execFileAsync(
      'node',
      [
        approvalPacketScript,
        '--remote',
        remote,
        '--allow-dirty',
        '--ci-run-id',
        '12345',
        '--ci-url',
        ciUrl,
      ],
      {
        env: fakeEnv(fakeBin, { ciUrl, headSha }),
      },
    )
    const report = JSON.parse(result.stdout) as ReleaseApprovalPacketReport

    expect(report.status).toBe('ready')
    expect(statusById(report, 'ci_evidence')).toBe('pass')
    expect(report.ci.verifiedRun).toMatchObject({
      databaseId: 12345,
      workflowName: 'CI',
      headSha,
      status: 'completed',
      conclusion: 'success',
      url: ciUrl,
    })
  })

  it('fails strict mode without CI evidence', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-approval-remote-'))
    const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-approval-bin-'))
    const headSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    ).stdout.trim()
    await execFileAsync('git', ['init', '--bare', remote])
    await writePreTagGit(fakeBin)

    await expect(
      execFileAsync(
        'node',
        [approvalPacketScript, '--remote', remote, '--allow-dirty', '--strict'],
        {
          env: fakeEnv(fakeBin, { headSha }),
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"id": "ci_evidence"'),
    })
  })
})

function fakeEnv(
  fakeBin: string,
  options: { ciUrl?: string; headSha: string },
) {
  return {
    ...process.env,
    ...(options.ciUrl ? { HONOWARDEN_TEST_CI_URL: options.ciUrl } : {}),
    HONOWARDEN_TEST_HEAD_SHA: options.headSha,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
  }
}

function statusById(report: ReleaseApprovalPacketReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
