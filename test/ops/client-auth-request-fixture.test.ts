import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const script = join(repoRoot, 'scripts/honowarden-client-auth-fixture.mjs')

describe('official-client auth-request fixture CLI', () => {
  it('plans a staging seed without exposing fixture credentials or key material', async () => {
    const fixture = await writeFixture()
    const result = await execFileAsync('node', [
      script,
      'seed',
      '--fixture',
      fixture,
      '--at',
      '2026-07-11T01:00:00.000Z',
    ])
    const packet = JSON.parse(result.stdout) as Record<string, unknown>

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'seed',
      environment: 'staging',
      database: 'honowarden-staging',
      executed: false,
      status: 'ready',
      fixture: {
        sourceValidated: true,
        containsRealData: false,
      },
      next: {
        confirmation: 'staging-fixture',
      },
    })
    expect(String(packet.targetTag)).toMatch(/^sha256:[a-f0-9]{64}$/)
    for (const secret of fixtureSecrets) {
      expect(result.stdout).not.toContain(secret)
      expect(result.stderr).not.toContain(secret)
    }
  })

  it('requires exact confirmation before any mutation', async () => {
    const fixture = await writeFixture()

    await expect(
      execFileAsync('node', [
        script,
        'seed',
        '--fixture',
        fixture,
        '--execute',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('--confirm staging-fixture is required'),
    })
  })

  it('rejects production and fixture files outside ignored test storage', async () => {
    const outside = join(
      await mkdtemp(join(tmpdir(), 'honowarden-fixture-')),
      'fixture.json',
    )
    await writeFile(outside, JSON.stringify(buildFixture()))

    await expect(
      execFileAsync('node', [script, 'seed', '--fixture', outside]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('fixture must be inside test/.tmp'),
    })

    const fixture = await writeFixture()
    await expect(
      execFileAsync('node', [
        script,
        'seed',
        '--fixture',
        fixture,
        '--env',
        'production',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('only staging is supported'),
    })
  })

  it('rejects symlink escapes and fixture files with broad permissions', async () => {
    const outside = join(
      await mkdtemp(join(tmpdir(), 'honowarden-fixture-symlink-')),
      'fixture.json',
    )
    await writeFile(outside, JSON.stringify(buildFixture()), { mode: 0o600 })
    const insideDirectory = join(
      repoRoot,
      'test/.tmp',
      `client-auth-fixture-link-${crypto.randomUUID()}`,
    )
    await mkdir(insideDirectory, { recursive: true })
    const link = join(insideDirectory, 'synthetic-account.json')
    await symlink(outside, link)

    await expect(
      execFileAsync('node', [script, 'seed', '--fixture', link]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('fixture must resolve inside test/.tmp'),
    })

    const fixture = await writeFixture()
    await chmod(fixture, 0o644)
    await expect(
      execFileAsync('node', [script, 'seed', '--fixture', fixture]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'fixture permissions must be 0600 or stricter',
      ),
    })
  })

  it('copies a selected credential without printing it', async () => {
    const fixture = await writeFixture()
    const tools = await createFakeTools()
    const result = await execFileAsync(
      'node',
      [
        script,
        'clipboard',
        '--field',
        'password',
        '--fixture',
        fixture,
        '--execute',
        '--confirm',
        'staging-fixture',
      ],
      {
        env: {
          ...process.env,
          PATH: `${tools.bin}${delimiter}${process.env.PATH}`,
        },
      },
    )

    expect(JSON.parse(result.stdout)).toMatchObject({
      action: 'clipboard',
      executed: true,
      clipboardField: 'password',
    })
    expect(await readFile(tools.clipboard, 'utf8')).toBe('synthetic-password')
    expect(result.stdout).not.toContain('synthetic-password')
  })

  it('returns secret-safe status counts and cleanup readback', async () => {
    const fixture = await writeFixture()
    const tools = await createFakeTools()
    const env = {
      ...process.env,
      PATH: `${tools.bin}${delimiter}${process.env.PATH}`,
      NODE_OPTIONS: tools.nodeOptions,
      CLOUDFLARE_ACCOUNT_ID: 'test-account',
      CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN: 'test-d1-token',
      HONOWARDEN_FIXTURE_FAKE_STATUS: '1',
    }

    const status = await execFileAsync(
      'node',
      [
        script,
        'status',
        '--fixture',
        fixture,
        '--execute',
        '--confirm',
        'staging-fixture',
      ],
      { env },
    )
    expect(JSON.parse(status.stdout)).toMatchObject({
      executed: true,
      status: 'ready',
      readback: {
        users: 1,
        devices: 2,
        refreshTokens: 1,
        authRequests: 1,
        foreignKeyViolations: 0,
      },
    })

    const cleanup = await execFileAsync(
      'node',
      [
        script,
        'cleanup',
        '--fixture',
        fixture,
        '--execute',
        '--confirm',
        'staging-fixture',
      ],
      {
        env: {
          ...env,
          HONOWARDEN_FIXTURE_FAKE_STATUS: '0',
        },
      },
    )
    expect(JSON.parse(cleanup.stdout)).toMatchObject({
      executed: true,
      status: 'clean',
      readback: {
        users: 0,
        devices: 0,
        refreshTokens: 0,
        authRequests: 0,
        orphanDevices: 0,
        foreignKeyViolations: 0,
      },
    })
    expect(await readFile(tools.clipboard, 'utf8')).toBe('')
    for (const secret of fixtureSecrets) {
      expect(cleanup.stdout).not.toContain(secret)
    }
  })

  it('fails closed on malformed D1 counts and clears the clipboard on cleanup failure', async () => {
    const fixture = await writeFixture()
    const tools = await createFakeTools()
    const baseEnv = {
      ...process.env,
      PATH: `${tools.bin}${delimiter}${process.env.PATH}`,
      NODE_OPTIONS: tools.nodeOptions,
      CLOUDFLARE_ACCOUNT_ID: 'test-account',
      CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN: 'test-d1-token',
    }

    await expect(
      execFileAsync(
        'node',
        [
          script,
          'status',
          '--fixture',
          fixture,
          '--execute',
          '--confirm',
          'staging-fixture',
        ],
        {
          env: {
            ...baseEnv,
            HONOWARDEN_FIXTURE_FAKE_INVALID_STATUS: '1',
          },
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('users count was invalid'),
    })

    await writeFile(tools.clipboard, 'stale-sensitive-value')
    let failure: { stderr?: string } | null = null
    try {
      await execFileAsync(
        'node',
        [
          script,
          'cleanup',
          '--fixture',
          fixture,
          '--execute',
          '--confirm',
          'staging-fixture',
        ],
        {
          env: {
            ...baseEnv,
            HONOWARDEN_FIXTURE_FAKE_FAILURE: '1',
          },
        },
      )
    } catch (error) {
      failure = error as { stderr?: string }
    }
    expect(failure?.stderr).toContain('staging fixture D1 operation failed')
    expect(failure?.stderr).not.toContain('synthetic-password')
    expect(await readFile(tools.clipboard, 'utf8')).toBe('')
  })

  it('documents the package command and remaining human UI boundary', () => {
    const packageJson = readRepoFile('package.json')
    const runbook = readRepoFile(
      'docs/operations/official-client-auth-request-evidence.md',
    )

    expect(packageJson).toContain('"client:auth-fixture"')
    expect(runbook).toContain('dry-run by default')
    expect(runbook).toContain('--confirm staging-fixture')
    expect(runbook).toContain('official Desktop')
    expect(runbook).toContain('official browser extension')
    expect(runbook).toMatch(/never\s+prints\s+the\s+email\s+or\s+password/)
    expect(runbook).toMatch(/polling\s+remains\s+authoritative/i)
  })
})

const fixtureSecrets = [
  'person@example.test',
  'synthetic-password',
  'synthetic-master-password-hash',
  '2.synthetic-user-key',
  'synthetic-public-key',
  '2.synthetic-private-key',
]

async function writeFixture(): Promise<string> {
  const directory = join(
    repoRoot,
    'test/.tmp',
    `client-auth-fixture-${crypto.randomUUID()}`,
  )
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'synthetic-account.json')
  await writeFile(path, JSON.stringify(buildFixture()), { mode: 0o600 })
  return path
}

function buildFixture() {
  return {
    generatedAt: '2026-07-11T00:00:00.000Z',
    source: {
      cliReleaseTag: 'cli-v2026.6.0',
      cliNpmBuildSha256: 'a'.repeat(64),
    },
    account: {
      email: 'person@example.test',
      password: 'synthetic-password',
      displayName: 'Synthetic Official Client',
      kdf: { pBKDF2: { iterations: 600000 } },
      bootstrapPayload: {
        email: 'person@example.test',
        displayName: 'Synthetic Official Client',
        masterPasswordHash: 'synthetic-master-password-hash',
        userKey: '2.synthetic-user-key',
        publicKey: 'synthetic-public-key',
        privateKey: '2.synthetic-private-key',
      },
    },
    verification: {
      wrappedUserKeyDecryptsWithMasterPassword: true,
      wrappedPrivateKeyDecryptsWithUserKey: true,
    },
  }
}

async function createFakeTools() {
  const root = await mkdtemp(join(tmpdir(), 'honowarden-fixture-tools-'))
  const bin = join(root, 'bin')
  const clipboard = join(root, 'clipboard.txt')
  const fetchPreload = join(root, 'fetch-preload.mjs')
  await mkdir(bin)
  await writeFile(
    join(bin, 'pbcopy'),
    `#!/bin/sh\ncat > ${JSON.stringify(clipboard)}\n`,
  )
  await chmod(join(bin, 'pbcopy'), 0o755)
  await writeFile(
    join(bin, 'pnpm'),
    `#!/bin/sh
if [ "$HONOWARDEN_FIXTURE_FAKE_FAILURE" = "1" ]; then
  printf '%s' 'synthetic-password' >&2
  exit 19
elif [ "$HONOWARDEN_FIXTURE_FAKE_INVALID_STATUS" = "1" ]; then
  printf '%s' '[{"results":[{"users":"invalid","devices":0,"refresh_tokens":0,"auth_requests":0,"orphan_devices":0,"foreign_key_violations":0}],"success":true}]'
elif [ "$HONOWARDEN_FIXTURE_FAKE_STATUS" = "1" ]; then
  printf '%s' '[{"results":[{"users":1,"devices":2,"refresh_tokens":1,"auth_requests":1,"orphan_devices":0,"foreign_key_violations":0}],"success":true}]'
else
  printf '%s' '[{"results":[{"users":0,"devices":0,"refresh_tokens":0,"auth_requests":0,"orphan_devices":0,"foreign_key_violations":0}],"success":true}]'
fi
`,
  )
  await chmod(join(bin, 'pnpm'), 0o755)
  await writeFile(
    fetchPreload,
    `globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/test-account/d1/database/')) {
    throw new Error('unexpected D1 endpoint')
  }
  if (options?.headers?.Authorization !== 'Bearer test-d1-token') {
    throw new Error('unexpected D1 authorization')
  }
  const request = JSON.parse(String(options?.body ?? '{}'))
  if (!Array.isArray(request.params) || request.params.length !== 1) {
    throw new Error('expected parameterized D1 query')
  }
  const invalid = process.env.HONOWARDEN_FIXTURE_FAKE_INVALID_STATUS === '1'
  const populated = process.env.HONOWARDEN_FIXTURE_FAKE_STATUS === '1'
  const row = {
    users: invalid ? 'invalid' : populated ? 1 : 0,
    devices: populated ? 2 : 0,
    refresh_tokens: populated ? 1 : 0,
    auth_requests: populated ? 1 : 0,
    orphan_devices: 0,
    foreign_key_violations: 0,
  }
  return {
    ok: true,
    json: async () => ({
      success: true,
      result: [{ success: true, results: [row] }],
    }),
  }
}
`,
  )
  const existingNodeOptions = process.env.NODE_OPTIONS?.trim()
  const importOption = `--import=${pathToFileURL(fetchPreload).href}`
  return {
    bin,
    clipboard,
    nodeOptions: existingNodeOptions
      ? `${existingNodeOptions} ${importOption}`
      : importOption,
  }
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}
