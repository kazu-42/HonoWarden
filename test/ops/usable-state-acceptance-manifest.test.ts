import { execFile } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, win32 } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error script helper intentionally ships as plain ESM.
import * as acceptanceManifest from '../../scripts/honowarden-usable-state-acceptance.mjs'

const {
  isCanonicalPosixRelativePath,
  toPosixRelativePath,
  verifyUsableStateAcceptanceManifest,
} = acceptanceManifest

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(
  new URL('../..', import.meta.url).toString(),
)
const scriptPath = join(
  repositoryRoot,
  'scripts/honowarden-usable-state-acceptance.mjs',
)
const runbookPath = join(
  repositoryRoot,
  'docs/release/usable-state-acceptance.md',
)
const liveRegressionPath = join(
  repositoryRoot,
  'docs/release/live-regression-matrix.md',
)
const packagePath = join(repositoryRoot, 'package.json')
const sourceCommit = '1234567890abcdef1234567890abcdef12345678'
const workerVersionId = '11111111-2222-4333-8444-555555555555'
const cleanupCountKeys = [
  'users',
  'devices',
  'refreshTokens',
  'authRequests',
  'orphanDevices',
  'r2SyntheticObjects',
  'pendingInquiryApprovals',
  'pendingOutboundDispatches',
  'foreignKeyViolations',
] as const

type AcceptanceManifest = {
  schemaVersion: number
  runId: string
  startedAt: string
  completedAt: string
  environment: string
  sourceCommit: string
  worker: {
    name: string
    versionId: string
    serverUrl: string
  }
  clients: {
    browser_extension: ClientPin
    desktop: ClientPin
  }
  targetEvidence: string[]
  criteria: Array<{
    id: string
    status: string
    evidence: string[]
  }>
  cleanup: {
    status: string
    checkedAt: string
    counts: Record<(typeof cleanupCountKeys)[number], number>
    evidence: string[]
  }
}

type ClientPin = {
  version: string
  build: string | null
  releaseTag: string
}

type Fixture = {
  root: string
  repoRoot: string
  evidenceRoot: string
  runDir: string
  manifestPath: string
  manifest: AcceptanceManifest
}

type FixtureTimeline = {
  runId: string
  startedAt: string
  completedAt: string
  cleanupCheckedAt: string
}

type FixtureOptions = Partial<FixtureTimeline> & {
  symlinkEvidenceRoot?: boolean
}

const fixtureRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    fixtureRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('usable-state acceptance manifest verifier', () => {
  it('passes one complete synthetic manifest bound to one target and client set', async () => {
    const fixture = await createFixture()

    const report = verify(fixture)

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      blockingReason: null,
      target: {
        environment: 'staging',
        sourceCommit,
        workerName: 'honowarden-staging',
        workerVersionId,
      },
    })
    expect(report.criteria).toHaveLength(10)
    expect(
      report.criteria.every(
        (criterion: { status: string }) => criterion.status === 'pass',
      ),
    ).toBe(true)
    expect(requirementStatus(report, 'cleanup_zero_state')).toBe('pass')
    expect(report.limitations).toContain(
      'This verifier does not deploy a Worker, run an official client, mutate a database, or prove that the recorded observations happened.',
    )
  })

  it.each([
    [
      'calendar date',
      {
        runId: '20260231T010000Z',
        startedAt: '2026-02-31T01:00:00Z',
        completedAt: '2026-02-31T01:30:00Z',
        cleanupCheckedAt: '2026-02-31T01:31:00Z',
      },
    ],
    [
      'hour',
      {
        runId: '20260716T240000Z',
        startedAt: '2026-07-16T24:00:00Z',
        completedAt: '2026-07-17T00:30:00Z',
        cleanupCheckedAt: '2026-07-17T00:31:00Z',
      },
    ],
  ])(
    'rejects a normalized invalid %s in the run timestamps',
    async (_caseName, timeline) => {
      const fixture = await createFixture(timeline)

      expect(verify(fixture)).toMatchObject({
        status: 'not_ready',
        blockingReason: 'run_timestamps_invalid',
      })
    },
  )

  it('rejects absolute and non-canonical manifest paths', async () => {
    const fixture = await createFixture()

    expect(verifyAtPath(fixture, fixture.manifestPath)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'manifest_path_unsafe',
    })

    const traversalPath =
      `docs/release/usable-state-acceptance-runs/${fixture.manifest.runId}` +
      `/../${fixture.manifest.runId}/manifest.json`
    expect(verifyAtPath(fixture, traversalPath)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'manifest_path_unsafe',
    })
  })

  it('treats the documented POSIX manifest path as canonical on Windows', () => {
    const manifestPath =
      'docs/release/usable-state-acceptance-runs/20260716T010000Z/manifest.json'

    expect(win32.normalize(manifestPath)).not.toBe(manifestPath)
    expect(isCanonicalPosixRelativePath(manifestPath)).toBe(true)
    expect(isCanonicalPosixRelativePath('criteria/SU-01.md')).toBe(true)
  })

  it('normalizes Windows evidence lookup keys to the POSIX manifest contract', () => {
    const runDirectory = String.raw`C:\repo\acceptance\20260716T010000Z`
    const evidencePath = String.raw`C:\repo\acceptance\20260716T010000Z\criteria\SU-01.md`

    expect(
      toPosixRelativePath(win32.relative(runDirectory, evidencePath)),
    ).toBe('criteria/SU-01.md')
  })

  it('rejects a symlinked evidence root', async () => {
    const fixture = await createFixture({ symlinkEvidenceRoot: true })

    expect(verify(fixture)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'manifest_path_unsafe',
    })
  })

  it('fails closed when a criterion is missing, duplicated, or waived', async () => {
    const missing = await createFixture()
    missing.manifest.criteria.pop()
    await writeManifest(missing)

    expect(verify(missing)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'criteria_set_invalid',
    })

    const duplicated = await createFixture()
    duplicated.manifest.criteria.push({
      ...duplicated.manifest.criteria[0]!,
      evidence: [...duplicated.manifest.criteria[0]!.evidence],
    })
    await writeManifest(duplicated)

    expect(verify(duplicated)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'criteria_set_invalid',
    })

    const waived = await createFixture()
    waived.manifest.criteria[0]!.status = 'waived'
    await writeManifest(waived)

    expect(verify(waived)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'criterion_status_invalid',
    })
  })

  it('keeps an observed criterion failure red instead of averaging it away', async () => {
    const fixture = await createFixture()
    fixture.manifest.criteria[3]!.status = 'fail'
    await writeFile(
      join(fixture.runDir, 'criteria/SU-04.md'),
      boundEvidence({ status: 'failed' }),
    )
    await writeManifest(fixture)

    const report = verify(fixture)

    expect(report.status).toBe('failed')
    expect(report.blockingReason).toBe('criterion_failed')
    expect(report.criteria[3]).toMatchObject({ id: 'SU-04', status: 'fail' })
  })

  it('rejects target, evidence-marker, and official-client mismatches', async () => {
    const targetMismatch = await createFixture()
    await writeFile(
      join(targetMismatch.runDir, 'criteria/SU-03.md'),
      boundEvidence({ source: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' }),
    )

    expect(verify(targetMismatch)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_binding_invalid',
    })

    const clientMismatch = await createFixture()
    clientMismatch.manifest.clients.desktop.version = '2099.1.0'
    await writeManifest(clientMismatch)

    expect(verify(clientMismatch)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'client_set_mismatch',
    })

    const unknownCommit = await createFixture()
    expect(
      verifyUsableStateAcceptanceManifest({
        manifestPath: relative(
          unknownCommit.repoRoot,
          unknownCommit.manifestPath,
        ),
        repoRoot: unknownCommit.repoRoot,
        evidenceRoot: unknownCommit.evidenceRoot,
        commitExists: () => false,
      }),
    ).toMatchObject({
      status: 'not_ready',
      blockingReason: 'source_commit_unavailable',
    })

    const unsafeTarget = await createFixture()
    unsafeTarget.manifest.worker.serverUrl =
      'https://user:secret@example.test/path?token=do-not-print'
    await writeManifest(unsafeTarget)
    const unsafeTargetReport = verify(unsafeTarget)

    expect(unsafeTargetReport).toMatchObject({
      status: 'not_ready',
      blockingReason: 'target_pin_invalid',
      target: null,
    })
    expect(JSON.stringify(unsafeTargetReport)).not.toContain('do-not-print')
    expect(JSON.stringify(unsafeTargetReport)).not.toContain('user:secret')

    const ipv6Loopback = await createFixture()
    ipv6Loopback.manifest.worker.serverUrl = 'https://[::1]'
    await writeManifest(ipv6Loopback)

    expect(verify(ipv6Loopback)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'target_pin_invalid',
      target: null,
    })

    const unrelatedHost = await createFixture()
    unrelatedHost.manifest.worker.serverUrl = 'https://unrelated.example.test'
    await writeManifest(unrelatedHost)

    expect(verify(unrelatedHost)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'target_pin_invalid',
      target: null,
    })

    const stagingPrefixImpostor = await createFixture()
    stagingPrefixImpostor.manifest.worker.serverUrl =
      'https://honowarden-staging.evil.example'
    await writeManifest(stagingPrefixImpostor)

    expect(verify(stagingPrefixImpostor)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'target_pin_invalid',
      target: null,
    })
  })

  it.each([
    'https:honowarden-staging.ghive42.workers.dev',
    'https://honowarden-staging.ghive42.workers.dev:443',
  ])('rejects the non-canonical staging URL %s', async (serverUrl) => {
    const fixture = await createFixture()
    fixture.manifest.worker.serverUrl = serverUrl
    await writeManifest(fixture)

    expect(verify(fixture)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'target_pin_invalid',
      target: null,
    })
  })

  it('rejects duplicate or contradictory canonical evidence markers', async () => {
    const conflictingStatus = await createFixture()
    await writeFile(
      join(conflictingStatus.runDir, 'criteria/SU-01.md'),
      `${boundEvidence({ status: 'failed' })}\nStatus: passed\n`,
    )

    expect(verify(conflictingStatus)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_binding_invalid',
    })

    const conflictingRun = await createFixture()
    await writeFile(
      join(conflictingRun.runDir, 'criteria/SU-01.md'),
      `${boundEvidence()}\nRun ID: \`20260716T020000Z\`\n`,
    )

    expect(verify(conflictingRun)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_binding_invalid',
    })

    const conflictingTarget = await createFixture()
    await writeFile(
      join(conflictingTarget.runDir, 'target-readback.md'),
      `${boundEvidence()}\nEnvironment: staging\nWorker name: honowarden-staging\nHealth status: passed\nHealth status: failed\nMigration status: current\n`,
    )

    expect(verify(conflictingTarget)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'target_readback_invalid',
    })

    const templateOnly = await createFixture()
    await writeFile(
      join(templateOnly.runDir, 'criteria/SU-01.md'),
      `# Notes\n\n\`\`\`text\n${boundEvidence()}\`\`\`\n`,
    )

    expect(verify(templateOnly)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_binding_invalid',
    })
  })

  it.each([
    ['an indented plain marker', ' Status: failed'],
    ['an indented code marker', '\tRun ID: `20260716T020000Z`'],
  ])('rejects %s after the canonical binding header', async (_name, marker) => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.runDir, 'criteria/SU-01.md'),
      `${boundEvidence()}\n${marker}\n`,
    )

    expect(verify(fixture)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_binding_invalid',
    })
  })

  it('rejects missing or escaping evidence paths', async () => {
    const missing = await createFixture()
    await rm(join(missing.runDir, 'criteria/SU-01.md'))

    expect(verify(missing)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_file_invalid',
    })

    const escaping = await createFixture()
    escaping.manifest.criteria[0]!.evidence = ['../../outside.md']
    await writeManifest(escaping)

    expect(verify(escaping)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_contract_invalid',
    })

    const symlinked = await createFixture()
    const outside = join(symlinked.root, 'outside.md')
    await writeFile(outside, boundEvidence())
    const requiredEvidencePath = join(symlinked.runDir, 'criteria/SU-01.md')
    await rm(requiredEvidencePath)
    await symlink(outside, requiredEvidencePath)

    expect(verify(symlinked)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_file_invalid',
    })

    const wrongDedicatedPath = await createFixture()
    wrongDedicatedPath.manifest.criteria[0]!.evidence = ['criteria/SU-02.md']
    await writeManifest(wrongDedicatedPath)

    expect(verify(wrongDedicatedPath)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_contract_invalid',
    })
  })

  it('rejects supplemental files declared by a criterion', async () => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.runDir, 'criteria/debug.md'),
      `${boundEvidence()}\nSupplemental debug notes.\n`,
    )
    fixture.manifest.criteria[0]!.evidence.push('criteria/debug.md')
    await writeManifest(fixture)

    expect(verify(fixture)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'evidence_contract_invalid',
    })
  })

  it('rejects unreferenced files anywhere in the dedicated run directory', async () => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.runDir, 'debug.log'),
      'Authorization: Bearer do-not-print-unreferenced-token\n',
    )

    const report = verify(fixture)
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({
      status: 'not_ready',
      blockingReason: 'unexpected_evidence_file',
    })
    expect(serialized).toContain('debug.log')
    expect(serialized).not.toContain('do-not-print-unreferenced-token')
  })

  it('rejects secret-like and personal material without echoing it', async () => {
    const fixture = await createFixture()
    const evidencePath = join(fixture.runDir, 'criteria/SU-06.md')
    await writeFile(
      evidencePath,
      `${boundEvidence()}\nAuthorization: Bearer do-not-print-token\nOwner: person@ghive.jp\n`,
    )

    const report = verify(fixture)
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({
      status: 'not_ready',
      blockingReason: 'unsafe_evidence_content',
    })
    expect(serialized).not.toContain('do-not-print-token')
    expect(serialized).not.toContain('person@ghive.jp')
    expect(serialized).toContain('SU-06.md')
  })

  it.each([
    'sender@example.net',
    'alpha-smoke@example.invalid',
    'person@nested.example.com',
    'fixture@synthetic.test',
  ])('allows the reserved synthetic email address %s', async (email) => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.runDir, 'criteria/SU-06.md'),
      `${boundEvidence()}\nSynthetic user: ${email}\n`,
    )

    expect(verify(fixture)).toMatchObject({
      status: 'passed',
      blockingReason: null,
    })
  })

  it('allows only the documented public HonoWarden contact aliases', async () => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.runDir, 'criteria/SU-09.md'),
      `${boundEvidence()}\n${[
        'security@honowarden.com',
        'support@honowarden.com',
        'hello@honowarden.com',
        'admin@honowarden.com',
        'postmaster@honowarden.com',
        'abuse@honowarden.com',
      ].join('\n')}\n`,
    )

    expect(verify(fixture)).toMatchObject({
      status: 'passed',
      blockingReason: null,
    })
  })

  it('rejects an undeclared project-domain mailbox', async () => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.runDir, 'criteria/SU-10.md'),
      `${boundEvidence()}\nOwner: alice@honowarden.com\n`,
    )

    expect(verify(fixture)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'unsafe_evidence_content',
    })
  })

  it.each([
    'Authorization: Bearer <redacted>',
    'Authorization: "Bearer [redacted]"',
    '{"Authorization":"Bearer redacted"}',
    '{"Authorization":["Bearer <redacted>"]}',
    'Authorization: Basic <redacted>',
    '{"Authorization":"Basic [redacted]"}',
    '{"token":"[redacted]"}',
    '{"secretKey":"<redacted>"}',
    '- api-key: `redacted`',
    '$ export CLOUDFLARE_API_TOKEN=<redacted>',
    'APP_SECRET_KEY=[redacted]',
    'Callback: https://example.test/callback?access_token=<redacted>',
    'Set-Cookie: refresh_token=[redacted]; HttpOnly; Secure',
    '{"Set-Cookie":"refresh_token=<redacted>; HttpOnly; Secure"}',
  ])('allows the explicit redacted placeholder in %s', async (safeContent) => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.runDir, 'criteria/SU-10.md'),
      `${boundEvidence()}\n${safeContent}\n`,
    )

    expect(verify(fixture)).toMatchObject({
      status: 'passed',
      blockingReason: null,
    })
  })

  it.each([
    [
      'snake_case token fields',
      '{"access_token":"do-not-print-access-token","refresh_token":"do-not-print-refresh-token"}',
      ['do-not-print-access-token', 'do-not-print-refresh-token'],
    ],
    [
      'an encrypted PKCS#8 private-key header',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\ndo-not-print-encrypted-key',
      ['do-not-print-encrypted-key'],
    ],
    [
      'a DSA private-key header',
      '-----BEGIN DSA PRIVATE KEY-----\ndo-not-print-dsa-key',
      ['do-not-print-dsa-key'],
    ],
    [
      'a Cloudflare token environment assignment',
      'CLOUDFLARE_API_TOKEN=do-not-print-cloudflare-token',
      ['do-not-print-cloudflare-token'],
    ],
    [
      'a HonoWarden token-secret environment assignment',
      'HONOWARDEN_TOKEN_SECRET=do-not-print-token-secret',
      ['do-not-print-token-secret'],
    ],
    [
      'a quoted bearer Authorization header',
      'Authorization: "Bearer do-not-print-quoted-bearer"',
      ['do-not-print-quoted-bearer'],
    ],
    [
      'a single-quoted bearer Authorization header',
      "Authorization: 'Bearer do-not-print-single-quoted-bearer'",
      ['do-not-print-single-quoted-bearer'],
    ],
    [
      'a backtick-quoted bearer Authorization header',
      'Authorization: `Bearer do-not-print-backtick-bearer`',
      ['do-not-print-backtick-bearer'],
    ],
    [
      'a JSON bearer Authorization header',
      '{"Authorization":"Bearer do-not-print-json-bearer"}',
      ['do-not-print-json-bearer'],
    ],
    [
      'an array-valued JSON bearer Authorization header',
      '{"Authorization":["Bearer do-not-print-array-json-bearer"]}',
      ['do-not-print-array-json-bearer'],
    ],
    [
      'a bearer token appended after a redacted placeholder',
      'Authorization: Bearer <redacted> do-not-print-after-placeholder',
      ['do-not-print-after-placeholder'],
    ],
    [
      'a quoted bearer token appended after a redacted placeholder',
      'Authorization: "Bearer redacted do-not-print-after-quoted-placeholder"',
      ['do-not-print-after-quoted-placeholder'],
    ],
    [
      'a rawBody JSON field',
      '{"rawBody":"do-not-print-raw-json"}',
      ['do-not-print-raw-json'],
    ],
    [
      'a rawBody evidence assignment',
      'rawBody: `do-not-print-raw-assignment`',
      ['do-not-print-raw-assignment'],
    ],
    [
      'a hyphenated API-key evidence assignment',
      'api-key: `do-not-print-hyphenated-api-key`',
      ['do-not-print-hyphenated-api-key'],
    ],
    [
      'a hyphenated client-secret evidence assignment',
      'client-secret: `do-not-print-hyphenated-client-secret`',
      ['do-not-print-hyphenated-client-secret'],
    ],
    [
      'a hyphenated raw-body evidence assignment',
      'raw-body: `do-not-print-hyphenated-raw-body`',
      ['do-not-print-hyphenated-raw-body'],
    ],
    [
      'a hyphenated API-key JSON field',
      '{"api-key":"do-not-print-hyphenated-json-api-key"}',
      ['do-not-print-hyphenated-json-api-key'],
    ],
    ['a numeric sensitive JSON field', '{"token":867530942}', ['867530942']],
    [
      'an object-valued sensitive JSON field',
      '{"apiKey":{"value":"do-not-print-object-json-api-key"}}',
      ['do-not-print-object-json-api-key'],
    ],
    [
      'a camelCase secret-key JSON field',
      '{"secretKey":"do-not-print-camel-secret-key"}',
      ['do-not-print-camel-secret-key'],
    ],
    [
      'a snake_case secret-key JSON field',
      '{"secret_key":"do-not-print-snake-secret-key"}',
      ['do-not-print-snake-secret-key'],
    ],
    [
      'a sensitive assignment appended after a redacted placeholder',
      'api-key: redacted do-not-print-after-assignment-placeholder',
      ['do-not-print-after-assignment-placeholder'],
    ],
    [
      'a sensitive JSON value appended after a redacted placeholder',
      '{"api-key":"redacted do-not-print-after-json-placeholder"}',
      ['do-not-print-after-json-placeholder'],
    ],
    [
      'a sensitive assignment in a Markdown bullet',
      '- access_token: `do-not-print-bulleted-access-token`',
      ['do-not-print-bulleted-access-token'],
    ],
    [
      'a sensitive assignment in a Markdown blockquote',
      '> client-secret: `do-not-print-quoted-client-secret`',
      ['do-not-print-quoted-client-secret'],
    ],
    [
      'a sensitive assignment in an ordered Markdown item',
      '1. raw-body: `do-not-print-ordered-raw-body`',
      ['do-not-print-ordered-raw-body'],
    ],
    [
      'a sensitive assignment in a Markdown checklist',
      '- [ ] `api-key`: `do-not-print-checklist-api-key`',
      ['do-not-print-checklist-api-key'],
    ],
    [
      'an exported token assignment',
      'export CLOUDFLARE_API_TOKEN=do-not-print-exported-token',
      ['do-not-print-exported-token'],
    ],
    [
      'an exported token assignment after a shell prompt',
      '$ export CLOUDFLARE_API_TOKEN=do-not-print-prompt-token',
      ['do-not-print-prompt-token'],
    ],
    [
      'an uppercase secret-key assignment',
      'SECRET_KEY=do-not-print-uppercase-secret-key',
      ['do-not-print-uppercase-secret-key'],
    ],
    [
      'a lowercase secret-key assignment',
      'secret_key=do-not-print-lowercase-secret-key',
      ['do-not-print-lowercase-secret-key'],
    ],
    [
      'a prefixed secret-key assignment',
      'APP_SECRET_KEY=do-not-print-prefixed-secret-key',
      ['do-not-print-prefixed-secret-key'],
    ],
    [
      'an access token embedded in a callback URL',
      'Callback: https://example.test/callback?access_token=do-not-print-url-token',
      ['do-not-print-url-token'],
    ],
    [
      'a refresh token embedded in a Set-Cookie header',
      'Set-Cookie: refresh_token=do-not-print-cookie-token; HttpOnly; Secure',
      ['do-not-print-cookie-token'],
    ],
    [
      'a refresh token embedded in a JSON Set-Cookie value',
      '{"Set-Cookie":"refresh_token=do-not-print-json-cookie-token; HttpOnly; Secure"}',
      ['do-not-print-json-cookie-token'],
    ],
    [
      'a snake_case password-hash field',
      '{"password_hash":"do-not-print-password-hash"}',
      ['do-not-print-password-hash'],
    ],
    [
      'a camelCase password-hash field',
      '{"passwordHash":"do-not-print-camel-password-hash"}',
      ['do-not-print-camel-password-hash'],
    ],
    [
      'a password-hash evidence assignment',
      'password_hash: `do-not-print-assigned-password-hash`',
      ['do-not-print-assigned-password-hash'],
    ],
    [
      'a master-password-hash field',
      '{"masterPasswordHash":"do-not-print-master-password-hash"}',
      ['do-not-print-master-password-hash'],
    ],
    [
      'a standard vault encrypted string',
      'Vault: 2.dGhpc2lzMTZieXRlc2l2IQ==|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
      [
        '2.dGhpc2lzMTZieXRlc2l2IQ==|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
      ],
    ],
    [
      'an apiToken JSON field',
      '{"apiToken":"do-not-print-api-token"}',
      ['do-not-print-api-token'],
    ],
    [
      'a sessionToken JSON field',
      '{"sessionToken":"do-not-print-session-token"}',
      ['do-not-print-session-token'],
    ],
    [
      'a cloudflareApiToken JSON field',
      '{"cloudflareApiToken":"do-not-print-cloudflare-api-token"}',
      ['do-not-print-cloudflare-api-token'],
    ],
    [
      'an xApiKey JSON field',
      '{"xApiKey":"do-not-print-x-api-key"}',
      ['do-not-print-x-api-key'],
    ],
    [
      'a bare credential evidence assignment',
      'credential: do-not-print-credential',
      ['do-not-print-credential'],
    ],
    [
      'a bare credentials evidence assignment',
      'credentials=do-not-print-credentials',
      ['do-not-print-credentials'],
    ],
    [
      'credentials embedded in a callback URL',
      'Callback: https://example.test/callback?credentials=do-not-print-url-credentials',
      ['do-not-print-url-credentials'],
    ],
    [
      'a Basic Authorization header',
      'Authorization: Basic dXNlcjpkby1ub3QtcHJpbnQ=',
      ['dXNlcjpkby1ub3QtcHJpbnQ='],
    ],
    [
      'a JSON Basic Authorization header',
      '{"Authorization":"Basic dXNlcjpkby1ub3QtcHJpbnQ="}',
      ['dXNlcjpkby1ub3QtcHJpbnQ='],
    ],
    [
      'an HTTPS URL with userinfo',
      'Callback: https://synthetic-user:do-not-print-password@example.test/path',
      ['do-not-print-password'],
    ],
    [
      'a database URL with userinfo',
      'Database: postgres://synthetic-user:do-not-print-db-password@example.test/db',
      ['do-not-print-db-password'],
    ],
    [
      'a plural refreshTokens JSON field',
      '{"refreshTokens":["do-not-print-plural-refresh-token"]}',
      ['do-not-print-plural-refresh-token'],
    ],
    [
      'a plural apiKeys JSON field',
      '{"apiKeys":["do-not-print-plural-api-key"]}',
      ['do-not-print-plural-api-key'],
    ],
    [
      'a plural secrets JSON field',
      '{"secrets":["do-not-print-plural-secret"]}',
      ['do-not-print-plural-secret'],
    ],
    [
      'a plural passwords JSON field',
      '{"passwords":["do-not-print-plural-password"]}',
      ['do-not-print-plural-password'],
    ],
    [
      'an armored PGP private-key block',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----\ndo-not-print-pgp-private-key\n-----END PGP PRIVATE KEY BLOCK-----',
      ['do-not-print-pgp-private-key'],
    ],
    [
      'a plural refreshTokens evidence assignment',
      'refreshTokens: do-not-print-assigned-refresh-token',
      ['do-not-print-assigned-refresh-token'],
    ],
    [
      'a plural apiKeys evidence assignment',
      'apiKeys: do-not-print-assigned-api-key',
      ['do-not-print-assigned-api-key'],
    ],
    [
      'a plural secretKeys evidence assignment',
      'secretKeys: do-not-print-assigned-secret-key',
      ['do-not-print-assigned-secret-key'],
    ],
    [
      'a plural passwords evidence assignment',
      'passwords: do-not-print-assigned-password',
      ['do-not-print-assigned-password'],
    ],
    [
      'plural refresh tokens embedded in a callback URL',
      'Callback: https://example.test/callback?refreshTokens=do-not-print-query-refresh-token',
      ['do-not-print-query-refresh-token'],
    ],
    [
      'plural API keys embedded in a callback URL',
      'Callback: https://example.test/callback?apiKeys=do-not-print-query-api-key',
      ['do-not-print-query-api-key'],
    ],
  ])(
    'rejects %s without echoing the sensitive value',
    async (_caseName, unsafeContent, prohibitedValues) => {
      const fixture = await createFixture()
      await writeFile(
        join(fixture.runDir, 'criteria/SU-10.md'),
        `${boundEvidence()}\n${unsafeContent}\n`,
      )

      const report = verify(fixture)
      const serialized = JSON.stringify(report)

      expect(report).toMatchObject({
        status: 'not_ready',
        blockingReason: 'unsafe_evidence_content',
      })
      for (const prohibitedValue of prohibitedValues) {
        expect(serialized).not.toContain(prohibitedValue)
      }
    },
  )

  it('requires every post-run cleanup count and foreign-key readback to be zero', async () => {
    const fixture = await createFixture()
    fixture.manifest.cleanup.status = 'fail'
    fixture.manifest.cleanup.counts.refreshTokens = 1
    await writeFile(
      join(fixture.runDir, 'cleanup-readback.md'),
      cleanupEvidence({ status: 'failed', refreshTokens: 1 }),
    )
    await writeManifest(fixture)

    const report = verify(fixture)

    expect(report.status).toBe('failed')
    expect(report.blockingReason).toBe('cleanup_not_zero')
    expect(requirementStatus(report, 'cleanup_zero_state')).toBe('fail')

    const contradictoryReadback = await createFixture()
    await writeFile(
      join(contradictoryReadback.runDir, 'cleanup-readback.md'),
      `${cleanupEvidence()}\nusers: \`5\`\n`,
    )

    expect(verify(contradictoryReadback)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'cleanup_readback_invalid',
    })

    const impossible = await createFixture()
    impossible.manifest.cleanup.counts.users = -1
    await writeManifest(impossible)

    expect(verify(impossible)).toMatchObject({
      status: 'not_ready',
      blockingReason: 'manifest_schema_invalid',
    })
  })

  it('emits structured non-passing output and exits non-zero in strict CLI mode', async () => {
    const missingManifest = join(
      repositoryRoot,
      'docs/release/usable-state-acceptance-runs/missing/manifest.json',
    )

    await expect(
      execFileAsync('node', [
        scriptPath,
        '--strict',
        '--manifest',
        missingManifest,
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"status": "not_ready"'),
      stderr: expect.stringContaining(
        'usable-state acceptance manifest is not passing',
      ),
    })
  })

  it('documents the read-only boundary and exposes the package command', async () => {
    const runbook = await readFile(runbookPath, 'utf8')
    const liveRegression = await readFile(liveRegressionPath, 'utf8')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['usable:acceptance:verify']).toBe(
      'node scripts/honowarden-usable-state-acceptance.mjs',
    )
    expect(runbook).toContain('pnpm usable:acceptance:verify')
    expect(runbook).toContain('SU-01 through SU-10')
    expect(runbook).toContain('one source commit')
    expect(runbook).toContain('one Worker version')
    expect(runbook).toContain('https://honowarden-staging.ghive42.workers.dev')
    expect(runbook).toContain('rejects every file or')
    expect(runbook).toContain('example.net')
    expect(runbook).toContain('security')
    expect(runbook).toContain('other project-domain mailboxes fail closed')
    expect(runbook).toMatch(/does\s+not run official clients/)
    expect(runbook).toMatch(/does\s+not deploy/)
    expect(runbook).toMatch(/does\s+not prove that HON-110 has passed/)
    expect(liveRegression).toContain('usable-state-acceptance.md')
  })
})

function verify(fixture: Fixture) {
  return verifyAtPath(fixture, relative(fixture.repoRoot, fixture.manifestPath))
}

function verifyAtPath(fixture: Fixture, manifestPath: string) {
  return verifyUsableStateAcceptanceManifest({
    manifestPath,
    repoRoot: fixture.repoRoot,
    evidenceRoot: fixture.evidenceRoot,
    commitExists: () => true,
  })
}

async function createFixture({
  runId = '20260716T010000Z',
  startedAt = '2026-07-16T01:00:00Z',
  completedAt = '2026-07-16T01:30:00Z',
  cleanupCheckedAt = '2026-07-16T01:31:00Z',
  symlinkEvidenceRoot = false,
}: FixtureOptions = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'honowarden-hon142-'))
  fixtureRoots.push(root)
  const repoRoot = join(root, 'repo')
  const evidenceRoot = join(
    repoRoot,
    'docs/release/usable-state-acceptance-runs',
  )
  const runDir = join(evidenceRoot, runId)
  const manifestPath = join(runDir, 'manifest.json')

  await mkdir(join(repoRoot, 'compat'), { recursive: true })
  if (symlinkEvidenceRoot) {
    const externalEvidenceRoot = join(root, 'external-evidence')
    await mkdir(join(repoRoot, 'docs/release'), { recursive: true })
    await mkdir(externalEvidenceRoot, { recursive: true })
    await symlink(externalEvidenceRoot, evidenceRoot)
  }
  await mkdir(join(runDir, 'criteria'), { recursive: true })
  await writeFile(
    join(repoRoot, 'compat/client-matrix.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: [
          {
            surface: 'browser_extension',
            version: '2026.6.1',
            releaseTag: 'browser-v2026.6.1',
          },
          {
            surface: 'desktop',
            version: '2026.6.1',
            releaseTag: 'desktop-v2026.6.1',
          },
        ],
      },
      null,
      2,
    )}\n`,
  )

  for (let index = 1; index <= 10; index += 1) {
    const id = `SU-${String(index).padStart(2, '0')}`
    await writeFile(join(runDir, `criteria/${id}.md`), boundEvidence({ runId }))
  }
  await writeFile(
    join(runDir, 'target-readback.md'),
    `${boundEvidence({ runId })}\nEnvironment: staging\nWorker name: honowarden-staging\nHealth status: passed\nMigration status: current\n`,
  )
  await writeFile(
    join(runDir, 'cleanup-readback.md'),
    cleanupEvidence({ runId }),
  )

  const counts = Object.fromEntries(
    cleanupCountKeys.map((key) => [key, 0]),
  ) as AcceptanceManifest['cleanup']['counts']
  const manifest: AcceptanceManifest = {
    schemaVersion: 1,
    runId,
    startedAt,
    completedAt,
    environment: 'staging',
    sourceCommit,
    worker: {
      name: 'honowarden-staging',
      versionId: workerVersionId,
      serverUrl: 'https://honowarden-staging.ghive42.workers.dev',
    },
    clients: {
      browser_extension: {
        version: '2026.6.1',
        build: null,
        releaseTag: 'browser-v2026.6.1',
      },
      desktop: {
        version: '2026.6.1',
        build: null,
        releaseTag: 'desktop-v2026.6.1',
      },
    },
    targetEvidence: ['target-readback.md'],
    criteria: Array.from({ length: 10 }, (_, index) => {
      const id = `SU-${String(index + 1).padStart(2, '0')}`
      return { id, status: 'pass', evidence: [`criteria/${id}.md`] }
    }),
    cleanup: {
      status: 'pass',
      checkedAt: cleanupCheckedAt,
      counts,
      evidence: ['cleanup-readback.md'],
    },
  }
  const fixture = {
    root,
    repoRoot,
    evidenceRoot,
    runDir,
    manifestPath,
    manifest,
  }
  await writeManifest(fixture)
  return fixture
}

async function writeManifest(fixture: Fixture): Promise<void> {
  await writeFile(
    fixture.manifestPath,
    `${JSON.stringify(fixture.manifest, null, 2)}\n`,
  )
}

function boundEvidence({
  runId = '20260716T010000Z',
  source = sourceCommit,
  status = 'passed',
} = {}): string {
  return [
    `Status: ${status}`,
    `Run ID: \`${runId}\``,
    `Source commit: \`${source}\``,
    `Worker version ID: \`${workerVersionId}\``,
    '',
  ].join('\n')
}

function cleanupEvidence({
  runId = '20260716T010000Z',
  status = 'passed',
  refreshTokens = 0,
} = {}): string {
  const counts = Object.fromEntries(
    cleanupCountKeys.map((key) => [
      key,
      key === 'refreshTokens' ? refreshTokens : 0,
    ]),
  )

  return [
    boundEvidence({ runId, status }).trimEnd(),
    ...cleanupCountKeys.map((key) => `${key}: \`${counts[key]}\``),
    '',
  ].join('\n')
}

function requirementStatus(
  report: {
    requirements: Array<{ id: string; status: string }>
  },
  id: string,
): string | undefined {
  return report.requirements.find((requirement) => requirement.id === id)
    ?.status
}
