import { execFile } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const recoveryPacketScript = join(
  repoRoot,
  'scripts/honowarden-release-tag-recovery-packet.mjs',
)

type ReleaseTagRecoveryPacketReport = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  targetTag: string
  targetVersion: string
  currentTagCommit: string | null
  recoveryCommit: string
  remoteTag: {
    objectSha: string | null
    peeledCommit: string | null
  }
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  commands: {
    moveLocalTag: string | null
    pushTagWithLease: string | null
  }
  approvalText: string | null
  limitations: string[]
}

describe('release tag recovery packet', () => {
  it('emits lease-guarded recovery commands without mutating tags', async () => {
    const currentTagCommit = '1111111111111111111111111111111111111111'
    const recoveryCommit = '2222222222222222222222222222222222222222'
    const remoteTagObject = '3333333333333333333333333333333333333333'
    const mainCiUrl = 'https://example.invalid/actions/runs/100'
    const failedTagWorkflowUrl = 'https://example.invalid/actions/runs/200'
    const fakeBin = await createFakeRecoveryBin({
      currentTagCommit,
      failedTagWorkflowUrl,
      mainCiUrl,
      recoveryCommit,
      releaseExists: false,
      remoteTagObject,
    })

    const result = await execFileAsync(
      'node',
      [
        recoveryPacketScript,
        '--remote',
        'origin',
        '--expected-current-commit',
        currentTagCommit,
        '--recovery-commit',
        recoveryCommit,
        '--expected-remote-tag-object',
        remoteTagObject,
        '--main-ci-run-id',
        '100',
        '--main-ci-url',
        mainCiUrl,
        '--failed-tag-workflow-run-id',
        '200',
        '--failed-tag-workflow-url',
        failedTagWorkflowUrl,
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as ReleaseTagRecoveryPacketReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ready')
    expect(report.targetTag).toBe('v0.1.0-alpha')
    expect(report.targetVersion).toBe('0.1.0-alpha')
    expect(report.currentTagCommit).toBe(currentTagCommit)
    expect(report.recoveryCommit).toBe(recoveryCommit)
    expect(report.remoteTag).toMatchObject({
      objectSha: remoteTagObject,
      peeledCommit: currentTagCommit,
    })
    expect(statusById(report, 'working_tree_clean')).toBe('pass')
    expect(statusById(report, 'remote_main_context')).toBe('pass')
    expect(statusById(report, 'local_tag_context')).toBe('pass')
    expect(statusById(report, 'remote_tag_context')).toBe('pass')
    expect(statusById(report, 'main_ci')).toBe('pass')
    expect(statusById(report, 'failed_tag_workflow')).toBe('pass')
    expect(statusById(report, 'release_state')).toBe('pass')
    expect(report.commands.moveLocalTag).toBe(
      `git tag -f -a v0.1.0-alpha ${recoveryCommit} -m "v0.1.0-alpha"`,
    )
    expect(report.commands.pushTagWithLease).toBe(
      `git push --force-with-lease=refs/tags/v0.1.0-alpha:${remoteTagObject} origin refs/tags/v0.1.0-alpha`,
    )
    expect(report.approvalText).toBe(
      `v0.1.0-alpha を ${currentTagCommit} から ${recoveryCommit} に lease 付きで移動して push してよい`,
    )
    expect(report.limitations).toContain(
      'This packet does not create, move, delete, or push a Git tag.',
    )
  })

  it('blocks recovery when a GitHub release already exists', async () => {
    const currentTagCommit = '1111111111111111111111111111111111111111'
    const recoveryCommit = '2222222222222222222222222222222222222222'
    const remoteTagObject = '3333333333333333333333333333333333333333'
    const fakeBin = await createFakeRecoveryBin({
      currentTagCommit,
      failedTagWorkflowUrl: 'https://example.invalid/actions/runs/200',
      mainCiUrl: 'https://example.invalid/actions/runs/100',
      recoveryCommit,
      releaseExists: true,
      remoteTagObject,
    })

    const result = await execFileAsync(
      'node',
      [
        recoveryPacketScript,
        '--expected-current-commit',
        currentTagCommit,
        '--recovery-commit',
        recoveryCommit,
        '--expected-remote-tag-object',
        remoteTagObject,
        '--main-ci-run-id',
        '100',
        '--failed-tag-workflow-run-id',
        '200',
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as ReleaseTagRecoveryPacketReport

    expect(report.status).toBe('not_ready')
    expect(statusById(report, 'release_state')).toBe('fail')
    expect(report.approvalText).toBeNull()
  })

  it('fails strict mode without main CI evidence', async () => {
    const currentTagCommit = '1111111111111111111111111111111111111111'
    const recoveryCommit = '2222222222222222222222222222222222222222'
    const remoteTagObject = '3333333333333333333333333333333333333333'
    const fakeBin = await createFakeRecoveryBin({
      currentTagCommit,
      failedTagWorkflowUrl: 'https://example.invalid/actions/runs/200',
      mainCiUrl: 'https://example.invalid/actions/runs/100',
      recoveryCommit,
      releaseExists: false,
      remoteTagObject,
    })

    await expect(
      execFileAsync(
        'node',
        [
          recoveryPacketScript,
          '--expected-current-commit',
          currentTagCommit,
          '--recovery-commit',
          recoveryCommit,
          '--expected-remote-tag-object',
          remoteTagObject,
          '--failed-tag-workflow-run-id',
          '200',
          '--strict',
        ],
        {
          env: fakeEnv(fakeBin),
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"id": "main_ci"'),
    })
  })
})

async function createFakeRecoveryBin(options: {
  currentTagCommit: string
  failedTagWorkflowUrl: string
  mainCiUrl: string
  recoveryCommit: string
  releaseExists: boolean
  remoteTagObject: string
}) {
  const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-tag-recovery-'))

  await writeFile(
    join(fakeBin, 'git'),
    `#!/usr/bin/env node
const args = process.argv.slice(2)
const command = args.join('\\u0000')
const currentTagCommit = process.env.HONOWARDEN_TEST_CURRENT_TAG_COMMIT
const recoveryCommit = process.env.HONOWARDEN_TEST_RECOVERY_COMMIT
const remoteTagObject = process.env.HONOWARDEN_TEST_REMOTE_TAG_OBJECT

if (command === 'rev-parse\\u0000HEAD') {
  process.stdout.write(recoveryCommit + '\\n')
  process.exit(0)
}

if (command === 'status\\u0000--porcelain') {
  process.exit(0)
}

if (command === 'rev-parse\\u0000-q\\u0000--verify\\u0000refs/tags/v0.1.0-alpha') {
  process.stdout.write(remoteTagObject + '\\n')
  process.exit(0)
}

if (command === 'rev-list\\u0000-n\\u00001\\u0000v0.1.0-alpha') {
  process.stdout.write(currentTagCommit + '\\n')
  process.exit(0)
}

if (command === 'ls-remote\\u0000origin\\u0000refs/heads/main') {
  process.stdout.write(recoveryCommit + '\\trefs/heads/main\\n')
  process.exit(0)
}

if (args[0] === 'ls-remote' && args[1] === '--tags' && args[3] === 'v0.1.0-alpha') {
  process.stdout.write(remoteTagObject + '\\trefs/tags/v0.1.0-alpha\\n')
  process.exit(0)
}

if (args[0] === 'ls-remote' && args[1] === '--tags' && args[3] === 'v0.1.0-alpha^{}') {
  process.stdout.write(currentTagCommit + '\\trefs/tags/v0.1.0-alpha^{}\\n')
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
const releaseExists = process.env.HONOWARDEN_TEST_RELEASE_EXISTS === '1'

if (args[0] === 'run' && args[1] === 'view') {
  const runId = args.find((arg) => /^\\d+$/.test(arg)) ?? '0'
  const isMainCi = runId === '100'
  process.stdout.write(JSON.stringify({
    databaseId: Number(runId),
    workflowName: isMainCi ? 'CI' : 'Release Tag Verification',
    event: isMainCi ? 'push' : 'push',
    headSha: isMainCi
      ? process.env.HONOWARDEN_TEST_RECOVERY_COMMIT
      : process.env.HONOWARDEN_TEST_CURRENT_TAG_COMMIT,
    status: 'completed',
    conclusion: isMainCi ? 'success' : 'failure',
    url: isMainCi
      ? process.env.HONOWARDEN_TEST_MAIN_CI_URL
      : process.env.HONOWARDEN_TEST_FAILED_TAG_WORKFLOW_URL
  }))
  process.exit(0)
}

if (args[0] === 'release' && args[1] === 'view') {
  if (!releaseExists) {
    process.stderr.write('release not found\\n')
    process.exit(1)
  }

  process.stdout.write(JSON.stringify({
    tagName: 'v0.1.0-alpha',
    isDraft: true,
    isPrerelease: true,
    targetCommitish: process.env.HONOWARDEN_TEST_CURRENT_TAG_COMMIT,
    url: 'https://example.invalid/releases/v0.1.0-alpha'
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
    ...options,
  }
}

function fakeEnv(fakeBin: {
  currentTagCommit: string
  failedTagWorkflowUrl: string
  mainCiUrl: string
  path: string
  recoveryCommit: string
  releaseExists: boolean
  remoteTagObject: string
}) {
  return {
    ...process.env,
    HONOWARDEN_TEST_CURRENT_TAG_COMMIT: fakeBin.currentTagCommit,
    HONOWARDEN_TEST_FAILED_TAG_WORKFLOW_URL: fakeBin.failedTagWorkflowUrl,
    HONOWARDEN_TEST_MAIN_CI_URL: fakeBin.mainCiUrl,
    HONOWARDEN_TEST_RECOVERY_COMMIT: fakeBin.recoveryCommit,
    HONOWARDEN_TEST_RELEASE_EXISTS: fakeBin.releaseExists ? '1' : '0',
    HONOWARDEN_TEST_REMOTE_TAG_OBJECT: fakeBin.remoteTagObject,
    PATH: `${fakeBin.path}${delimiter}${process.env.PATH ?? ''}`,
  }
}

function statusById(report: ReleaseTagRecoveryPacketReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}
