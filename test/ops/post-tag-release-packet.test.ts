import { execFile } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const postTagPacketScript = join(
  repoRoot,
  'scripts/honowarden-post-tag-release-packet.mjs',
)

type PostTagReleasePacketReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  targetTag: string
  targetVersion: string
  targetCommit: string
  tagWorkflow: {
    runId: string | null
    url: string | null
    missingAllowed: boolean
    verifiedRun: {
      databaseId: number | null
      workflowName: string | null
      event: string | null
      headSha: string | null
      status: string | null
      conclusion: string | null
      url: string | null
    } | null
  }
  existingRelease: {
    tagName: string | null
    isDraft: boolean | null
    isPrerelease: boolean | null
    targetCommitish: string | null
    url: string | null
  } | null
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  commands: {
    createDraft: string
    viewRelease: string
  }
  draftApprovalText: string | null
  limitations: string[]
}

describe('post-tag release packet', () => {
  it('verifies pushed tag and tag workflow evidence without creating a release', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeReleaseBin({
      targetCommit,
      tagWorkflowUrl,
    })

    const result = await execFileAsync(
      'node',
      [
        postTagPacketScript,
        '--remote',
        'origin',
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
    const report = JSON.parse(result.stdout) as PostTagReleasePacketReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.targetCommit).toBe(targetCommit)
    expect(statusById(report, 'local_tag_context')).toBe('pass')
    expect(statusById(report, 'remote_tag_context')).toBe('pass')
    expect(statusById(report, 'tag_workflow_ci')).toBe('pass')
    expect(statusById(report, 'github_release_plan_ready')).toBe('pass')
    expect(statusById(report, 'release_state')).toBe('pass')
    expect(report.tagWorkflow.verifiedRun).toMatchObject({
      databaseId: 54321,
      workflowName: 'Release Tag Verification',
      event: 'push',
      headSha: targetCommit,
      status: 'completed',
      conclusion: 'success',
      url: tagWorkflowUrl,
    })
    expect(report.existingRelease).toBeNull()
    expect(report.commands.createDraft).toContain(
      'gh release create v0.1.0-alpha',
    )
    expect(report.commands.createDraft).toContain(`--target ${targetCommit}`)
    expect(report.commands.viewRelease).toBe('gh release view v0.1.0-alpha')
    expect(report.draftApprovalText).toBe(
      `${targetCommit} の v0.1.0-alpha tag verification が成功したので GitHub release draft を作成してよい`,
    )
    expect(report.limitations).toContain(
      'This packet does not create, update, publish, or delete a GitHub release.',
    )
  })

  it('fails strict mode without tag workflow evidence', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakeReleaseBin({
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })

    await expect(
      execFileAsync(
        'node',
        [
          postTagPacketScript,
          '--remote',
          'origin',
          '--expected-commit',
          targetCommit,
          '--strict',
        ],
        {
          env: fakeEnv(fakeBin),
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"id": "tag_workflow_ci"'),
    })
  })

  it('does not emit draft approval text when required evidence is explicitly allowed missing', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakeReleaseBin({
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })

    const result = await execFileAsync(
      'node',
      [
        postTagPacketScript,
        '--remote',
        'origin',
        '--expected-commit',
        targetCommit,
        '--allow-missing-tag-workflow',
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as PostTagReleasePacketReport

    expect(report.status).toBe('ready')
    expect(statusById(report, 'tag_workflow_ci')).toBe('pass')
    expect(report.draftApprovalText).toBeNull()
  })

  it('blocks when the remote tag points at a different commit', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakeReleaseBin({
      remoteCommit: 'abcdef1234567890abcdef1234567890abcdef12',
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })

    const result = await execFileAsync(
      'node',
      [
        postTagPacketScript,
        '--remote',
        'origin',
        '--expected-commit',
        targetCommit,
        '--tag-workflow-run-id',
        '54321',
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as PostTagReleasePacketReport

    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'remote_tag_context')).toBe('fail')
  })
})

async function createFakeReleaseBin(options: {
  remoteCommit?: string
  targetCommit: string
  tagWorkflowUrl: string
}) {
  const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-post-tag-bin-'))
  const remoteCommit = options.remoteCommit ?? options.targetCommit

  await writeFile(
    join(fakeBin, 'git'),
    `#!/usr/bin/env node
const args = process.argv.slice(2)
const command = args.join('\\u0000')
const targetCommit = process.env.HONOWARDEN_TEST_TARGET_COMMIT
const remoteCommit = process.env.HONOWARDEN_TEST_REMOTE_COMMIT

if (command === 'rev-parse\\u0000HEAD') {
  process.stdout.write(targetCommit + '\\n')
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
  process.stdout.write(remoteCommit + '\\trefs/tags/v0.1.0-alpha^{}\\n')
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
  process.stderr.write('release not found\\n')
  process.exit(1)
}

process.stderr.write('unexpected fake gh command: ' + args.join(' ') + '\\n')
process.exit(1)
`,
  )
  await chmod(join(fakeBin, 'git'), 0o755)
  await chmod(join(fakeBin, 'gh'), 0o755)

  return {
    path: fakeBin,
    remoteCommit,
    tagWorkflowUrl: options.tagWorkflowUrl,
    targetCommit: options.targetCommit,
  }
}

function fakeEnv(fakeBin: {
  path: string
  remoteCommit: string
  tagWorkflowUrl: string
  targetCommit: string
}) {
  return {
    ...process.env,
    HONOWARDEN_TEST_REMOTE_COMMIT: fakeBin.remoteCommit,
    HONOWARDEN_TEST_TAG_WORKFLOW_URL: fakeBin.tagWorkflowUrl,
    HONOWARDEN_TEST_TARGET_COMMIT: fakeBin.targetCommit,
    PATH: `${fakeBin.path}${delimiter}${process.env.PATH ?? ''}`,
  }
}

function statusById(report: PostTagReleasePacketReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
