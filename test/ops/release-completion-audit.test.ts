import { execFile } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const completionAuditScript = join(
  repoRoot,
  'scripts/honowarden-alpha-completion-audit.mjs',
)

type CompletionAuditReport = {
  schemaVersion: number
  completion: 'complete' | 'incomplete'
  blockingReason: string | null
  targetTag: string
  targetVersion: string
  targetCommit: string
  releaseGate: {
    status: 'ready' | 'not_ready'
    failedChecks: string[]
  }
  releaseStatus: {
    status: 'ready' | 'not_ready'
    phase:
      | 'draft_ready_for_publication'
      | 'published_verified'
      | 'published_not_verified'
      | 'not_ready_for_publication'
    approvalText: string | null
    commands: {
      publishRelease: string | null
      verifyPublished: string
      viewRelease: string
    } | null
  }
  requirements: Array<{
    id: string
    status: 'pass' | 'fail'
    evidence: string[]
  }>
  limitations: string[]
}

describe('alpha completion audit', () => {
  it('reports incomplete when the draft is ready but publication approval is still required', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeReleaseBin({
      isDraft: true,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })

    const result = await execFileAsync(
      'node',
      [
        completionAuditScript,
        '--tag-workflow-run-id',
        '54321',
        '--tag-workflow-url',
        tagWorkflowUrl,
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as CompletionAuditReport

    expect(report.schemaVersion).toBe(1)
    expect(report.completion).toBe('incomplete')
    expect(report.blockingReason).toBe('release_publication_approval_required')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.targetCommit).toBe(targetCommit)
    expect(report.releaseGate).toMatchObject({
      status: 'ready',
      failedChecks: [],
    })
    expect(report.releaseStatus).toMatchObject({
      status: 'ready',
      phase: 'draft_ready_for_publication',
      approvalText: `${targetCommit} の v0.1.0-alpha draft prerelease を公開してよい`,
    })
    expect(report.releaseStatus.commands?.publishRelease).toBe(
      'gh release edit v0.1.0-alpha --draft=false --prerelease --verify-tag --repo kazu-42/HonoWarden',
    )
    expect(statusById(report, 'published_prerelease_verified')).toBe('fail')
    expect(report.limitations).toContain(
      'Strict mode only succeeds after published prerelease verification passes.',
    )
  })

  it('fails strict mode while publication approval is still required', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeReleaseBin({
      isDraft: true,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })

    await expect(
      execFileAsync(
        'node',
        [
          completionAuditScript,
          '--strict',
          '--tag-workflow-run-id',
          '54321',
          '--tag-workflow-url',
          tagWorkflowUrl,
        ],
        {
          env: fakeEnv(fakeBin),
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'alpha completion audit is incomplete: release_publication_approval_required',
      ),
      stdout: expect.stringContaining('"completion": "incomplete"'),
    })
  })

  it('reports complete after published prerelease verification passes', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeReleaseBin({
      isDraft: false,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })

    const result = await execFileAsync(
      'node',
      [
        completionAuditScript,
        '--strict',
        '--expected-commit',
        targetCommit,
        '--tag-workflow-run-id',
        '54321',
        '--tag-workflow-url',
        tagWorkflowUrl,
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as CompletionAuditReport

    expect(report.completion).toBe('complete')
    expect(report.blockingReason).toBeNull()
    expect(report.releaseStatus.phase).toBe('published_verified')
    expect(statusById(report, 'published_prerelease_verified')).toBe('pass')
    expect(report.releaseStatus.commands?.publishRelease).toBeNull()
  })

  it('reports incomplete when a visible release fails post-publication verification', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeReleaseBin({
      isDraft: false,
      isPrerelease: false,
      targetCommit,
      tagWorkflowUrl,
    })

    const result = await execFileAsync(
      'node',
      [
        completionAuditScript,
        '--expected-commit',
        targetCommit,
        '--tag-workflow-run-id',
        '54321',
        '--tag-workflow-url',
        tagWorkflowUrl,
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as CompletionAuditReport

    expect(report.completion).toBe('incomplete')
    expect(report.blockingReason).toBe('post_publication_verification_failed')
    expect(report.releaseStatus.phase).toBe('published_not_verified')
    expect(statusById(report, 'release_status_ready')).toBe('fail')
  })
})

function statusById(report: CompletionAuditReport, id: string) {
  return report.requirements.find((requirement) => requirement.id === id)
    ?.status
}

async function createFakeReleaseBin(options: {
  headCommit?: string
  isDraft: boolean
  isPrerelease: boolean
  targetCommit: string
  tagWorkflowUrl: string
}) {
  const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-completion-bin-'))

  await writeFile(
    join(fakeBin, 'git'),
    `#!/usr/bin/env node
const args = process.argv.slice(2)
const command = args.join('\\u0000')
const targetCommit = process.env.HONOWARDEN_TEST_TARGET_COMMIT

if (command === 'rev-parse\\u0000HEAD') {
  process.stdout.write(process.env.HONOWARDEN_TEST_HEAD_COMMIT + '\\n')
  process.exit(0)
}

if (command === 'rev-parse\\u0000-q\\u0000--verify\\u0000refs/tags/v0.1.0-alpha') {
  process.stdout.write('feedfeedfeedfeedfeedfeedfeedfeedfeedfeed\\n')
  process.exit(0)
}

if (command === 'rev-list\\u0000-n\\u00001\\u0000v0.1.0-alpha') {
  process.stdout.write(targetCommit + '\\n')
  process.exit(0)
}

if (args[0] === 'ls-remote' && args[1] === '--tags' && args[3] === 'v0.1.0-alpha') {
  process.stdout.write('feedfeedfeedfeedfeedfeedfeedfeedfeedfeed\\trefs/tags/v0.1.0-alpha\\n')
  if (args[4] !== 'v0.1.0-alpha^{}') {
    process.exit(0)
  }
  process.stdout.write(targetCommit + '\\trefs/tags/v0.1.0-alpha^{}\\n')
  process.exit(0)
}

process.stderr.write('unexpected fake git command: ' + command + '\\n')
process.exit(1)
`,
  )
  await writeFile(
    join(fakeBin, 'gh'),
    `#!/usr/bin/env node
const args = process.argv.slice(2)

if (args[0] === 'run' && args[1] === 'view') {
  const runId = args.find((arg) => /^\\d+$/.test(arg)) ?? '0'
  process.stdout.write(JSON.stringify({
    databaseId: Number(runId),
    workflowName: 'Release Tag Verification',
    event: 'push',
    headSha: process.env.HONOWARDEN_TEST_TARGET_COMMIT,
    status: 'completed',
    conclusion: 'success',
    url: process.env.HONOWARDEN_TEST_TAG_WORKFLOW_URL
  }))
  process.exit(0)
}

if (args[0] === 'release' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    tagName: 'v0.1.0-alpha',
    name: 'v0.1.0-alpha',
    isDraft: process.env.HONOWARDEN_TEST_RELEASE_DRAFT === '1',
    isPrerelease: process.env.HONOWARDEN_TEST_RELEASE_PRERELEASE === '1',
    targetCommitish: process.env.HONOWARDEN_TEST_TARGET_COMMIT,
    url: 'https://example.invalid/releases/v0.1.0-alpha',
    body: [
      '# v0.1.0-alpha Release Notes',
      'HonoWarden is pre-alpha',
      '## Scope',
      '## Not Included',
      '## Compatibility',
      '## Operations',
      '## Known Risks',
      '## Release Gate'
    ].join('\\n\\n')
  }))
  process.exit(0)
}

process.stderr.write('unexpected fake gh command: ' + args.join(' ') + '\\n')
process.exit(1)
`,
  )
  await chmod(join(fakeBin, 'git'), 0o755)
  await chmod(join(fakeBin, 'gh'), 0o755)

  return {
    path: fakeBin,
    headCommit: options.headCommit ?? options.targetCommit,
    ...options,
  }
}

function fakeEnv(fakeBin: {
  headCommit: string
  isDraft: boolean
  isPrerelease: boolean
  path: string
  targetCommit: string
  tagWorkflowUrl: string
}) {
  return {
    ...process.env,
    HONOWARDEN_TEST_HEAD_COMMIT: fakeBin.headCommit,
    HONOWARDEN_TEST_RELEASE_DRAFT: fakeBin.isDraft ? '1' : '0',
    HONOWARDEN_TEST_RELEASE_PRERELEASE: fakeBin.isPrerelease ? '1' : '0',
    HONOWARDEN_TEST_TAG_WORKFLOW_URL: fakeBin.tagWorkflowUrl,
    HONOWARDEN_TEST_TARGET_COMMIT: fakeBin.targetCommit,
    PATH: `${fakeBin.path}${delimiter}${process.env.PATH ?? ''}`,
  }
}
