import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const evidenceBundleScript = join(
  repoRoot,
  'scripts/honowarden-release-evidence-bundle.mjs',
)

type ReleaseEvidenceBundleReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  phase: 'pre_tag'
  targetTag: string
  targetVersion: string
  targetCommit: string
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  evidence: {
    approvalPacket: {
      status: 'ready' | 'not_ready'
      approvalText: string
    }
    brandScan: {
      status: 'pass' | 'fail'
      matches: string[]
    }
    postTagPreview: {
      status: 'ready' | 'not_ready'
      draftApprovalText: string | null
    }
  }
  commands: {
    createTag: string
    pushTag: string
    createDraftAfterTagVerification: string
    viewRelease: string
  }
  approvalText: string | null
  limitations: string[]
}

describe('release evidence bundle', () => {
  it('bundles pre-tag release evidence without mutating external systems', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-bundle-remote-'))
    const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-bundle-gh-'))
    const ciUrl = 'https://example.invalid/actions/runs/12345'
    const headSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    ).stdout.trim()
    await execFileAsync('git', ['init', '--bare', remote])
    await writeFakeGh(fakeBin)

    const result = await execFileAsync(
      'node',
      [
        evidenceBundleScript,
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
    const report = JSON.parse(result.stdout) as ReleaseEvidenceBundleReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.phase).toBe('pre_tag')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.targetCommit).toBe(headSha)
    expect(statusById(report, 'release_gate_ready')).toBe('pass')
    expect(statusById(report, 'tag_preflight_ready')).toBe('pass')
    expect(statusById(report, 'approval_packet_ready')).toBe('pass')
    expect(statusById(report, 'post_tag_preview_ready')).toBe('pass')
    expect(statusById(report, 'brand_scan_clean')).toBe('pass')
    expect(statusById(report, 'commit_alignment')).toBe('pass')
    expect(report.evidence.approvalPacket.status).toBe('ready')
    expect(report.evidence.postTagPreview.status).toBe('ready')
    expect(report.evidence.postTagPreview.draftApprovalText).toBeNull()
    expect(report.evidence.brandScan).toMatchObject({
      status: 'pass',
      matches: [],
    })
    expect(report.commands.createTag).toContain('git tag -a v0.1.0-alpha')
    expect(report.commands.pushTag).toBe(`git push ${remote} v0.1.0-alpha`)
    expect(report.commands.createDraftAfterTagVerification).toContain(
      'gh release create v0.1.0-alpha',
    )
    expect(report.approvalText).toBe(
      `${headSha} に v0.1.0-alpha を作成して push してよい`,
    )
    expect(report.limitations).toContain(
      'This bundle does not create, move, delete, or push a Git tag.',
    )
  })

  it('writes the bundle to an explicit output path', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-bundle-remote-'))
    const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-bundle-gh-'))
    const outputDir = await mkdtemp(join(tmpdir(), 'honowarden-bundle-output-'))
    const outputPath = join(outputDir, 'bundle.json')
    const ciUrl = 'https://example.invalid/actions/runs/12345'
    const headSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    ).stdout.trim()
    await execFileAsync('git', ['init', '--bare', remote])
    await writeFakeGh(fakeBin)

    const result = await execFileAsync(
      'node',
      [
        evidenceBundleScript,
        '--remote',
        remote,
        '--allow-dirty',
        '--ci-run-id',
        '12345',
        '--ci-url',
        ciUrl,
        '--output',
        outputPath,
      ],
      {
        env: fakeEnv(fakeBin, { ciUrl, headSha }),
      },
    )
    const stdoutReport = JSON.parse(
      result.stdout,
    ) as ReleaseEvidenceBundleReport
    const fileReport = JSON.parse(
      await readFile(outputPath, 'utf8'),
    ) as ReleaseEvidenceBundleReport

    expect(fileReport.status).toBe('ready')
    expect(fileReport.targetCommit).toBe(stdoutReport.targetCommit)
    expect(fileReport.approvalText).toBe(stdoutReport.approvalText)
  })

  it('fails strict mode without CI evidence', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'honowarden-bundle-remote-'))
    const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-bundle-gh-'))
    const headSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    ).stdout.trim()
    await execFileAsync('git', ['init', '--bare', remote])
    await writeFakeGh(fakeBin)

    await expect(
      execFileAsync(
        'node',
        [evidenceBundleScript, '--remote', remote, '--allow-dirty', '--strict'],
        {
          env: fakeEnv(fakeBin, {
            ciUrl: 'https://example.invalid/actions/runs/12345',
            headSha,
          }),
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"id": "approval_packet_ready"'),
    })
  })
})

async function writeFakeGh(fakeBin: string) {
  await writeFile(
    join(fakeBin, 'gh'),
    `#!/usr/bin/env node
const args = process.argv.slice(2)

if (args[0] === 'run' && args[1] === 'view') {
  const runId = args.find((arg) => /^\\d+$/.test(arg)) ?? '0'
  process.stdout.write(JSON.stringify({
    databaseId: Number(runId),
    workflowName: 'CI',
    headSha: process.env.HONOWARDEN_TEST_HEAD_SHA,
    status: 'completed',
    conclusion: 'success',
    url: process.env.HONOWARDEN_TEST_CI_URL
  }))
  process.exit(0)
}

if (args[0] === 'release' && args[1] === 'view') {
  process.stderr.write('release not found\\n')
  process.exit(1)
}

process.stderr.write('unexpected fake gh command: ' + args.join(' ') + '\\n')
process.exit(1)
`,
  )
  await chmod(join(fakeBin, 'gh'), 0o755)
}

function fakeEnv(fakeBin: string, options: { ciUrl: string; headSha: string }) {
  return {
    ...process.env,
    HONOWARDEN_TEST_CI_URL: options.ciUrl,
    HONOWARDEN_TEST_HEAD_SHA: options.headSha,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
  }
}

function statusById(report: ReleaseEvidenceBundleReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
