import { execFile } from 'node:child_process'
import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createReleaseFixture } from '../support/release-fixture'

import { releaseClockEnv } from '../support/release-clock'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const publishedPacketScript = join(
  repoRoot,
  'scripts/honowarden-release-published-packet.mjs',
)

type ReleasePublishedPacketReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  currentReleaseReady: boolean
  targetTag: string
  targetVersion: string
  targetCommit: string
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  existingRelease: {
    tagName: string | null
    isDraft: boolean | null
    isPrerelease: boolean | null
    targetCommitish: string | null
    url: string | null
  } | null
  commands: {
    viewRelease: string
  }
  publishedVerificationText: string | null
  limitations: string[]
}

describe('release published packet', () => {
  it('accepts a fresh complete current matrix in an isolated release fixture', async () => {
    const root = await createReleaseFixture()
    const matrixPath = join(root, 'compat/client-matrix.json')
    const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
    matrix.checkedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    await writeFile(matrixPath, JSON.stringify(matrix))

    const result = await execFileAsync('node', [
      join(root, 'scripts/honowarden-release-gate.mjs'),
      '--strict',
    ])
    const report = JSON.parse(result.stdout)
    expect(report.overall).toBe('ready')
    expect(report.historicalEvidenceStatus).toBe('consistent')
    expect(
      report.checks.find(
        (check: { id: string }) => check.id === 'current_client_matrix',
      ),
    ).toMatchObject({
      status: 'pass',
      details: { freshness: { status: 'fresh', releaseReady: true } },
    })
  })

  it('blocks historical verification when isolated archive bytes are corrupted', async () => {
    const root = await createReleaseFixture()
    await appendFile(
      join(root, 'docs/release/snapshots/v0.1.0-alpha/live-client-evidence.md'),
      '\nSynthetic archive corruption.\n',
    )
    const gate = JSON.parse(
      (
        await execFileAsync('node', [
          join(root, 'scripts/honowarden-release-gate.mjs'),
        ])
      ).stdout,
    )
    expect(gate.historicalEvidenceStatus).toBe('inconsistent')
    expect(gate.layers.publishedAlphaArchive.status).toBe('inconsistent')

    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakePublishedBin({
      isDraft: false,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })
    const args = [
      '--expected-commit',
      targetCommit,
      '--tag-workflow-run-id',
      '54321',
    ]
    const result = await execFileAsync(
      'node',
      [join(root, 'scripts/honowarden-release-published-packet.mjs'), ...args],
      { env: fakeEnv(fakeBin) },
    )
    const report = JSON.parse(result.stdout) as ReleasePublishedPacketReport
    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'release_gate_ready')).toBe('fail')
    expect(statusById(report, 'release_state')).toBe('pass')
    expect(statusById(report, 'tag_workflow_ci')).toBe('pass')
    expect(report.publishedVerificationText).toBeNull()
    const completion = JSON.parse(
      (
        await execFileAsync(
          'node',
          [
            join(root, 'scripts/honowarden-alpha-completion-audit.mjs'),
            ...args,
          ],
          { env: fakeEnv(fakeBin) },
        )
      ).stdout,
    )
    expect(completion.completion).toBe('incomplete')
    expect(completion.blockingReason).toBe('release_gate_not_ready')
  })

  it('verifies a published prerelease without mutating release state', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakePublishedBin({
      headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      isDraft: false,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })

    const result = await execFileAsync(
      'node',
      [
        publishedPacketScript,
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
    const report = JSON.parse(result.stdout) as ReleasePublishedPacketReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.currentReleaseReady).toBe(false)
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.targetCommit).toBe(targetCommit)
    expect(statusById(report, 'local_tag_context')).toBe('pass')
    expect(statusById(report, 'remote_tag_context')).toBe('pass')
    expect(statusById(report, 'tag_workflow_ci')).toBe('pass')
    expect(statusById(report, 'release_gate_ready')).toBe('pass')
    expect(statusById(report, 'release_state')).toBe('pass')
    expect(statusById(report, 'release_body')).toBe('pass')
    expect(report.existingRelease).toMatchObject({
      tagName: 'v0.1.0-alpha',
      isDraft: false,
      isPrerelease: true,
      targetCommitish: targetCommit,
    })
    expect(report.commands.viewRelease).toBe(
      'gh release view v0.1.0-alpha --repo kazu-42/HonoWarden',
    )
    expect(report.publishedVerificationText).toBe(
      `${targetCommit} の v0.1.0-alpha published prerelease verification が成功した`,
    )
    expect(report.limitations).toContain(
      'This packet does not publish, update, or delete a GitHub release.',
    )
    expect(report.limitations).toContain(
      'This packet does not deploy from the release.',
    )
  })

  it('blocks while the release is still a draft', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakePublishedBin({
      isDraft: true,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })

    const result = await execFileAsync(
      'node',
      [
        publishedPacketScript,
        '--expected-commit',
        targetCommit,
        '--tag-workflow-run-id',
        '54321',
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as ReleasePublishedPacketReport

    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'release_state')).toBe('fail')
    expect(report.publishedVerificationText).toBeNull()
  })

  it('fails strict mode without tag workflow evidence', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const fakeBin = await createFakePublishedBin({
      isDraft: false,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl: 'https://example.invalid/actions/runs/54321',
    })

    await expect(
      execFileAsync(
        'node',
        [
          publishedPacketScript,
          '--expected-commit',
          targetCommit,
          '--strict',
          '--no-default-tag-workflow-evidence',
        ],
        {
          env: fakeEnv(fakeBin),
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"id": "tag_workflow_ci"'),
    })
  })
})

async function createFakePublishedBin(options: {
  headCommit?: string
  isDraft: boolean
  isPrerelease: boolean
  targetCommit: string
  tagWorkflowUrl: string
}) {
  const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-published-bin-'))

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
    ...releaseClockEnv('stale'),
    HONOWARDEN_TEST_HEAD_COMMIT: fakeBin.headCommit,
    HONOWARDEN_TEST_RELEASE_DRAFT: fakeBin.isDraft ? '1' : '0',
    HONOWARDEN_TEST_RELEASE_PRERELEASE: fakeBin.isPrerelease ? '1' : '0',
    HONOWARDEN_TEST_TAG_WORKFLOW_URL: fakeBin.tagWorkflowUrl,
    HONOWARDEN_TEST_TARGET_COMMIT: fakeBin.targetCommit,
    PATH: `${fakeBin.path}${delimiter}${process.env.PATH ?? ''}`,
  }
}

function statusById(report: ReleasePublishedPacketReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
