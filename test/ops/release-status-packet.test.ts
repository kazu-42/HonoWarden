import { execFile } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const statusPacketScript = join(
  repoRoot,
  'scripts/honowarden-release-status-packet.mjs',
)

type ReleaseStatusPacketReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  phase:
    | 'draft_ready_for_publication'
    | 'published_verified'
    | 'published_not_verified'
    | 'not_ready_for_publication'
  targetTag: string
  targetVersion: string
  targetCommit: string
  existingRelease: {
    tagName: string | null
    isDraft: boolean | null
    isPrerelease: boolean | null
    targetCommitish: string | null
    url: string | null
  } | null
  packets: {
    publish: {
      status: 'ready' | 'not_ready'
      failedChecks: string[]
    }
    published: {
      status: 'ready' | 'not_ready'
      failedChecks: string[]
    }
  }
  nextAction: {
    id: string
    requiresExternalApproval: boolean
    failedChecks?: string[]
    postPublicationPendingChecks?: string[]
    verificationText?: string | null
  }
  approvalText: string | null
  commands: {
    publishRelease: string | null
    verifyPublished: string
    viewRelease: string
  }
  limitations: string[]
}

describe('release status packet', () => {
  it('summarizes a draft release that is ready for publication approval', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeStatusBin({
      headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      isDraft: true,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })

    const result = await execFileAsync(
      'node',
      [
        statusPacketScript,
        '--remote',
        'origin',
        '--tag-workflow-run-id',
        '54321',
        '--tag-workflow-url',
        tagWorkflowUrl,
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as ReleaseStatusPacketReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.phase).toBe('draft_ready_for_publication')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.targetCommit).toBe(targetCommit)
    expect(report.existingRelease).toMatchObject({
      tagName: 'v0.1.0-alpha',
      isDraft: true,
      isPrerelease: true,
      targetCommitish: targetCommit,
    })
    expect(report.packets.publish.status).toBe('ready')
    expect(report.packets.published.status).toBe('not_ready')
    expect(report.packets.published.failedChecks).toContain('release_state')
    expect(report.nextAction).toMatchObject({
      id: 'request_publication_approval',
      requiresExternalApproval: true,
      postPublicationPendingChecks: ['release_state'],
    })
    expect(report.approvalText).toBe(
      `${targetCommit} の v0.1.0-alpha draft prerelease を公開してよい`,
    )
    expect(report.commands.publishRelease).toBe(
      'gh release edit v0.1.0-alpha --draft=false --prerelease --verify-tag',
    )
    expect(report.commands.verifyPublished).toContain(
      'pnpm release:published:packet -- --strict',
    )
    expect(report.limitations).toContain(
      'This packet does not publish, update, or delete a GitHub release.',
    )
  })

  it('summarizes a published release that passed post-publication verification', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeStatusBin({
      isDraft: false,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })

    const result = await execFileAsync(
      'node',
      [
        statusPacketScript,
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
    const report = JSON.parse(result.stdout) as ReleaseStatusPacketReport

    expect(report.status).toBe('ready')
    expect(report.phase).toBe('published_verified')
    expect(report.packets.publish.status).toBe('not_ready')
    expect(report.packets.published.status).toBe('ready')
    expect(report.nextAction).toMatchObject({
      id: 'record_publication_and_prepare_deployment_gate',
      requiresExternalApproval: true,
      verificationText: `${targetCommit} の v0.1.0-alpha published prerelease verification が成功した`,
    })
    expect(report.approvalText).toBeNull()
    expect(report.commands.publishRelease).toBeNull()
  })

  it('reports not-ready when a published release fails post-publication verification', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakeStatusBin({
      isDraft: false,
      isPrerelease: false,
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })

    const result = await execFileAsync(
      'node',
      [
        statusPacketScript,
        '--expected-commit',
        targetCommit,
        '--tag-workflow-run-id',
        '54321',
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as ReleaseStatusPacketReport

    expect(report.status).toBe('not_ready')
    expect(report.phase).toBe('published_not_verified')
    expect(report.nextAction).toMatchObject({
      id: 'inspect_published_release_verification',
      requiresExternalApproval: false,
      failedChecks: ['release_state'],
    })
    expect(report.approvalText).toBeNull()
    expect(report.commands.publishRelease).toBeNull()
  })

  it('fails strict mode when publication evidence is missing', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakeStatusBin({
      isDraft: true,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })

    await expect(
      execFileAsync(
        'node',
        [statusPacketScript, '--expected-commit', targetCommit, '--strict'],
        {
          env: fakeEnv(fakeBin),
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"phase": "not_ready_for_publication"'),
    })
  })
})

async function createFakeStatusBin(options: {
  headCommit?: string
  isDraft: boolean
  isPrerelease: boolean
  targetCommit: string
  tagWorkflowUrl: string
}) {
  const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-status-bin-'))

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
