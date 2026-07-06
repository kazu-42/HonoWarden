import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const backupScript = join(repoRoot, 'scripts/honowarden-backup.mjs')

describe('backup CLI', () => {
  it('plans a local D1 and R2 export with a manifest', async () => {
    const workDir = await fixtureDir('export')
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    await writeFile(
      objectList,
      ['attachments/object-one', '# ignored comment', 'nested/object-two'].join(
        '\n',
      ),
    )

    const result = await execFileAsync('node', [
      backupScript,
      'export',
      '--out',
      outDir,
      '--database',
      'honowarden',
      '--bucket',
      'honowarden-vault-objects',
      '--mode',
      'local',
      '--r2-objects',
      objectList,
    ])
    const output = JSON.parse(result.stdout) as {
      executed: boolean
      commands: string[][]
    }
    const manifest = JSON.parse(
      await readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
    ) as {
      database: string
      bucket: string
      r2: {
        objects: Array<{ key: string; file: string }>
      }
    }

    expect(output.executed).toBe(false)
    expect(manifest.database).toBe('honowarden')
    expect(manifest.bucket).toBe('honowarden-vault-objects')
    expect(manifest.r2.objects.map((object) => object.key)).toEqual([
      'attachments/object-one',
      'nested/object-two',
    ])
    expect(
      manifest.r2.objects.every((object) => object.file.startsWith('r2/')),
    ).toBe(true)
    expect(output.commands[0]).toEqual([
      'wrangler',
      'd1',
      'export',
      'honowarden',
      '--local',
      '--output',
      join(outDir, 'd1.sql'),
      '--skip-confirmation',
    ])
    expect(output.commands[1]).toEqual([
      'wrangler',
      'r2',
      'object',
      'get',
      'honowarden-vault-objects/attachments/object-one',
      '--local',
      '--file',
      join(outDir, manifest.r2.objects[0]?.file ?? ''),
    ])
  })

  it('only applies local persistence flags to commands that support them', async () => {
    const workDir = await fixtureDir('export-flags')
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    const persistDir = join(workDir, 'persist')
    await writeFile(objectList, 'attachments/object-one\n')

    const result = await execFileAsync('node', [
      backupScript,
      'export',
      '--out',
      outDir,
      '--database',
      'honowarden',
      '--bucket',
      'honowarden-vault-objects',
      '--mode',
      'local',
      '--env',
      'staging',
      '--persist-to',
      persistDir,
      '--r2-objects',
      objectList,
    ])
    const output = JSON.parse(result.stdout) as {
      commands: string[][]
    }

    expect(output.commands[0]).toEqual([
      'wrangler',
      'd1',
      'export',
      'honowarden',
      '--local',
      '--output',
      join(outDir, 'd1.sql'),
      '--skip-confirmation',
      '--env',
      'staging',
    ])
    expect(output.commands[1]).toContain('--persist-to')
    expect(output.commands[1]).toContain(persistDir)
  })

  it('plans a local restore from a backup manifest into new resources', async () => {
    const workDir = await fixtureDir('restore')
    const fromDir = join(workDir, 'backup')
    await mkdir(fromDir, { recursive: true })
    await writeFile(
      join(fromDir, 'backup-manifest.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: '2026-07-06T00:00:00.000Z',
          mode: 'local',
          database: 'honowarden',
          bucket: 'honowarden-vault-objects',
          d1: {
            file: 'd1.sql',
          },
          r2: {
            objectListRequired: true,
            objects: [
              {
                key: 'attachments/object-one',
                file: 'r2/object-one',
              },
            ],
          },
          restore: {
            command: 'node scripts/honowarden-backup.mjs restore',
          },
          commands: [],
        },
        null,
        2,
      ),
    )

    const result = await execFileAsync('node', [
      backupScript,
      'restore',
      '--from',
      fromDir,
      '--database',
      'fresh-honowarden',
      '--bucket',
      'fresh-honowarden-vault-objects',
      '--mode',
      'local',
    ])
    const output = JSON.parse(result.stdout) as {
      executed: boolean
      commands: string[][]
    }

    expect(output.executed).toBe(false)
    expect(output.commands).toEqual([
      [
        'wrangler',
        'd1',
        'execute',
        'fresh-honowarden',
        '--local',
        '--file',
        join(fromDir, 'd1.sql'),
        '--yes',
      ],
      [
        'wrangler',
        'r2',
        'object',
        'put',
        'fresh-honowarden-vault-objects/attachments/object-one',
        '--local',
        '--file',
        join(fromDir, 'r2/object-one'),
      ],
    ])
  })

  it('requires explicit fresh-target confirmation before restore execution', async () => {
    const workDir = await fixtureDir('restore-confirm-target')
    const fromDir = join(workDir, 'backup')
    await writeSafeBackupFixture(fromDir, {
      d1Sha256: await sha256('create table users(id text);\n'),
      objectSha256: await sha256('object-body'),
    })

    await expect(
      execFileAsync('node', [
        backupScript,
        'restore',
        '--from',
        fromDir,
        '--execute',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('--confirm-fresh-target is required'),
    })
  })

  it('rejects restore execution when manifest checksums do not match files', async () => {
    const workDir = await fixtureDir('restore-checksum')
    const fromDir = join(workDir, 'backup')
    await writeSafeBackupFixture(fromDir, {
      d1Sha256: '0'.repeat(64),
      objectSha256: await sha256('object-body'),
    })

    await expect(
      execFileAsync('node', [
        backupScript,
        'restore',
        '--from',
        fromDir,
        '--execute',
        '--confirm-fresh-target',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('checksum mismatch'),
    })
  })

  it('rejects backup manifests that escape the backup directory', async () => {
    const workDir = await fixtureDir('restore-invalid-manifest')
    const fromDir = join(workDir, 'backup')
    await mkdir(fromDir, { recursive: true })
    await writeFile(
      join(fromDir, 'backup-manifest.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: '2026-07-06T00:00:00.000Z',
          mode: 'local',
          database: 'honowarden',
          bucket: 'honowarden-vault-objects',
          d1: {
            file: '../outside.sql',
          },
          r2: {
            objectListRequired: true,
            objects: [
              {
                key: 'attachments/object-one',
                file: '/tmp/object-one',
              },
            ],
          },
          restore: {
            command: 'node scripts/honowarden-backup.mjs restore',
          },
          commands: [],
        },
        null,
        2,
      ),
    )

    await expect(
      execFileAsync('node', [backupScript, 'restore', '--from', fromDir]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid backup manifest'),
    })
  })
})

async function fixtureDir(label: string): Promise<string> {
  const root = fileURLToPath(new URL('../.tmp/', import.meta.url).toString())
  const dir = join(root, `${label}-${crypto.randomUUID()}`)
  await mkdir(dir, { recursive: true })

  return dir
}

async function writeSafeBackupFixture(
  fromDir: string,
  hashes: { d1Sha256: string; objectSha256: string },
): Promise<void> {
  await mkdir(join(fromDir, 'r2'), { recursive: true })
  await writeFile(join(fromDir, 'd1.sql'), 'create table users(id text);\n')
  await writeFile(join(fromDir, 'r2/object-one'), 'object-body')
  await writeFile(
    join(fromDir, 'backup-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: '2026-07-06T00:00:00.000Z',
        mode: 'local',
        database: 'honowarden',
        bucket: 'honowarden-vault-objects',
        d1: {
          file: 'd1.sql',
          sha256: hashes.d1Sha256,
        },
        r2: {
          objectListRequired: true,
          objects: [
            {
              key: 'attachments/object-one',
              file: 'r2/object-one',
              sha256: hashes.objectSha256,
            },
          ],
        },
        restore: {
          command: 'node scripts/honowarden-backup.mjs restore',
        },
        commands: [],
      },
      null,
      2,
    ),
  )
}

async function sha256(value: string): Promise<string> {
  const { createHash } = await import('node:crypto')

  return createHash('sha256').update(value).digest('hex')
}
