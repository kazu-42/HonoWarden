import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const backupScript = join(repoRoot, 'scripts/honowarden-backup.mjs')
const objectOneKey = 'attachments/object-one'
const objectOneFile = r2FileForKey(objectOneKey)

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

  it('discovers remote R2 objects during dry-run without downloading object bodies', async () => {
    const workDir = await fixtureDir('export-r2-list')
    const outDir = join(workDir, 'backup')
    const requests: string[] = []
    const server = await startS3ListServer((request) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      requests.push(`${url.pathname}?${url.searchParams.toString()}`)

      if (url.searchParams.get('continuation-token') === 'page-2') {
        return listObjectsXml({
          contents: ['attachments/object-two'],
          isTruncated: false,
        })
      }

      return listObjectsXml({
        contents: [objectOneKey],
        isTruncated: true,
        nextContinuationToken: 'page-2',
      })
    })

    try {
      const result = await execFileAsync(
        'node',
        [
          backupScript,
          'export',
          '--out',
          outDir,
          '--database',
          'honowarden',
          '--bucket',
          'honowarden-vault-objects',
          '--mode',
          'remote',
          '--r2-list',
          '--r2-prefix',
          'attachments/',
          '--r2-list-page-size',
          '1',
          '--r2-list-endpoint',
          server.endpoint,
        ],
        {
          env: {
            ...process.env,
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key',
          },
        },
      )
      const output = JSON.parse(result.stdout) as {
        executed: boolean
        commands: string[][]
      }
      const manifest = JSON.parse(
        await readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
      ) as {
        r2: {
          objectListRequired: boolean
          objectListSource: string
          prefix: string
          pageSize: number
          objects: Array<{ key: string; file: string }>
        }
      }

      expect(output.executed).toBe(false)
      expect(requests).toEqual([
        '/honowarden-vault-objects?encoding-type=url&list-type=2&max-keys=1&prefix=attachments%2F',
        '/honowarden-vault-objects?continuation-token=page-2&encoding-type=url&list-type=2&max-keys=1&prefix=attachments%2F',
      ])
      expect(manifest.r2.objectListRequired).toBe(false)
      expect(manifest.r2.objectListSource).toBe('r2_list_objects_v2')
      expect(manifest.r2.prefix).toBe('attachments/')
      expect(manifest.r2.pageSize).toBe(1)
      expect(manifest.r2.objects.map((object) => object.key)).toEqual([
        objectOneKey,
        'attachments/object-two',
      ])
      expect(output.commands).toEqual([
        [
          'wrangler',
          'd1',
          'export',
          'honowarden',
          '--remote',
          '--output',
          join(outDir, 'd1.sql'),
          '--skip-confirmation',
        ],
        [
          'wrangler',
          'r2',
          'object',
          'get',
          'honowarden-vault-objects/attachments/object-one',
          '--remote',
          '--file',
          join(outDir, manifest.r2.objects[0]?.file ?? ''),
        ],
        [
          'wrangler',
          'r2',
          'object',
          'get',
          'honowarden-vault-objects/attachments/object-two',
          '--remote',
          '--file',
          join(outDir, manifest.r2.objects[1]?.file ?? ''),
        ],
      ])
    } finally {
      await server.close()
    }
  })

  it('plans automatic R2 listing for an empty bucket', async () => {
    const workDir = await fixtureDir('export-r2-list-empty')
    const outDir = join(workDir, 'backup')
    const server = await startS3ListServer(() =>
      listObjectsXml({ contents: [], isTruncated: false }),
    )

    try {
      const result = await execFileAsync(
        'node',
        [
          backupScript,
          'export',
          '--out',
          outDir,
          '--database',
          'honowarden',
          '--bucket',
          'honowarden-vault-objects',
          '--mode',
          'remote',
          '--r2-list',
          '--r2-list-endpoint',
          server.endpoint,
        ],
        {
          env: {
            ...process.env,
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key',
          },
        },
      )
      const output = JSON.parse(result.stdout) as { commands: string[][] }
      const manifest = JSON.parse(
        await readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
      ) as { r2: { objects: unknown[] } }

      expect(manifest.r2.objects).toEqual([])
      expect(output.commands).toHaveLength(1)
    } finally {
      await server.close()
    }
  })

  it('rejects duplicate objects returned by automatic R2 listing', async () => {
    const workDir = await fixtureDir('export-r2-list-duplicate')
    const outDir = join(workDir, 'backup')
    const server = await startS3ListServer(() =>
      listObjectsXml({
        contents: [objectOneKey, objectOneKey],
        isTruncated: false,
      }),
    )

    try {
      await expect(
        execFileAsync(
          'node',
          [
            backupScript,
            'export',
            '--out',
            outDir,
            '--database',
            'honowarden',
            '--bucket',
            'honowarden-vault-objects',
            '--mode',
            'remote',
            '--r2-list',
            '--r2-list-endpoint',
            server.endpoint,
          ],
          {
            env: {
              ...process.env,
              R2_ACCESS_KEY_ID: 'test-access-key',
              R2_SECRET_ACCESS_KEY: 'test-secret-key',
            },
          },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('duplicate R2 object key'),
      })
    } finally {
      await server.close()
    }
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
                key: objectOneKey,
                file: objectOneFile,
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
        `fresh-honowarden-vault-objects/${objectOneKey}`,
        '--local',
        '--file',
        join(fromDir, objectOneFile),
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

  it('rejects backup manifests whose R2 file does not match the object key', async () => {
    const workDir = await fixtureDir('restore-object-mismatch')
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
            objectListRequired: false,
            objectListSource: 'r2_list_objects_v2',
            objects: [
              {
                key: objectOneKey,
                file: 'r2/different-object',
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
      stderr: expect.stringContaining('object file does not match key'),
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
  await writeFile(join(fromDir, objectOneFile), 'object-body')
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
              key: objectOneKey,
              file: objectOneFile,
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

function r2FileForKey(key: string): string {
  return `r2/${Buffer.from(key, 'utf8').toString('base64url')}`
}

async function sha256(value: string): Promise<string> {
  const { createHash } = await import('node:crypto')

  return createHash('sha256').update(value).digest('hex')
}

async function startS3ListServer(
  handler: (request: IncomingMessage) => string,
): Promise<{ endpoint: string; close: () => Promise<void> }> {
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end(handler(request))
    },
  )

  await new Promise<void>((resolveServer) => {
    server.listen(0, '127.0.0.1', resolveServer)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to start test S3 list server')
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error)
            return
          }

          resolveClose()
        })
      }),
  }
}

function listObjectsXml(options: {
  contents: string[]
  isTruncated: boolean
  nextContinuationToken?: string
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  ${options.contents.map((key) => `<Contents><Key>${encodeURIComponent(key)}</Key></Contents>`).join('\n  ')}
  <IsTruncated>${options.isTruncated ? 'true' : 'false'}</IsTruncated>
  ${
    options.nextContinuationToken
      ? `<NextContinuationToken>${options.nextContinuationToken}</NextContinuationToken>`
      : ''
  }
</ListBucketResult>`
}
