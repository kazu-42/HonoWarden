import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const readinessPacketScript = join(
  repoRoot,
  'scripts/honowarden-ops-readiness-packet.mjs',
)

type OpsReadinessPacket = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  blockingReason: string | null
  release: {
    completion: 'complete' | 'incomplete' | 'unknown'
    blockingReason: string | null
    statusPhase:
      | 'draft_ready_for_publication'
      | 'published_verified'
      | 'published_not_verified'
      | 'not_ready_for_publication'
      | 'unknown'
    targetCommit: string
  }
  email: {
    localPreflightStatus: 'ready' | 'not_ready'
    configuredRoutes: number
    requiredRoutes: number
  }
  evidence: {
    cloudflareResourcesRecorded: boolean
    stagingDryRunRecorded: boolean
    workerLiveSmokeRecorded: boolean
    websiteLiveEvidenceRecorded: boolean
    emailRoutingEvidenceRecorded: boolean
    rollbackEvidenceRecorded: boolean
  }
  requirements: Array<{
    id: string
    status: 'pass' | 'fail'
    blocker: string | null
  }>
  limitations: string[]
}

describe('ops readiness packet', () => {
  it('keeps post-alpha operations blocked while the release is still a draft', async () => {
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
        readinessPacketScript,
        '--tag-workflow-run-id',
        '54321',
        '--tag-workflow-url',
        tagWorkflowUrl,
      ],
      {
        env: fakeEnv(fakeBin),
      },
    )
    const report = JSON.parse(result.stdout) as OpsReadinessPacket

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('not_ready')
    expect(report.blockingReason).toBe('release_publication_approval_required')
    expect(report.release).toMatchObject({
      completion: 'incomplete',
      blockingReason: 'release_publication_approval_required',
      statusPhase: 'draft_ready_for_publication',
      targetCommit,
    })
    expect(statusById(report, 'release_published_verified')).toBe('fail')
    expect(statusById(report, 'cloudflare_resources_recorded')).toBe('pass')
    expect(statusById(report, 'staging_dry_run_recorded')).toBe('pass')
    expect(statusById(report, 'worker_live_smoke_recorded')).toBe('fail')
    expect(statusById(report, 'website_live_evidence_recorded')).toBe('fail')
    expect(statusById(report, 'email_routing_live_evidence_recorded')).toBe(
      'fail',
    )
    expect(report.limitations).toContain(
      'This packet does not deploy Workers, change DNS, configure Email Routing, or send email.',
    )
  })

  it('accepts local email inputs without printing token or destination values', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeReleaseBin({
      isDraft: true,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })
    const env = {
      ...fakeEnv(fakeBin),
      CLOUDFLARE_API_TOKEN: 'cf-secret-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone-id',
      HONOWARDEN_SECURITY_FORWARD_TO: 'security-destination@example.test',
      HONOWARDEN_SUPPORT_FORWARD_TO: 'support-destination@example.test',
      HONOWARDEN_GENERAL_FORWARD_TO: 'hello-destination@example.test',
      HONOWARDEN_ADMIN_FORWARD_TO: 'admin-destination@example.test',
      HONOWARDEN_POSTMASTER_FORWARD_TO: 'postmaster-destination@example.test',
      HONOWARDEN_ABUSE_FORWARD_TO: 'abuse-destination@example.test',
    }

    const result = await execFileAsync(
      'node',
      [
        readinessPacketScript,
        '--tag-workflow-run-id',
        '54321',
        '--tag-workflow-url',
        tagWorkflowUrl,
      ],
      { env },
    )
    const report = JSON.parse(result.stdout) as OpsReadinessPacket

    expect(statusById(report, 'email_local_inputs_ready')).toBe('pass')
    expect(report.email).toMatchObject({
      localPreflightStatus: 'ready',
      configuredRoutes: 6,
      requiredRoutes: 6,
    })
    expect(result.stdout).not.toContain('cf-secret-token')
    expect(result.stdout).not.toContain('security-destination@example.test')
    expect(result.stdout).not.toContain('support-destination@example.test')
  })

  it('passes strict mode only when release, email, and live ops evidence are recorded', async () => {
    const targetCommit = '1234567890abcdef1234567890abcdef12345678'
    const tagWorkflowUrl = 'https://example.invalid/actions/runs/54321'
    const fakeBin = await createFakeReleaseBin({
      isDraft: false,
      isPrerelease: true,
      targetCommit,
      tagWorkflowUrl,
    })
    const evidence = await createPassedEvidenceFiles()

    const result = await execFileAsync(
      'node',
      [
        readinessPacketScript,
        '--strict',
        '--expected-commit',
        targetCommit,
        '--tag-workflow-run-id',
        '54321',
        '--tag-workflow-url',
        tagWorkflowUrl,
        '--worker-live-smoke-evidence',
        evidence.worker,
        '--website-live-evidence',
        evidence.website,
        '--email-routing-evidence',
        evidence.email,
        '--rollback-evidence',
        evidence.rollback,
      ],
      {
        env: {
          ...fakeEnv(fakeBin),
          CLOUDFLARE_API_TOKEN: 'cf-secret-token',
          CLOUDFLARE_ACCOUNT_ID: 'account-id',
          CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone-id',
          HONOWARDEN_SECURITY_FORWARD_TO: 'security-destination@example.test',
          HONOWARDEN_SUPPORT_FORWARD_TO: 'support-destination@example.test',
          HONOWARDEN_GENERAL_FORWARD_TO: 'hello-destination@example.test',
          HONOWARDEN_ADMIN_FORWARD_TO: 'admin-destination@example.test',
          HONOWARDEN_POSTMASTER_FORWARD_TO:
            'postmaster-destination@example.test',
          HONOWARDEN_ABUSE_FORWARD_TO: 'abuse-destination@example.test',
        },
      },
    )
    const report = JSON.parse(result.stdout) as OpsReadinessPacket

    expect(report.status).toBe('ready')
    expect(report.blockingReason).toBeNull()
    expect(report.release.statusPhase).toBe('published_verified')
    expect(report.requirements.every((entry) => entry.status === 'pass')).toBe(
      true,
    )
    expect(report.evidence).toMatchObject({
      workerLiveSmokeRecorded: true,
      websiteLiveEvidenceRecorded: true,
      emailRoutingEvidenceRecorded: true,
      rollbackEvidenceRecorded: true,
    })
  })
})

function statusById(report: OpsReadinessPacket, id: string) {
  return report.requirements.find((requirement) => requirement.id === id)
    ?.status
}

async function createPassedEvidenceFiles() {
  const dir = `test/.tmp/ops-readiness-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`
  await mkdir(join(repoRoot, dir), { recursive: true })

  const paths = {
    worker: `${dir}/worker-live-smoke.md`,
    website: `${dir}/website-live.md`,
    email: `${dir}/email-routing.md`,
    rollback: `${dir}/rollback.md`,
  }

  await Promise.all(
    Object.values(paths).map((path) =>
      writeFile(join(repoRoot, path), `# Test Evidence\n\nStatus: passed\n`),
    ),
  )

  return paths
}

async function createFakeReleaseBin(options: {
  headCommit?: string
  isDraft: boolean
  isPrerelease: boolean
  targetCommit: string
  tagWorkflowUrl: string
}) {
  const fakeBin = await mkdtemp(join(tmpdir(), 'honowarden-ops-bin-'))

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
