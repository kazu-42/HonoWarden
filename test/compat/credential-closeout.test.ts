import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error repository verifier intentionally ships as plain ESM.
import * as credentialCloseout from '../../scripts/honowarden-credential-closeout.mjs'

const {
  assertCredentialCloseoutContentSafe,
  buildCredentialCloseoutPacket,
  credentialCloseoutArtifactPaths,
  credentialCloseoutClaimIds,
  credentialCloseoutPacketPath,
  scanCredentialCloseoutArtifacts,
  serializeCredentialCloseoutPacket,
  sha256CredentialCloseoutText,
  verifyCredentialCloseoutPacket,
  writeCredentialCloseoutPacket,
} = credentialCloseout

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const registryPath = join(repoRoot, 'compat/credential-evidence.json')
const packetPath = join(repoRoot, credentialCloseoutPacketPath)
const scriptPath = join(repoRoot, 'scripts/honowarden-credential-closeout.mjs')
const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
  }
})

describe('credential closeout packet', () => {
  it('builds byte-identical canonical output without time or host paths', () => {
    const first = buildCredentialCloseoutPacket({ repoRoot })
    const second = buildCredentialCloseoutPacket({ repoRoot })
    const firstText = serializeCredentialCloseoutPacket(first)
    const secondText = serializeCredentialCloseoutPacket(second)

    expect(first).toEqual(second)
    expect(firstText).toBe(secondText)
    expect(sha256CredentialCloseoutText(firstText)).toBe(
      sha256CredentialCloseoutText(secondText),
    )
    expect(firstText.endsWith('\n')).toBe(true)
    expect(firstText).not.toContain(repoRoot)
    expect(firstText).not.toMatch(/generatedAt|createdAt|updatedAt/)
    expect(firstText).not.toContain('requiredMarkers')
    expect(firstText).not.toContain('assertion')
    expect(firstText).not.toContain('artifactContents')
  })

  it('emits only the closed allowlisted packet shape', () => {
    const packet = buildCredentialCloseoutPacket({ repoRoot }) as Packet

    expect(Object.keys(packet)).toEqual([
      'schemaVersion',
      'status',
      'registry',
      'sourcePins',
      'evidenceLevels',
      'claims',
      'counts',
      'liveEvidenceLevels',
      'limitations',
    ])
    expect(Object.keys(packet.registry)).toEqual([
      'path',
      'sha256',
      'schemaPath',
      'schemaSha256',
    ])
    expect(Object.keys(packet.sourcePins)).toEqual([
      'programBaseCommit',
      'clients',
    ])
    expect(
      packet.sourcePins.clients.every((source) =>
        sameKeys(source, [
          'id',
          'surface',
          'version',
          'sourceRef',
          'assetSha256',
        ]),
      ),
    ).toBe(true)
    expect(
      packet.evidenceLevels.every((level) =>
        sameKeys(level, ['id', 'rank', 'scope']),
      ),
    ).toBe(true)
    expect(
      packet.claims.every((claim) =>
        sameKeys(claim, [
          'id',
          'status',
          'executionLevel',
          'evidenceLevel',
          'sourceGeneration',
          'artifacts',
          'clientSourceIds',
          'limitations',
          'sha256',
        ]),
      ),
    ).toBe(true)
    expect(
      packet.claims.every((claim) =>
        sameKeys(claim.sourceGeneration, ['kind', 'commit']),
      ),
    ).toBe(true)
    expect(
      packet.claims
        .flatMap((claim) => claim.artifacts)
        .every((artifact) =>
          sameKeys(artifact, ['path', 'evidenceLevel', 'sha256']),
        ),
    ).toBe(true)
    expect(Object.keys(packet.counts)).toEqual([
      'evidenceLevels',
      'clientSources',
      'claims',
      'artifacts',
      'artifactBindings',
      'fixtureClaims',
      'localApiClaims',
      'localOfficialClientClaims',
      'stagingClaims',
      'productionClaims',
    ])
  })

  it('pins exact registry, schema, claims, sources, levels, and counts', () => {
    const packet = buildCredentialCloseoutPacket({ repoRoot }) as Packet

    expect(packet).toMatchObject({
      schemaVersion: 1,
      status: 'verified',
      registry: {
        path: 'compat/credential-evidence.json',
        sha256:
          '53192962c66ccd1714d3a9ce6d878d12ed91b31f1d765caef1af4e127e15a169',
        schemaPath: 'compat/credential-evidence.schema.json',
        schemaSha256:
          '1640608cb08c4fdac43d6ac94bfdc4b06e5af6fe10e6c1473a6d459a3f02c32f',
      },
      counts: {
        evidenceLevels: 5,
        clientSources: 2,
        claims: 11,
        artifacts: 8,
        artifactBindings: 20,
        fixtureClaims: 0,
        localApiClaims: 4,
        localOfficialClientClaims: 7,
        stagingClaims: 0,
        productionClaims: 0,
      },
      liveEvidenceLevels: [],
    })
    expect(packet.claims.map((claim) => claim.id)).toEqual(
      credentialCloseoutClaimIds,
    )
    expect([
      ...new Set(
        packet.claims.flatMap((claim) =>
          claim.artifacts.map((artifact) => artifact.path),
        ),
      ),
    ]).toEqual(credentialCloseoutArtifactPaths)
    expect(packet.claims.every((claim) => claim.status === 'verified')).toBe(
      true,
    )
    expect(
      packet.claims.every((claim) => /^[0-9a-f]{64}$/.test(claim.sha256)),
    ).toBe(true)
  })

  it('matches the tracked canonical packet and scans all owned artifacts', () => {
    const report = verifyCredentialCloseoutPacket({ repoRoot })

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      claims: 11,
      artifacts: 8,
      scannedInputs: 11,
      liveEvidenceLevels: [],
    })
    expect(report.bytes).toBe(Buffer.byteLength(readFileSync(packetPath)))
    expect(report.sha256).toBe(
      createHash('sha256').update(readFileSync(packetPath)).digest('hex'),
    )
  })

  it.each([
    ['password field', '{"password":"do-not-print-password"}'],
    [
      'escaped password field',
      '{"pass\\u0077ord":"do-not-print-escaped-password"}',
    ],
    [
      'single-quoted password field',
      "{'password': 'do-not-print-single-quoted-password'}",
    ],
    [
      'nested password assignment',
      'Wrapper: password: do-not-print-nested-password',
    ],
    ['raw access token', 'access_token=do-not-print-access-token'],
    ['camel access token', 'accessToken: do-not-print-camel-access-token'],
    [
      'raw refresh token',
      'Set-Cookie: refresh_token=do-not-print-refresh-token; HttpOnly',
    ],
    ['wrapped key', '{"wrappedKey":"do-not-print-wrapped-key"}'],
    ['unwrapped key', '{"unwrapped_key":"do-not-print-unwrapped-key"}'],
    [
      'encrypted item body',
      '{"encryptedItemBody":"do-not-print-encrypted-item"}',
    ],
    ['identity payload', '{"identity":{"email":"person@example.dev"}}'],
    [
      'provider payload',
      '{"providerPayload":{"account":"do-not-print-provider"}}',
    ],
    ['profile payload', '{"profile":{"name":"do-not-print-profile"}}'],
    [
      'secret-like schema field',
      '{"properties":{"password":{"type":"string"}}}',
    ],
    [
      'authorization credential',
      'Authorization: Bearer do-not-print-bearer-token',
    ],
    [
      'JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkb250LXByaW50In0.c2lnbmF0dXJlLXZhbHVl',
    ],
    [
      'vault ciphertext',
      '2.dGhpc2lzMTZieXRlc2l2IQ==|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'private key',
      '-----BEGIN PRIVATE KEY-----\ndo-not-print-private-key\n-----END PRIVATE KEY-----',
    ],
    ['personal identity', 'Contact: person@real-company.dev'],
  ])('rejects %s without reflecting content', (_name, unsafeContent) => {
    let thrown: unknown
    try {
      assertCredentialCloseoutContentSafe(unsafeContent)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'credential closeout content is unsafe',
    )
    expect((thrown as Error).message).not.toContain(unsafeContent)
  })

  it.each([
    ['digest', `sha256: ${'a'.repeat(64)}`],
    ['version', 'client version: 2026.6.1'],
    ['count', 'artifact count: 8'],
    ['enum', 'evidence level: local_official_client'],
    [
      'repository path',
      'path: docs/release/account-password-change-local-evidence.md',
    ],
    ['source ref', `sourceRef: cli-v2026.6.0@${'b'.repeat(40)}`],
    [
      'limitation text',
      'Limitation: no raw passwords, access tokens, wrapped keys, identities, provider payloads, or profiles are included.',
    ],
    ['empty secret count', 'Real secrets: none'],
    ['reserved identity', 'Contact: operator@example.test'],
  ])('accepts approved %s metadata', (_name, safeContent) => {
    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
  })

  it('rejects stale, missing, untracked, extra, symlinked, and non-regular inputs', () => {
    const stale = createFixture()
    appendFileSync(
      join(stale.root, credentialCloseoutArtifactPaths[0]),
      '\ndrift\n',
    )
    expect(() => buildCredentialCloseoutPacket(stale.options)).toThrow()

    const missing = createFixture()
    unlinkSync(join(missing.root, credentialCloseoutArtifactPaths[0]))
    expect(() => buildCredentialCloseoutPacket(missing.options)).toThrow()

    const untracked = createFixture()
    expect(() =>
      buildCredentialCloseoutPacket({
        ...untracked.options,
        trackedPaths: untracked.options.trackedPaths.filter(
          (path) => path !== credentialCloseoutArtifactPaths[0],
        ),
      }),
    ).toThrow()

    const extra = createFixture()
    expect(() =>
      scanCredentialCloseoutArtifacts({
        ...extra.options,
        artifactPaths: [...credentialCloseoutArtifactPaths, 'extra.md'],
      }),
    ).toThrow(/artifact set is not canonical/)

    const escaped = createFixture()
    const outsideRoot = mkdtempSync(
      join(tmpdir(), 'credential-closeout-outside-'),
    )
    temporaryRoots.push(outsideRoot)
    const outsideRegistry = join(outsideRoot, 'registry.json')
    copyFileSync(escaped.options.registryPath, outsideRegistry)
    expect(() =>
      buildCredentialCloseoutPacket({
        ...escaped.options,
        registryPath: outsideRegistry,
      }),
    ).toThrow(/input path is not canonical/)

    const symlinked = createFixture()
    const symlinkPath = join(symlinked.root, credentialCloseoutArtifactPaths[0])
    const symlinkTarget = join(symlinked.root, 'outside.md')
    writeFileSync(symlinkTarget, readFileSync(symlinkPath))
    unlinkSync(symlinkPath)
    symlinkSync(symlinkTarget, symlinkPath)
    expect(() => buildCredentialCloseoutPacket(symlinked.options)).toThrow()

    const nonRegular = createFixture()
    const directoryPath = join(
      nonRegular.root,
      credentialCloseoutArtifactPaths[0],
    )
    unlinkSync(directoryPath)
    mkdirSync(directoryPath)
    expect(() => buildCredentialCloseoutPacket(nonRegular.options)).toThrow()
  })

  it('scans artifact bytes independently of their digest rejection', () => {
    const fixture = createFixture()
    const secret = 'do-not-print-artifact-password'
    appendFileSync(
      join(fixture.root, credentialCloseoutArtifactPaths[0]),
      `\n{"password":"${secret}"}\n`,
    )

    let thrown: unknown
    try {
      scanCredentialCloseoutArtifacts(fixture.options)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'credential closeout content is unsafe',
    )
    expect((thrown as Error).message).not.toContain(secret)
  })

  it('rejects stale or noncanonical packet bytes and unsafe packet paths', () => {
    const nondeterministic = createFixture({ includePacket: true })
    const packet = buildCredentialCloseoutPacket(
      nondeterministic.options,
    ) as Packet & { generatedAt?: string }
    packet.generatedAt = '2026-07-22T00:00:00Z'
    writeFileSync(
      nondeterministic.packetPath,
      `${JSON.stringify(packet, null, 2)}\n`,
    )
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...nondeterministic.options,
        packetPath: nondeterministic.packetPath,
      }),
    ).toThrow(/packet is stale or noncanonical/)

    const duplicate = createFixture({ includePacket: true })
    const duplicateText = readFileSync(duplicate.packetPath, 'utf8').replace(
      '  "schemaVersion": 1,',
      '  "schemaVersion": 1,\n  "schemaVersion": 1,',
    )
    writeFileSync(duplicate.packetPath, duplicateText)
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...duplicate.options,
        packetPath: duplicate.packetPath,
      }),
    ).toThrow(/packet JSON is invalid/)

    const reformatted = createFixture({ includePacket: true })
    writeFileSync(
      reformatted.packetPath,
      `${JSON.stringify(buildCredentialCloseoutPacket(reformatted.options))}\n`,
    )
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...reformatted.options,
        packetPath: reformatted.packetPath,
      }),
    ).toThrow(/packet is stale or noncanonical/)

    const symlinked = createFixture({ includePacket: true })
    const target = join(symlinked.root, 'outside-packet.json')
    copyFileSync(symlinked.packetPath, target)
    unlinkSync(symlinked.packetPath)
    symlinkSync(target, symlinked.packetPath)
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...symlinked.options,
        packetPath: symlinked.packetPath,
      }),
    ).toThrow(/packet path is unsafe/)
  })

  it('accepts an equivalent CRLF checkout but rejects lone CR bytes', () => {
    const fixture = createFixture({ includePacket: true })
    const canonical = readFileSync(fixture.packetPath, 'utf8')
    writeFileSync(fixture.packetPath, canonical.replaceAll('\n', '\r\n'))

    expect(
      verifyCredentialCloseoutPacket({
        ...fixture.options,
        packetPath: fixture.packetPath,
      }),
    ).toMatchObject({ status: 'passed' })

    writeFileSync(fixture.packetPath, canonical.replace('\n', '\r'))
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...fixture.options,
        packetPath: fixture.packetPath,
      }),
    ).toThrow(/unsupported line endings/)
  })

  it('publishes atomically with stable bytes and rejects a symlink output', () => {
    const fixture = createFixture()
    const first = writeCredentialCloseoutPacket(fixture.options)
    const firstBytes = readFileSync(fixture.packetPath)
    const second = writeCredentialCloseoutPacket(fixture.options)
    const secondBytes = readFileSync(fixture.packetPath)

    expect(first).toEqual(second)
    expect(firstBytes.equals(secondBytes)).toBe(true)
    expect(first.sha256).toBe(
      createHash('sha256').update(firstBytes).digest('hex'),
    )
    expect(statSync(fixture.packetPath).mode & 0o777).toBe(0o644)
    expect(
      readdirSync(dirname(fixture.packetPath)).filter((name) =>
        name.endsWith('.tmp'),
      ),
    ).toEqual([])

    const symlinked = createFixture()
    const target = join(symlinked.root, 'outside-packet.json')
    const sentinel = 'target-must-not-change\n'
    writeFileSync(target, sentinel)
    mkdirSync(dirname(symlinked.packetPath), { recursive: true })
    symlinkSync(target, symlinked.packetPath)

    expect(() => writeCredentialCloseoutPacket(symlinked.options)).toThrow(
      /packet path is unsafe/,
    )
    expect(readFileSync(target, 'utf8')).toBe(sentinel)
  })

  it('prints only a bounded verification report from the CLI', async () => {
    const secretValues = [
      'do-not-print-password-env',
      'do-not-print-access-token-env',
      'do-not-print-provider-payload-env',
    ]
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HONOWARDEN_TEST_PASSWORD: secretValues[0],
        HONOWARDEN_TEST_ACCESS_TOKEN: secretValues[1],
        HONOWARDEN_TEST_PROVIDER_PAYLOAD: secretValues[2],
      },
    })
    const report = JSON.parse(result.stdout)

    expect(result.stderr).toBe('')
    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      claims: 11,
      artifacts: 8,
      scannedInputs: 11,
      liveEvidenceLevels: [],
    })
    expect(Object.keys(report)).toEqual([
      'schemaVersion',
      'status',
      'claims',
      'artifacts',
      'scannedInputs',
      'bytes',
      'sha256',
      'liveEvidenceLevels',
      'limitations',
    ])
    for (const secret of secretValues) {
      expect(result.stdout).not.toContain(secret)
    }
  })

  it('prints a fixed non-disclosing CLI failure', async () => {
    const secret = 'do-not-print-unknown-option'
    let rejected: (Error & { stdout?: string; stderr?: string }) | undefined
    try {
      await execFileAsync(process.execPath, [scriptPath, `--${secret}`], {
        cwd: repoRoot,
      })
    } catch (error) {
      rejected = error as Error & { stdout?: string; stderr?: string }
    }

    expect(rejected).toBeDefined()
    expect(rejected?.stdout).toBe('')
    expect(rejected?.stderr).toBe('credential closeout verification failed\n')
    expect(rejected?.stderr).not.toContain(secret)
  })
})

type Packet = {
  schemaVersion: number
  status: string
  registry: Record<string, unknown>
  sourcePins: {
    programBaseCommit: string
    clients: Array<Record<string, unknown>>
  }
  evidenceLevels: Array<{
    id: string
    rank: number
    scope: string
  }>
  claims: Array<{
    id: string
    status: string
    executionLevel: string
    evidenceLevel: string
    sourceGeneration: { kind: string; commit: string }
    artifacts: Array<{
      path: string
      evidenceLevel: string
      sha256: string
    }>
    clientSourceIds: string[]
    limitations: string[]
    sha256: string
  }>
  counts: Record<string, number>
  liveEvidenceLevels: string[]
  limitations: string[]
}

function sameKeys(value: object, expected: string[]) {
  return JSON.stringify(Object.keys(value)) === JSON.stringify(expected)
}

function createFixture({ includePacket = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'credential-closeout-'))
  temporaryRoots.push(root)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    claims: Array<{ artifacts: Array<{ path: string }> }>
  }
  const paths = [
    'compat/credential-evidence.json',
    'compat/credential-evidence.schema.json',
    ...new Set(
      registry.claims.flatMap((claim) =>
        claim.artifacts.map((artifact) => artifact.path),
      ),
    ),
  ]
  for (const path of paths) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(repoRoot, path), target)
  }
  const options = {
    repoRoot: root,
    registryPath: join(root, 'compat/credential-evidence.json'),
    schemaPath: join(root, 'compat/credential-evidence.schema.json'),
    trackedPaths: paths,
  }
  const fixturePacketPath = join(root, credentialCloseoutPacketPath)
  if (includePacket) {
    mkdirSync(dirname(fixturePacketPath), { recursive: true })
    writeFileSync(
      fixturePacketPath,
      serializeCredentialCloseoutPacket(buildCredentialCloseoutPacket(options)),
    )
  }
  return { root, options, packetPath: fixturePacketPath }
}
