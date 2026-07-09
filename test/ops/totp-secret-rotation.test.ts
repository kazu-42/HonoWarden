import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { encryptTotpSecret } from '../../src/domain/totp-secret'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const rotationScript = join(
  repoRoot,
  'scripts/honowarden-totp-secret-rotation.mjs',
)

type RotationPacket = {
  schemaVersion: number
  status: 'ready' | 'not_ready'
  blockingReason: string | null
  strategy: 'rewrap' | 'force-reenrollment'
  executed: boolean
  summary: {
    totalRows: number
    decryptableActiveRows: number
    decryptablePendingRows: number
    corruptActiveRows: number
    corruptPendingRows: number
    plannedUpdates: number
    plannedForceReenrollments: number
  }
  audit: {
    containsPlaintextSecrets: boolean
    containsEncryptedSecrets: boolean
  }
  executions?: Array<{
    exitCode: number
    command: string[]
  }>
}

describe('TOTP secret rotation operator CLI', () => {
  it('dry-runs rewrap without printing plaintext or encrypted TOTP secrets', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const pendingSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXY'
    const rows = [
      {
        userId: 'user-1',
        encryptedSecret: await encryptTotpSecret('old-wrapper', secret),
        pendingEncryptedSecret: null,
        enabled: 1,
      },
      {
        userId: 'user-2',
        encryptedSecret: await encryptTotpSecret('old-wrapper', secret),
        pendingEncryptedSecret: await encryptTotpSecret(
          'old-wrapper',
          pendingSecret,
        ),
        enabled: 1,
      },
    ]
    const inputFile = await writeRowsFile(rows)

    const result = await execFileAsync(
      'node',
      [
        rotationScript,
        '--database',
        'honowarden',
        '--input-file',
        inputFile,
        '--reason',
        'planned-rotation',
        '--old-secret-env',
        'OLD_TOTP_SECRET',
        '--new-secret-env',
        'NEW_TOTP_SECRET',
        '--at',
        '2026-07-09T17:00:00.000Z',
      ],
      {
        env: {
          ...process.env,
          OLD_TOTP_SECRET: 'old-wrapper',
          NEW_TOTP_SECRET: 'new-wrapper',
        },
      },
    )
    const packet = JSON.parse(result.stdout) as RotationPacket

    expect(packet).toMatchObject({
      schemaVersion: 1,
      status: 'ready',
      blockingReason: null,
      strategy: 'rewrap',
      executed: false,
      summary: {
        totalRows: 2,
        decryptableActiveRows: 2,
        decryptablePendingRows: 1,
        corruptActiveRows: 0,
        corruptPendingRows: 0,
        plannedUpdates: 2,
      },
      audit: {
        containsPlaintextSecrets: false,
        containsEncryptedSecrets: false,
      },
    })
    expect(result.stdout).not.toContain(secret)
    expect(result.stdout).not.toContain(pendingSecret)
    expect(result.stdout).not.toContain(rows[0]?.encryptedSecret)
    expect(result.stdout).not.toContain('old-wrapper')
    expect(result.stdout).not.toContain('new-wrapper')
  })

  it('fails closed when required rewrap secret env vars are missing', async () => {
    const inputFile = await writeRowsFile([])

    await expect(
      execFileAsync('node', [
        rotationScript,
        '--database',
        'honowarden',
        '--input-file',
        inputFile,
        '--reason',
        'planned-rotation',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('HONOWARDEN_TOTP_OLD_SECRET is required'),
    })
  })

  it('reports corrupt envelopes without attempting to decrypt into logs', async () => {
    const inputFile = await writeRowsFile([
      {
        userId: 'user-1',
        encryptedSecret: 'corrupt-envelope',
        pendingEncryptedSecret: null,
        enabled: 1,
      },
    ])

    const result = await execFileAsync(
      'node',
      [
        rotationScript,
        '--database',
        'honowarden',
        '--input-file',
        inputFile,
        '--reason',
        'planned-rotation',
        '--old-secret-env',
        'OLD_TOTP_SECRET',
        '--new-secret-env',
        'NEW_TOTP_SECRET',
      ],
      {
        env: {
          ...process.env,
          OLD_TOTP_SECRET: 'old-wrapper',
          NEW_TOTP_SECRET: 'new-wrapper',
        },
      },
    )
    const packet = JSON.parse(result.stdout) as RotationPacket

    expect(packet).toMatchObject({
      status: 'not_ready',
      blockingReason: 'corrupt_envelope',
      summary: {
        totalRows: 1,
        decryptableActiveRows: 0,
        corruptActiveRows: 1,
        plannedUpdates: 0,
      },
    })
    expect(result.stdout).not.toContain('old-wrapper')
    expect(result.stdout).not.toContain('new-wrapper')
  })

  it('keeps strict not-ready output free of internal mutation plans', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const rows = [
      {
        userId: 'user-1',
        encryptedSecret: await encryptTotpSecret('old-wrapper', secret),
        pendingEncryptedSecret: null,
        enabled: 1,
      },
      {
        userId: 'user-2',
        encryptedSecret: 'corrupt-envelope',
        pendingEncryptedSecret: null,
        enabled: 1,
      },
    ]
    const inputFile = await writeRowsFile(rows)

    let result: {
      code: number
      stdout: string
      stderr: string
    } | null = null
    try {
      await execFileAsync(
        'node',
        [
          rotationScript,
          '--database',
          'honowarden',
          '--input-file',
          inputFile,
          '--reason',
          'planned-rotation',
          '--old-secret-env',
          'OLD_TOTP_SECRET',
          '--new-secret-env',
          'NEW_TOTP_SECRET',
          '--strict',
        ],
        {
          env: {
            ...process.env,
            OLD_TOTP_SECRET: 'old-wrapper',
            NEW_TOTP_SECRET: 'new-wrapper',
          },
        },
      )
    } catch (error) {
      result = error as {
        code: number
        stdout: string
        stderr: string
      }
    }

    if (result === null) {
      throw new Error('Expected strict rotation dry-run to fail')
    }
    const packet = JSON.parse(result.stdout) as RotationPacket

    expect(result.code).toBe(1)
    expect(packet).toMatchObject({
      status: 'not_ready',
      blockingReason: 'corrupt_envelope',
      summary: {
        totalRows: 2,
        decryptableActiveRows: 1,
        corruptActiveRows: 1,
        plannedUpdates: 1,
      },
    })
    expect(result.stdout).not.toContain('mutationPlans')
    expect(result.stdout).not.toContain(secret)
    expect(result.stdout).not.toContain(rows[0]?.encryptedSecret)
    expect(result.stdout).not.toContain('corrupt-envelope')
    expect(result.stdout).not.toContain('old-wrapper')
    expect(result.stdout).not.toContain('new-wrapper')
  })

  it('executes guarded rewrap updates through wrangler with redacted evidence', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const rows = [
      {
        userId: 'user-1',
        encryptedSecret: await encryptTotpSecret('old-wrapper', secret),
        pendingEncryptedSecret: null,
        enabled: 1,
      },
    ]
    const fakeBin = await createFakeWranglerBin(rows)

    const result = await execFileAsync(
      'node',
      [
        rotationScript,
        '--database',
        'honowarden',
        '--reason',
        'planned-rotation',
        '--old-secret-env',
        'OLD_TOTP_SECRET',
        '--new-secret-env',
        'NEW_TOTP_SECRET',
        '--execute',
        '--confirm',
        'honowarden:rewrap',
        '--at',
        '2026-07-09T17:00:00.000Z',
      ],
      {
        env: {
          ...process.env,
          OLD_TOTP_SECRET: 'old-wrapper',
          NEW_TOTP_SECRET: 'new-wrapper',
          HONOWARDEN_TEST_WRANGLER_LOG: fakeBin.logPath,
          PATH: `${fakeBin.path}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    )
    const packet = JSON.parse(result.stdout) as RotationPacket
    const wranglerLog = await readFile(fakeBin.logPath, 'utf8')

    expect(packet.executed).toBe(true)
    expect(packet.executions).toHaveLength(1)
    expect(packet.executions?.[0]?.command).toContain('[redacted SQL]')
    expect(wranglerLog).toContain('UPDATE user_totp')
    expect(result.stdout).not.toContain(secret)
    expect(result.stdout).not.toContain(rows[0]?.encryptedSecret)
    expect(result.stdout).not.toContain('old-wrapper')
    expect(result.stdout).not.toContain('new-wrapper')
  })

  it('does not echo mutation SQL when wrangler execution fails', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const rows = [
      {
        userId: 'user-1',
        encryptedSecret: await encryptTotpSecret('old-wrapper', secret),
        pendingEncryptedSecret: null,
        enabled: 1,
      },
    ]
    const fakeBin = await createFakeWranglerBin(rows, {
      failMutations: true,
    })

    let result: {
      code: number
      stdout: string
      stderr: string
    } | null = null
    try {
      await execFileAsync(
        'node',
        [
          rotationScript,
          '--database',
          'honowarden',
          '--reason',
          'planned-rotation',
          '--old-secret-env',
          'OLD_TOTP_SECRET',
          '--new-secret-env',
          'NEW_TOTP_SECRET',
          '--execute',
          '--confirm',
          'honowarden:rewrap',
          '--at',
          '2026-07-09T17:00:00.000Z',
        ],
        {
          env: {
            ...process.env,
            OLD_TOTP_SECRET: 'old-wrapper',
            NEW_TOTP_SECRET: 'new-wrapper',
            HONOWARDEN_TEST_WRANGLER_LOG: fakeBin.logPath,
            PATH: `${fakeBin.path}${delimiter}${process.env.PATH ?? ''}`,
          },
        },
      )
    } catch (error) {
      result = error as {
        code: number
        stdout: string
        stderr: string
      }
    }

    if (result === null) {
      throw new Error('Expected guarded rewrap execution to fail')
    }

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('TOTP rotation mutation 1 failed')
    expect(result.stderr).not.toContain('UPDATE user_totp')
    expect(result.stderr).not.toContain(secret)
    expect(result.stderr).not.toContain(rows[0]?.encryptedSecret)
    expect(result.stderr).not.toContain('old-wrapper')
    expect(result.stderr).not.toContain('new-wrapper')
  })

  it('plans force re-enrollment without old or new wrapping secrets', async () => {
    const inputFile = await writeRowsFile([
      {
        userId: 'user-1',
        encryptedSecret: 'unreadable-but-not-needed',
        pendingEncryptedSecret: null,
        enabled: 1,
      },
    ])

    const result = await execFileAsync('node', [
      rotationScript,
      '--database',
      'honowarden',
      '--input-file',
      inputFile,
      '--strategy',
      'force-reenrollment',
      '--reason',
      'old-secret-lost',
    ])
    const packet = JSON.parse(result.stdout) as RotationPacket

    expect(packet).toMatchObject({
      status: 'ready',
      strategy: 'force-reenrollment',
      summary: {
        totalRows: 1,
        plannedUpdates: 0,
        plannedForceReenrollments: 1,
      },
    })
    expect(result.stdout).not.toContain('unreadable-but-not-needed')
  })
})

async function writeRowsFile(rows: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'honowarden-totp-rotation-'))
  const path = join(dir, 'rows.json')
  await writeFile(path, JSON.stringify(rows), 'utf8')

  return path
}

async function createFakeWranglerBin(
  rows: unknown[],
  options: {
    failMutations?: boolean
  } = {},
): Promise<{
  logPath: string
  path: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'honowarden-fake-wrangler-'))
  const wranglerPath = join(dir, 'wrangler')
  const logPath = join(dir, 'wrangler.log')

  await writeFile(
    wranglerPath,
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
const commandIndex = args.indexOf('--command')
const sql = commandIndex === -1 ? '' : args[commandIndex + 1]
if (sql.includes('SELECT')) {
  process.stdout.write(JSON.stringify([{ results: ${JSON.stringify(rows)} }]))
  process.exit(0)
}
if (${JSON.stringify(options.failMutations === true)}) {
  process.stderr.write(sql)
  process.exit(1)
}
appendFileSync(process.env.HONOWARDEN_TEST_WRANGLER_LOG, sql + '\\n')
process.stdout.write(JSON.stringify([{ success: true, meta: { changes: 1 } }]))
`,
    'utf8',
  )
  await chmod(wranglerPath, 0o755)

  return { logPath, path: dir }
}
