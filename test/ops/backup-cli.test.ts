import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it, onTestFinished } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const backupScript = join(repoRoot, 'scripts/honowarden-backup.mjs')
const wranglerBinary = join(repoRoot, 'node_modules', '.bin', 'wrangler')
const objectOneKey = 'attachments/object-one'
const objectOneFile = r2FileForKey(objectOneKey)

type CredentialGenerationBinding = {
  schemaVersion: 1
  lifecycleManifestSha256: string
  sourceStateSha256: string
  manifestSha256: string
}

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
      audit: {
        name: string
        outcome: string
        manifestId: string
        resultStatus: string
      }
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
    expect(output.audit).toEqual({
      name: 'backup.export',
      outcome: 'success',
      manifestId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      resultStatus: 'planned',
    })
    expect(JSON.stringify(output.audit)).not.toContain(objectOneKey)
    expect(JSON.stringify(output.audit)).not.toContain('honowarden-vault')
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

  it('accepts package-manager argument separators before backup options', async () => {
    const workDir = await fixtureDir('export-separator')
    const outDir = join(workDir, 'backup')

    const result = await execFileAsync('node', [
      backupScript,
      'export',
      '--',
      '--out',
      outDir,
      '--database',
      'honowarden',
      '--bucket',
      'honowarden-vault-objects',
      '--mode',
      'local',
    ])
    const output = JSON.parse(result.stdout) as {
      executed: boolean
      commands: string[][]
    }

    expect(output.executed).toBe(false)
    expect(output.commands[0]).toContain('honowarden')
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
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const fakeWrangler = await createExportingFakeWrangler(
      workDir,
      'CREATE TABLE recovery_probe (id TEXT);\n',
      [],
    )
    await mkdir(sourceDir, { recursive: true })
    await mkdir(persistDir, { recursive: true })
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, 'attachments/object-one\n')

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
        'local',
        '--env',
        'staging',
        '--config',
        configPath,
        '--persist-to',
        persistDir,
        '--r2-objects',
        objectList,
        '--execute',
      ],
      { env: fakeWrangler.env },
    )
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
      '--config',
      configPath,
    ])
    expect(output.commands[1]).toContain('--persist-to')
    expect(output.commands[1]).toContain(persistDir)
    await expect(readFile(fakeWrangler.operations, 'utf8')).resolves.toBe(
      'd1 export\nr2 object get\n',
    )
  })

  it.each([
    {
      label: 'no config anchor',
      config: false,
      matchingPersistence: true,
      error:
        'local export --persist-to requires --config so D1 and R2 share one source',
    },
    {
      label: 'a persistence root outside the config anchor',
      config: true,
      matchingPersistence: false,
      error:
        'local export --persist-to must equal <config-directory>/.wrangler/state',
    },
  ])(
    'rejects unbound local export with $label before Wrangler spawn',
    async ({ config, matchingPersistence, error }) => {
      const workDir = await fixtureDir('export-unbound-split-source')
      const sourceDir = join(workDir, 'source')
      const configPath = join(sourceDir, 'wrangler.jsonc')
      const persistDir = matchingPersistence
        ? join(sourceDir, '.wrangler', 'state')
        : join(workDir, 'different-state')
      const objectList = join(workDir, 'objects.txt')
      const outDir = join(workDir, 'backup')
      const fakeWrangler = await createFakeWrangler(workDir)
      await mkdir(persistDir, { recursive: true })
      await mkdir(sourceDir, { recursive: true })
      await writeFile(configPath, '{}\n')
      await writeFile(objectList, `${objectOneKey}\n`)

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
            'local',
            ...(config ? ['--config', configPath] : []),
            '--persist-to',
            persistDir,
            '--r2-objects',
            objectList,
            '--execute',
          ],
          { env: fakeWrangler.env },
        ),
      ).rejects.toMatchObject({ stderr: expect.stringContaining(error) })
      await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject(
        { code: 'ENOENT' },
      )
      await expect(
        readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('rejects a generation-bound dry run before writing a manifest', async () => {
    const workDir = await fixtureDir('export-generation-binding')
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    const sourceDir = join(workDir, 'source')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const generationManifestSha256 = 'a'.repeat(64)
    await mkdir(sourceDir, { recursive: true })
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, 'attachments/object-one\n')

    await expect(
      execFileAsync('node', [
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
        '--config',
        configPath,
        '--persist-to',
        persistDir,
        '--generation-manifest-sha256',
        generationManifestSha256,
        '--r2-objects',
        objectList,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--generation-manifest-sha256 requires --execute',
      ),
    })
    await expect(
      readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a generation-bound export without an explicit R2 inventory before spawn', async () => {
    const workDir = await fixtureDir('export-generation-missing-inventory')
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const fakeWrangler = await createFakeWrangler(workDir)
    await mkdir(sourceDir, { recursive: true })
    await writeFile(configPath, '{}\n')

    await expect(
      execFileAsync(
        'node',
        [
          backupScript,
          'export',
          '--out',
          join(workDir, 'backup'),
          '--database',
          'honowarden',
          '--bucket',
          'honowarden-vault-objects',
          '--mode',
          'local',
          '--config',
          configPath,
          '--persist-to',
          persistDir,
          '--generation-manifest-sha256',
          'a'.repeat(64),
          '--execute',
        ],
        { env: fakeWrangler.env },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--generation-manifest-sha256 requires --r2-objects',
      ),
    })
    await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects a reused generation-bound output before spawn', async () => {
    const workDir = await fixtureDir('export-generation-reused-output')
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    const staleManifest = '{"stale":true}\n'
    const fakeWrangler = await createFakeWrangler(workDir)
    await mkdir(sourceDir, { recursive: true })
    await prepareOwnedGenerationState(sourceDir, 'a'.repeat(64))
    await mkdir(outDir, { recursive: true, mode: 0o700 })
    await chmod(outDir, 0o700)
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, `${objectOneKey}\n`)
    await writeFile(join(outDir, 'backup-manifest.json'), staleManifest)

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
          'local',
          '--config',
          configPath,
          '--persist-to',
          persistDir,
          '--generation-manifest-sha256',
          'a'.repeat(64),
          '--r2-objects',
          objectList,
          '--execute',
        ],
        { env: fakeWrangler.env },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--out must be missing or an empty directory for a generation-bound export',
      ),
    })
    await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(
      readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
    ).resolves.toBe(staleManifest)
  })

  it('atomically reserves generation-bound output across concurrent exports', async () => {
    const workDir = await fixtureDir('export-generation-concurrent-output')
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    const fakeWrangler = await createConcurrentExportFakeWrangler(workDir)
    await mkdir(sourceDir, { recursive: true })
    await prepareOwnedGenerationState(sourceDir, 'a'.repeat(64))
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, `${objectOneKey}\n`)

    const runExport = (runId: 'A' | 'B') =>
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
          'local',
          '--config',
          configPath,
          '--persist-to',
          persistDir,
          '--generation-manifest-sha256',
          'a'.repeat(64),
          '--r2-objects',
          objectList,
          '--execute',
        ],
        {
          env: {
            ...fakeWrangler.env,
            GENERATION_EXPORT_RUN_ID: runId,
          },
        },
      )

    const firstExport = runExport('A')
    await waitForFile(fakeWrangler.firstExportStarted)
    const secondResults = await Promise.allSettled([runExport('B')])
    await writeFile(fakeWrangler.releaseFirstExport, '')
    const firstResults = await Promise.allSettled([firstExport])
    const results = [...firstResults, ...secondResults]
    const successes = results.filter((result) => result.status === 'fulfilled')
    const failures = results.filter((result) => result.status === 'rejected')

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(String(failures[0]?.reason?.stderr)).toContain(
      'generation-bound output is already claimed',
    )
    await expect(
      readFile(fakeWrangler.secondExportStarted),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    const d1 = await readFile(join(outDir, 'd1.sql'), 'utf8')
    const runId = d1.match(/-- generation ([AB])/u)?.[1]
    const manifest = JSON.parse(
      await readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
    ) as {
      credentialGeneration: CredentialGenerationBinding
      r2: { objects: Array<{ file: string }> }
    }
    const [object] = manifest.r2.objects
    expect(object).toBeDefined()
    if (!object) throw new Error('concurrent export manifest omitted R2 object')
    const body = await readFile(join(outDir, object.file), 'utf8')

    expect(runId).toMatch(/^[AB]$/u)
    expect(body).toBe(`BODY-${runId}`)
    expect(manifest.credentialGeneration.lifecycleManifestSha256).toBe(
      'a'.repeat(64),
    )
    expect(await readdir(outDir)).not.toContain('.generation-bound-export.lock')
  })

  it('rejects an R2 inventory that omits a D1 attachment reference', async () => {
    const workDir = await fixtureDir('export-generation-incomplete-inventory')
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    const fakeWrangler = await createExportingFakeWrangler(
      workDir,
      "CREATE TABLE cipher_attachments (object_key TEXT NOT NULL UNIQUE); INSERT INTO cipher_attachments VALUES ('attachments/missing-body');\n",
      ['attachments/missing-body'],
    )
    await mkdir(sourceDir, { recursive: true })
    await prepareOwnedGenerationState(sourceDir, 'a'.repeat(64))
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, `${objectOneKey}\n`)

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
          'local',
          '--config',
          configPath,
          '--persist-to',
          persistDir,
          '--generation-manifest-sha256',
          'a'.repeat(64),
          '--r2-objects',
          objectList,
          '--execute',
        ],
        { env: fakeWrangler.env },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Generation-bound R2 inventory is missing 1 D1 attachment object',
      ),
    })
    await expect(readFile(fakeWrangler.operations, 'utf8')).resolves.toBe(
      'd1 export\nd1 validation import\nd1 validation query\n',
    )
    await expect(
      readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(outDir)).not.toContain('.generation-bound-export.lock')
  })

  it('accepts an empty R2 inventory when exported D1 has no attachment references', async () => {
    const workDir = await fixtureDir('export-generation-empty-inventory')
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    const fakeWrangler = await createExportingFakeWrangler(
      workDir,
      'CREATE TABLE cipher_attachments (object_key TEXT NOT NULL UNIQUE);\n',
      [],
    )
    await mkdir(sourceDir, { recursive: true })
    await prepareOwnedGenerationState(sourceDir, 'a'.repeat(64))
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, '')

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
        'local',
        '--config',
        configPath,
        '--persist-to',
        persistDir,
        '--generation-manifest-sha256',
        'a'.repeat(64),
        '--r2-objects',
        objectList,
        '--execute',
      ],
      { env: fakeWrangler.env },
    )
    const output = JSON.parse(result.stdout) as { executed: boolean }
    const manifest = JSON.parse(
      await readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
    ) as {
      credentialGeneration: CredentialGenerationBinding
      r2: { objects: unknown[] }
    }

    expect(output.executed).toBe(true)
    expect(manifest.r2.objects).toEqual([])
    expect(manifest.credentialGeneration.manifestSha256).toMatch(
      /^[a-f0-9]{64}$/,
    )
    await expect(readFile(fakeWrangler.operations, 'utf8')).resolves.toBe(
      'd1 export\nd1 validation import\nd1 validation query\n',
    )
  })

  it.each([
    {
      name: 'remote mode',
      args: (sourceDir: string) => [
        '--mode',
        'remote',
        '--config',
        join(sourceDir, 'wrangler.jsonc'),
        '--persist-to',
        join(sourceDir, '.wrangler', 'state'),
      ],
      error: '--generation-manifest-sha256 requires --mode local',
    },
    {
      name: 'missing config',
      args: (sourceDir: string) => [
        '--mode',
        'local',
        '--persist-to',
        join(sourceDir, '.wrangler', 'state'),
      ],
      error: '--generation-manifest-sha256 requires --config',
    },
    {
      name: 'missing persistence root',
      args: (sourceDir: string) => [
        '--mode',
        'local',
        '--config',
        join(sourceDir, 'wrangler.jsonc'),
      ],
      error: '--generation-manifest-sha256 requires --persist-to',
    },
    {
      name: 'split D1 and R2 persistence roots',
      args: (sourceDir: string) => [
        '--mode',
        'local',
        '--config',
        join(sourceDir, 'wrangler.jsonc'),
        '--persist-to',
        join(sourceDir, 'other-state'),
      ],
      error:
        '--persist-to must equal <config-directory>/.wrangler/state for a generation-bound export',
    },
  ])(
    'rejects a generation-bound export with $name',
    async ({ args, error }) => {
      const workDir = await fixtureDir('export-unowned-generation-binding')
      const sourceDir = join(workDir, 'source')
      const objectList = join(workDir, 'objects.txt')
      await mkdir(sourceDir, { recursive: true })
      await writeFile(join(sourceDir, 'wrangler.jsonc'), '{}\n')
      await writeFile(objectList, `${objectOneKey}\n`)

      await expect(
        execFileAsync('node', [
          backupScript,
          'export',
          '--out',
          join(workDir, 'backup'),
          '--database',
          'honowarden',
          '--bucket',
          'honowarden-vault-objects',
          ...args(sourceDir),
          '--generation-manifest-sha256',
          'a'.repeat(64),
          '--r2-objects',
          objectList,
        ]),
      ).rejects.toMatchObject({ stderr: expect.stringContaining(error) })
    },
  )

  it('rejects an unowned generation source before Wrangler spawn', async () => {
    const workDir = await fixtureDir('export-unowned-generation-source')
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = join(sourceDir, '.wrangler', 'state')
    const objectList = join(workDir, 'objects.txt')
    const fakeWrangler = await createFakeWrangler(workDir)
    await mkdir(persistDir, { recursive: true, mode: 0o700 })
    await chmod(sourceDir, 0o700)
    await chmod(join(sourceDir, '.wrangler'), 0o700)
    await chmod(persistDir, 0o700)
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, `${objectOneKey}\n`)

    await expect(
      execFileAsync(
        'node',
        [
          backupScript,
          'export',
          '--out',
          join(workDir, 'backup'),
          '--database',
          'honowarden',
          '--bucket',
          'honowarden-vault-objects',
          '--mode',
          'local',
          '--config',
          configPath,
          '--persist-to',
          persistDir,
          '--generation-manifest-sha256',
          'a'.repeat(64),
          '--r2-objects',
          objectList,
          '--execute',
        ],
        { env: fakeWrangler.env },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'generation-bound persistence ownership marker is invalid',
      ),
    })
    await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it.each([
    {
      label: 'missing completion attestation',
      prepare: async (persistDir: string) => {
        void persistDir
      },
      error: 'credential lifecycle completion attestation is invalid',
    },
    {
      label: 'different lifecycle digest',
      prepare: async (persistDir: string) => {
        await completeOwnedGenerationState(persistDir, 'b'.repeat(64))
      },
      error: 'credential lifecycle completion manifest digest mismatch',
    },
    {
      label: 'state changed after completion',
      prepare: async (persistDir: string) => {
        await completeOwnedGenerationState(persistDir, 'a'.repeat(64))
        await writeFile(join(persistDir, 'post-completion-change'), 'changed')
      },
      error: 'credential lifecycle completion state digest mismatch',
    },
  ])(
    'rejects a generation source with $label before Wrangler spawn',
    async ({ prepare, error }) => {
      const workDir = await fixtureDir('export-incomplete-generation-source')
      const sourceDir = join(workDir, 'source')
      const configPath = join(sourceDir, 'wrangler.jsonc')
      const persistDir = await prepareOwnedGenerationState(sourceDir)
      const objectList = join(workDir, 'objects.txt')
      const fakeWrangler = await createFakeWrangler(workDir)
      await prepare(persistDir)
      await writeFile(configPath, '{}\n')
      await writeFile(objectList, `${objectOneKey}\n`)

      await expect(
        execFileAsync(
          'node',
          [
            backupScript,
            'export',
            '--out',
            join(workDir, 'backup'),
            '--database',
            'honowarden',
            '--bucket',
            'honowarden-vault-objects',
            '--mode',
            'local',
            '--config',
            configPath,
            '--persist-to',
            persistDir,
            '--generation-manifest-sha256',
            'a'.repeat(64),
            '--r2-objects',
            objectList,
            '--execute',
          ],
          { env: fakeWrangler.env },
        ),
      ).rejects.toMatchObject({ stderr: expect.stringContaining(error) })
      await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject(
        { code: 'ENOENT' },
      )
    },
  )

  it.each(['config', 'persistence'] as const)(
    'rejects a generation source with a symlinked %s path before Wrangler spawn',
    async (symlinkedPath) => {
      const workDir = await fixtureDir(
        `export-symlinked-generation-${symlinkedPath}`,
      )
      const sourceDir = join(workDir, 'source')
      const configPath = join(sourceDir, 'wrangler.jsonc')
      const persistDir = join(sourceDir, '.wrangler', 'state')
      const objectList = join(workDir, 'objects.txt')
      const fakeWrangler = await createFakeWrangler(workDir)
      await mkdir(join(sourceDir, '.wrangler'), {
        recursive: true,
        mode: 0o700,
      })
      await chmod(sourceDir, 0o700)
      await chmod(join(sourceDir, '.wrangler'), 0o700)

      if (symlinkedPath === 'config') {
        const realConfig = join(workDir, 'real-wrangler.jsonc')
        await writeFile(realConfig, '{}\n')
        await symlink(realConfig, configPath)
        await prepareOwnedStateDirectory(persistDir)
      } else {
        const realPersistDir = join(workDir, 'real-state')
        await writeFile(configPath, '{}\n')
        await prepareOwnedStateDirectory(realPersistDir)
        await symlink(realPersistDir, persistDir)
      }
      await writeFile(objectList, `${objectOneKey}\n`)

      await expect(
        execFileAsync(
          'node',
          [
            backupScript,
            'export',
            '--out',
            join(workDir, 'backup'),
            '--database',
            'honowarden',
            '--bucket',
            'honowarden-vault-objects',
            '--mode',
            'local',
            '--config',
            configPath,
            '--persist-to',
            persistDir,
            '--generation-manifest-sha256',
            'a'.repeat(64),
            '--r2-objects',
            objectList,
            '--execute',
          ],
          { env: fakeWrangler.env },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          'generation-bound source paths must be canonical and symlink-free',
        ),
      })
      await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject(
        { code: 'ENOENT' },
      )
    },
  )

  it('rejects a public pre-existing generation-bound output before Wrangler spawn', async () => {
    const workDir = await fixtureDir('export-public-generation-output')
    const sourceDir = join(workDir, 'source')
    const configPath = join(sourceDir, 'wrangler.jsonc')
    const persistDir = await prepareOwnedGenerationState(
      sourceDir,
      'a'.repeat(64),
    )
    const objectList = join(workDir, 'objects.txt')
    const outDir = join(workDir, 'backup')
    const fakeWrangler = await createFakeWrangler(workDir)
    await writeFile(configPath, '{}\n')
    await writeFile(objectList, `${objectOneKey}\n`)
    await mkdir(outDir, { mode: 0o755 })
    await chmod(outDir, 0o755)

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
          'local',
          '--config',
          configPath,
          '--persist-to',
          persistDir,
          '--generation-manifest-sha256',
          'a'.repeat(64),
          '--r2-objects',
          objectList,
          '--execute',
        ],
        { env: fakeWrangler.env },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'generation-bound --out must be owned by the current user with mode 0700',
      ),
    })
    expect((await lstat(outDir)).mode & 0o777).toBe(0o755)
    expect(await readdir(outDir)).toEqual([])
    await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it(
    'exports repeated real local D1 and R2 state with a large retained WAL',
    { timeout: 60_000 },
    async () => {
      const workDir = await fixtureDir('export-owned-local-state')
      const sourceDir = join(workDir, 'source')
      const persistDir = join(sourceDir, '.wrangler', 'state')
      const configPath = join(sourceDir, 'wrangler.jsonc')
      const objectList = join(workDir, 'objects.txt')
      const objectBodyPath = join(workDir, 'object-body')
      const outDir = join(workDir, 'backup')
      const database = 'honowarden-backup-source'
      const bucket = 'honowarden-backup-objects'
      const generationManifestSha256 = 'f'.repeat(64)
      const d1Sentinel = `owned-source-${crypto.randomUUID()}`
      const objectBody = `owned-r2-${crypto.randomUUID()}`
      await mkdir(sourceDir, { recursive: true })
      await prepareOwnedGenerationState(sourceDir)
      await writeFile(
        configPath,
        JSON.stringify(
          {
            name: 'honowarden-backup-source',
            compatibility_date: '2026-07-21',
            d1_databases: [
              {
                binding: 'DB',
                database_name: database,
                database_id: crypto.randomUUID(),
              },
            ],
            r2_buckets: [
              {
                binding: 'VAULT_OBJECTS',
                bucket_name: bucket,
              },
            ],
          },
          null,
          2,
        ),
      )
      await writeFile(objectList, `${objectOneKey}\n`)
      await writeFile(objectBodyPath, objectBody)
      await mkdir(outDir, { recursive: true, mode: 0o700 })
      await chmod(outDir, 0o700)

      await execFileAsync(wranglerBinary, [
        'd1',
        'execute',
        database,
        '--local',
        '--config',
        configPath,
        '--persist-to',
        persistDir,
        '--command',
        `CREATE TABLE recovery_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO recovery_probe (id, value) VALUES ('final', '${d1Sentinel}'); CREATE TABLE cipher_attachments (object_key TEXT NOT NULL UNIQUE); INSERT INTO cipher_attachments (object_key) VALUES ('${objectOneKey}'); CREATE TABLE wal_pressure (id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO wal_pressure (id, body) WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 1500) SELECT x, hex(randomblob(4096)) FROM n;`,
        '--yes',
      ])
      expect(
        await largestRegularFileWithSuffix(persistDir, '.sqlite-wal'),
      ).toBeGreaterThan(8 * 1024 * 1024)
      await execFileAsync(wranglerBinary, [
        'r2',
        'object',
        'put',
        `${bucket}/${objectOneKey}`,
        '--local',
        '--config',
        configPath,
        '--persist-to',
        persistDir,
        '--file',
        objectBodyPath,
      ])
      await completeOwnedGenerationState(persistDir, generationManifestSha256)

      const runBoundExport = (target: string) =>
        execFileAsync(
          'node',
          [
            backupScript,
            'export',
            '--out',
            target,
            '--database',
            database,
            '--bucket',
            bucket,
            '--mode',
            'local',
            '--config',
            configPath,
            '--persist-to',
            persistDir,
            '--generation-manifest-sha256',
            generationManifestSha256,
            '--r2-objects',
            objectList,
            '--execute',
          ],
          {
            env: {
              ...process.env,
              PATH: `${join(repoRoot, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
            },
          },
        )

      const result = await runBoundExport(outDir)
      const output = JSON.parse(result.stdout) as {
        executed: boolean
        audit: { resultStatus: string }
      }
      const manifest = JSON.parse(
        await readFile(join(outDir, 'backup-manifest.json'), 'utf8'),
      ) as {
        credentialGeneration: CredentialGenerationBinding
        d1: { file: string; sha256: string }
        r2: {
          objects: Array<{ key: string; file: string; sha256: string }>
        }
      }
      const d1Body = await readFile(join(outDir, manifest.d1.file), 'utf8')
      const exportedObjectBody = await readFile(
        join(outDir, manifest.r2.objects[0]?.file ?? ''),
        'utf8',
      )

      expect(output.executed).toBe(true)
      expect(output.audit.resultStatus).toBe('executed')
      expect(d1Body).toContain(d1Sentinel)
      expect(exportedObjectBody).toBe(objectBody)
      expect(manifest.credentialGeneration).toEqual(
        await expectedCredentialGenerationBinding({
          lifecycleManifestSha256: generationManifestSha256,
          d1Sha256: manifest.d1.sha256,
          objects: manifest.r2.objects,
        }),
      )
      expect(manifest.credentialGeneration.manifestSha256).not.toBe(
        generationManifestSha256,
      )
      expect(manifest.d1.sha256).toBe(
        await sha256FilePath(join(outDir, manifest.d1.file)),
      )
      expect(manifest.r2.objects[0]?.sha256).toBe(
        await sha256FilePath(join(outDir, manifest.r2.objects[0]?.file ?? '')),
      )

      const repeatedOutDir = join(workDir, 'repeated-backup')
      await runBoundExport(repeatedOutDir)
      const repeatedManifest = JSON.parse(
        await readFile(join(repeatedOutDir, 'backup-manifest.json'), 'utf8'),
      ) as { credentialGeneration: CredentialGenerationBinding }
      expect(repeatedManifest.credentialGeneration.manifestSha256).toBe(
        manifest.credentialGeneration.manifestSha256,
      )

      await execFileAsync(wranglerBinary, [
        'd1',
        'execute',
        database,
        '--local',
        '--config',
        configPath,
        '--persist-to',
        persistDir,
        '--command',
        "UPDATE recovery_probe SET value = 'historical-source';",
        '--yes',
      ])
      const changedOutDir = join(workDir, 'changed-backup')
      await expect(runBoundExport(changedOutDir)).rejects.toMatchObject({
        stderr: expect.stringContaining(
          'credential lifecycle completion state digest mismatch',
        ),
      })
      await expect(
        readFile(join(changedOutDir, 'backup-manifest.json'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('rejects malformed generation binding digests', async () => {
    const workDir = await fixtureDir('export-invalid-generation-binding')

    await expect(
      execFileAsync('node', [
        backupScript,
        'export',
        '--out',
        join(workDir, 'backup'),
        '--database',
        'honowarden',
        '--bucket',
        'honowarden-vault-objects',
        '--generation-manifest-sha256',
        'not-a-sha256',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--generation-manifest-sha256 must be a lowercase SHA-256',
      ),
    })
  })

  it('rejects restore-only binding flags during export', async () => {
    const workDir = await fixtureDir('export-restore-only-binding')

    await expect(
      execFileAsync('node', [
        backupScript,
        'export',
        '--out',
        join(workDir, 'backup'),
        '--database',
        'honowarden',
        '--bucket',
        'honowarden-vault-objects',
        '--expected-manifest-sha256',
        'a'.repeat(64),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--expected-manifest-sha256 is only supported by restore',
      ),
    })
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
      audit: {
        name: string
        outcome: string
        manifestId: string
        resultStatus: string
      }
      executed: boolean
      commands: string[][]
    }

    expect(output.executed).toBe(false)
    expect(output.audit).toEqual({
      name: 'backup.restore',
      outcome: 'success',
      manifestId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      resultStatus: 'planned',
    })
    expect(JSON.stringify(output.audit)).not.toContain(objectOneKey)
    expect(JSON.stringify(output.audit)).not.toContain('fresh-honowarden')
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

  it('accepts an exact manifest and credential-generation restore binding', async () => {
    const workDir = await fixtureDir('restore-exact-generation-binding')
    const fromDir = join(workDir, 'backup')
    const successfulWrangler = await createSuccessfulWrangler(workDir)
    const generationManifestSha256 = 'b'.repeat(64)
    const generationBinding = await writeSafeBackupFixture(fromDir, {
      d1Sha256: await sha256('create table users(id text);\n'),
      objectSha256: await sha256('object-body'),
      generationManifestSha256,
    })
    const manifestSha256 = await sha256FilePath(
      join(fromDir, 'backup-manifest.json'),
    )

    const result = await execFileAsync(
      'node',
      [
        backupScript,
        'restore',
        '--from',
        fromDir,
        '--expected-manifest-sha256',
        manifestSha256,
        '--expected-generation-manifest-sha256',
        generationBinding?.manifestSha256 ?? '',
        '--execute',
        '--confirm-fresh-target',
      ],
      { env: successfulWrangler.env },
    )
    const output = JSON.parse(result.stdout) as {
      executed: boolean
      manifest: string
      audit: { manifestId: string; resultStatus: string }
    }

    expect(output.executed).toBe(true)
    expect(output.manifest).toBe(join(fromDir, 'backup-manifest.json'))
    expect(output.audit.manifestId).toBe(`sha256:${manifestSha256}`)
    expect(output.audit.resultStatus).toBe('executed')
    const operations = (await readFile(successfulWrangler.operations, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
    expect(operations).toHaveLength(2)
    expect(operations[0]?.slice(0, 3)).toEqual(['d1', 'execute', 'honowarden'])
    expect(operations[1]?.slice(0, 4)).toEqual([
      'r2',
      'object',
      'put',
      `honowarden-vault-objects/${objectOneKey}`,
    ])
  })

  it.each([
    { label: 'both approval pins', includeManifestPin: false },
    { label: 'the generation approval pin', includeManifestPin: true },
  ])(
    'requires $label before executing a bound restore',
    async ({ includeManifestPin }) => {
      const workDir = await fixtureDir('restore-bound-requires-pins')
      const fromDir = join(workDir, 'backup')
      const fakeWrangler = await createFakeWrangler(workDir)
      await writeSafeBackupFixture(fromDir, {
        d1Sha256: await sha256('create table users(id text);\n'),
        objectSha256: await sha256('object-body'),
        generationManifestSha256: 'b'.repeat(64),
      })
      const manifestSha256 = await sha256FilePath(
        join(fromDir, 'backup-manifest.json'),
      )

      await expect(
        execFileAsync(
          'node',
          [
            backupScript,
            'restore',
            '--from',
            fromDir,
            ...(includeManifestPin
              ? ['--expected-manifest-sha256', manifestSha256]
              : []),
            '--execute',
            '--confirm-fresh-target',
          ],
          { env: fakeWrangler.env },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          'bound restore --execute requires both approval SHA-256 pins',
        ),
      })
      await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject(
        { code: 'ENOENT' },
      )
    },
  )

  it('rejects export-only generation binding during restore', async () => {
    const workDir = await fixtureDir('restore-export-only-binding')
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
        '--generation-manifest-sha256',
        'a'.repeat(64),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--generation-manifest-sha256 is only supported by export',
      ),
    })
  })

  it('requires an exact manifest expectation with a generation expectation', async () => {
    const workDir = await fixtureDir('restore-generation-requires-manifest')
    const fromDir = join(workDir, 'backup')
    await writeSafeBackupFixture(fromDir, {
      d1Sha256: await sha256('create table users(id text);\n'),
      objectSha256: await sha256('object-body'),
      generationManifestSha256: 'c'.repeat(64),
    })

    await expect(
      execFileAsync('node', [
        backupScript,
        'restore',
        '--from',
        fromDir,
        '--expected-generation-manifest-sha256',
        'c'.repeat(64),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--expected-generation-manifest-sha256 requires --expected-manifest-sha256',
      ),
    })
  })

  it.each([
    {
      label: 'manifest',
      expectedManifestSha256: '0'.repeat(64),
      expectedGenerationManifestSha256: 'd'.repeat(64),
      error: 'Backup manifest SHA-256 mismatch',
    },
    {
      label: 'historical generation',
      expectedManifestSha256: 'exact',
      expectedGenerationManifestSha256: 'e'.repeat(64),
      error: 'Backup credential generation SHA-256 mismatch',
    },
  ])(
    'rejects a $label mismatch before spawning restore commands',
    async ({
      label,
      expectedManifestSha256,
      expectedGenerationManifestSha256,
      error,
    }) => {
      const workDir = await fixtureDir(
        `restore-pre-spawn-${label.replaceAll(' ', '-')}`,
      )
      const fromDir = join(workDir, 'backup')
      const generationManifestSha256 = 'd'.repeat(64)
      await writeSafeBackupFixture(fromDir, {
        d1Sha256: await sha256('create table users(id text);\n'),
        objectSha256: await sha256('object-body'),
        generationManifestSha256,
      })
      const exactManifestSha256 = await sha256FilePath(
        join(fromDir, 'backup-manifest.json'),
      )
      const fakeWrangler = await createFakeWrangler(workDir)

      await expect(
        execFileAsync(
          'node',
          [
            backupScript,
            'restore',
            '--from',
            fromDir,
            '--execute',
            '--confirm-fresh-target',
            '--expected-manifest-sha256',
            expectedManifestSha256 === 'exact'
              ? exactManifestSha256
              : expectedManifestSha256,
            '--expected-generation-manifest-sha256',
            expectedGenerationManifestSha256,
          ],
          { env: fakeWrangler.env },
        ),
      ).rejects.toMatchObject({ stderr: expect.stringContaining(error) })
      await expect(readFile(fakeWrangler.marker, 'utf8')).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      )
    },
  )

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

  it('emits secret-safe executed backup evidence from a checksum manifest', async () => {
    const workDir = await fixtureDir('evidence')
    const fromDir = join(workDir, 'backup')
    const outPath = join(workDir, 'backup-evidence.json')
    const d1Body = 'create table users(id text);\n'
    const objectBody = 'object-body'
    await writeSafeBackupFixture(fromDir, {
      d1Sha256: await sha256(d1Body),
      objectSha256: await sha256(objectBody),
    })

    const result = await execFileAsync('node', [
      backupScript,
      'evidence',
      '--from',
      fromDir,
      '--out',
      outPath,
      '--source-commit',
      '0123456789abcdef0123456789abcdef01234567',
      '--run-url',
      'https://github.com/kazu-42/HonoWarden/actions/runs/123',
    ])
    const output = JSON.parse(result.stdout) as {
      action: string
      status: string
      sourceCommit: string
      runUrl: string
      manifestId: string
      d1: { sha256: string; sizeBytes: number }
      r2: {
        objectCount: number
        objectDigestId: string
        totalSizeBytes: number
      }
      safety: {
        includesDatabaseName: boolean
        includesBucketName: boolean
        includesObjectKeys: boolean
        includesObjectBodies: boolean
      }
    }
    const fileEvidence = JSON.parse(await readFile(outPath, 'utf8'))

    expect(fileEvidence).toEqual(output)
    expect(output).toMatchObject({
      action: 'backup.evidence',
      status: 'executed',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      runUrl: 'https://github.com/kazu-42/HonoWarden/actions/runs/123',
      d1: {
        sha256: await sha256(d1Body),
        sizeBytes: Buffer.byteLength(d1Body),
      },
      r2: {
        objectCount: 1,
        totalSizeBytes: Buffer.byteLength(objectBody),
      },
      safety: {
        includesDatabaseName: false,
        includesBucketName: false,
        includesObjectKeys: false,
        includesObjectBodies: false,
      },
    })
    expect(output.manifestId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(output.r2.objectDigestId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.stdout).not.toContain('honowarden-vault-objects')
    expect(result.stdout).not.toContain('honowarden')
    expect(result.stdout).not.toContain(objectOneKey)
    expect(result.stdout).not.toContain(objectBody)
  })

  it('emits only the credential-generation digest from a bound manifest', async () => {
    const workDir = await fixtureDir('evidence-generation-binding')
    const fromDir = join(workDir, 'backup')
    const generationManifestSha256 = '7'.repeat(64)
    const generationBinding = await writeSafeBackupFixture(fromDir, {
      d1Sha256: await sha256('create table users(id text);\n'),
      objectSha256: await sha256('object-body'),
      generationManifestSha256,
    })

    const result = await execFileAsync('node', [
      backupScript,
      'evidence',
      '--from',
      fromDir,
    ])
    const output = JSON.parse(result.stdout) as {
      credentialGeneration: { manifestSha256: string }
    }

    expect(output.credentialGeneration).toEqual({
      manifestSha256: generationBinding?.manifestSha256,
    })
  })

  it('rejects unexpected credential-generation fields before evidence output', async () => {
    const workDir = await fixtureDir('evidence-generation-extra-field')
    const fromDir = join(workDir, 'backup')
    const manifestPath = join(fromDir, 'backup-manifest.json')
    const syntheticSecret = `synthetic-secret-${crypto.randomUUID()}`
    await writeSafeBackupFixture(fromDir, {
      d1Sha256: await sha256('create table users(id text);\n'),
      objectSha256: await sha256('object-body'),
      generationManifestSha256: '8'.repeat(64),
    })
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      credentialGeneration: Record<string, string>
    }
    manifest.credentialGeneration.unexpected = syntheticSecret
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    await expect(
      execFileAsync('node', [backupScript, 'evidence', '--from', fromDir]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Invalid backup manifest credential generation',
      ),
      stdout: expect.not.stringContaining(syntheticSecret),
    })
  })

  it('rejects a credential-generation binding inconsistent with backup checksums', async () => {
    const workDir = await fixtureDir('evidence-generation-binding-mismatch')
    const fromDir = join(workDir, 'backup')
    const manifestPath = join(fromDir, 'backup-manifest.json')
    await writeSafeBackupFixture(fromDir, {
      d1Sha256: await sha256('create table users(id text);\n'),
      objectSha256: await sha256('object-body'),
      generationManifestSha256: '9'.repeat(64),
    })
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      d1: { sha256: string }
    }
    manifest.d1.sha256 = '0'.repeat(64)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    await expect(
      execFileAsync('node', [backupScript, 'evidence', '--from', fromDir]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Backup credential generation binding mismatch',
      ),
    })
  })

  it('requires checksum-bearing manifests before emitting executed evidence', async () => {
    const workDir = await fixtureDir('evidence-missing-checksum')
    const fromDir = join(workDir, 'backup')
    await mkdir(join(fromDir, 'r2'), { recursive: true })
    await writeFile(join(fromDir, 'd1.sql'), 'create table users(id text);\n')
    await writeFile(join(fromDir, objectOneFile), 'object-body')
    await writeFile(
      join(fromDir, 'backup-manifest.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: '2026-07-06T00:00:00.000Z',
          mode: 'remote',
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

    await expect(
      execFileAsync('node', [backupScript, 'evidence', '--from', fromDir]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Backup manifest missing checksum'),
    })
  })

  it('documents generation-bound local export and pre-spawn restore gates', async () => {
    const runbook = await readFile(
      join(repoRoot, 'docs/operations/backup-restore.md'),
      'utf8',
    )

    expect(runbook).toContain('--generation-manifest-sha256')
    expect(runbook).toContain('--expected-manifest-sha256')
    expect(runbook).toContain('--expected-generation-manifest-sha256')
    expect(runbook).toContain('--config')
    expect(runbook).toContain('.wrangler/state')
    expect(runbook).toContain('honowarden.backup-source.v1')
    expect(runbook).toContain('honowarden.credential-generation-binding.v1')
    expect(runbook).toContain('execute-only')
    expect(runbook).toContain('explicit `--r2-objects` inventory')
    expect(runbook).toMatch(
      /Every local export\s+that supplies it must also supply `--config`/,
    )
    expect(runbook).toContain('cipher_attachments.object_key')
    expect(runbook).toContain('.honowarden-credential-lifecycle-complete.json')
    expect(runbook).toContain('*.sqlite-shm')
    expect(runbook).toMatch(
      /executing any\s+manifest that contains `credentialGeneration` requires both approval pins/,
    )
    expect(runbook).toMatch(/before any restore command\s+is constructed/)
    expect(runbook).toContain('Child Wrangler output is routed to stderr')
  })
})

async function fixtureDir(label: string): Promise<string> {
  const root = fileURLToPath(new URL('../.tmp/', import.meta.url).toString())
  const dir = join(root, `${label}-${crypto.randomUUID()}`)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
  await mkdir(dir, { recursive: false, mode: 0o700 })
  onTestFinished(() => rm(dir, { recursive: true, force: true }))

  return dir
}

async function largestRegularFileWithSuffix(
  directory: string,
  suffix: string,
): Promise<number> {
  let largest = 0
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry)
    const info = await lstat(path)
    if (info.isDirectory()) {
      largest = Math.max(
        largest,
        await largestRegularFileWithSuffix(path, suffix),
      )
    } else if (info.isFile() && entry.endsWith(suffix)) {
      largest = Math.max(largest, info.size)
    }
  }
  return largest
}

async function prepareOwnedGenerationState(
  sourceDir: string,
  generationManifestSha256?: string,
): Promise<string> {
  await mkdir(sourceDir, { recursive: true, mode: 0o700 })
  await chmod(sourceDir, 0o700)
  const wranglerDir = join(sourceDir, '.wrangler')
  const persistDir = join(wranglerDir, 'state')
  await mkdir(wranglerDir, { mode: 0o700 })
  await prepareOwnedStateDirectory(persistDir)
  if (generationManifestSha256) {
    await completeOwnedGenerationState(persistDir, generationManifestSha256)
  }
  return persistDir
}

async function completeOwnedGenerationState(
  persistDir: string,
  generationManifestSha256: string,
): Promise<void> {
  const stateModule = (await import(
    pathToFileURL(
      join(repoRoot, 'scripts/honowarden-credential-lifecycle-state.mjs'),
    ).href
  )) as {
    writeCredentialLifecycleCompletionAttestation: (
      path: string,
      digest: string,
    ) => Promise<unknown>
  }
  await stateModule.writeCredentialLifecycleCompletionAttestation(
    persistDir,
    generationManifestSha256,
  )
}

async function prepareOwnedStateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
  await writeFile(
    join(path, '.honowarden-credential-lifecycle-owned'),
    '{"owner":"honowarden-credential-lifecycle"}\n',
    { flag: 'wx', mode: 0o600 },
  )
}

async function writeSafeBackupFixture(
  fromDir: string,
  hashes: {
    d1Sha256: string
    objectSha256: string
    generationManifestSha256?: string
  },
): Promise<CredentialGenerationBinding | undefined> {
  const credentialGeneration = hashes.generationManifestSha256
    ? await expectedCredentialGenerationBinding({
        lifecycleManifestSha256: hashes.generationManifestSha256,
        d1Sha256: hashes.d1Sha256,
        objects: [{ key: objectOneKey, sha256: hashes.objectSha256 }],
      })
    : undefined
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
        ...(credentialGeneration ? { credentialGeneration } : {}),
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

  return credentialGeneration
}

function r2FileForKey(key: string): string {
  return `r2/${Buffer.from(key, 'utf8').toString('base64url')}`
}

async function sha256(value: string): Promise<string> {
  const { createHash } = await import('node:crypto')

  return createHash('sha256').update(value).digest('hex')
}

async function sha256FilePath(path: string): Promise<string> {
  return sha256(await readFile(path, 'utf8'))
}

async function expectedCredentialGenerationBinding(input: {
  lifecycleManifestSha256: string
  d1Sha256: string
  objects: Array<{ key: string; sha256: string }>
}): Promise<CredentialGenerationBinding> {
  const sourceStateSha256 = await sha256(
    JSON.stringify({
      domain: 'honowarden.backup-source.v1',
      d1: { sha256: input.d1Sha256 },
      r2: {
        objects: [...input.objects]
          .sort((left, right) => {
            if (left.key === right.key) return 0
            return left.key < right.key ? -1 : 1
          })
          .map((object) => ({
            key: object.key,
            sha256: object.sha256,
          })),
      },
    }),
  )
  const manifestSha256 = await sha256(
    JSON.stringify({
      domain: 'honowarden.credential-generation-binding.v1',
      lifecycleManifestSha256: input.lifecycleManifestSha256,
      sourceStateSha256,
    }),
  )

  return {
    schemaVersion: 1,
    lifecycleManifestSha256: input.lifecycleManifestSha256,
    sourceStateSha256,
    manifestSha256,
  }
}

async function createFakeWrangler(
  workDir: string,
): Promise<{ marker: string; env: NodeJS.ProcessEnv }> {
  const binDir = join(workDir, 'bin')
  const marker = join(workDir, 'wrangler-spawned')
  const executable = join(binDir, 'wrangler')
  await mkdir(binDir, { recursive: true })
  await writeFile(
    executable,
    `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.WRANGLER_MARKER, 'spawned')\nprocess.exit(97)\n`,
    { mode: 0o700 },
  )
  return {
    marker,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      WRANGLER_MARKER: marker,
    },
  }
}

async function createSuccessfulWrangler(workDir: string): Promise<{
  operations: string
  env: NodeJS.ProcessEnv
}> {
  const binDir = join(workDir, 'successful-bin')
  const operations = join(workDir, 'successful-wrangler-operations')
  const executable = join(binDir, 'wrangler')
  await mkdir(binDir, { recursive: true })
  await writeFile(
    executable,
    `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'\nappendFileSync(process.env.WRANGLER_OPERATIONS, JSON.stringify(process.argv.slice(2)) + '\\n')\n`,
    { mode: 0o700 },
  )
  return {
    operations,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      WRANGLER_OPERATIONS: operations,
    },
  }
}

async function createExportingFakeWrangler(
  workDir: string,
  d1ExportSql: string,
  d1AttachmentKeys: string[],
): Promise<{
  operations: string
  env: NodeJS.ProcessEnv
}> {
  const binDir = join(workDir, 'exporting-bin')
  const operations = join(workDir, 'wrangler-operations')
  const executable = join(binDir, 'wrangler')
  await mkdir(binDir, { recursive: true })
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
const args = process.argv.slice(2)
if (args[0] === 'd1' && args[1] === 'export') {
  const output = args[args.indexOf('--output') + 1]
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, process.env.D1_EXPORT_SQL)
  appendFileSync(process.env.WRANGLER_OPERATIONS, 'd1 export\\n')
  process.exit(0)
}
if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--file')) {
  appendFileSync(process.env.WRANGLER_OPERATIONS, 'd1 validation import\\n')
  process.exit(0)
}
if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--command')) {
  const keys = JSON.parse(process.env.D1_ATTACHMENT_KEYS)
  process.stdout.write(JSON.stringify([{ results: keys.map((objectKey) => ({ objectKey })) }]))
  appendFileSync(process.env.WRANGLER_OPERATIONS, 'd1 validation query\\n')
  process.exit(0)
}
if (args[0] === 'r2' && args[1] === 'object' && args[2] === 'get') {
  const output = args[args.indexOf('--file') + 1]
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, 'synthetic-r2-body')
  appendFileSync(process.env.WRANGLER_OPERATIONS, 'r2 object get\\n')
  process.exit(0)
}
process.exit(98)
`,
    { mode: 0o700 },
  )
  return {
    operations,
    env: {
      ...process.env,
      D1_ATTACHMENT_KEYS: JSON.stringify(d1AttachmentKeys),
      D1_EXPORT_SQL: d1ExportSql,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      WRANGLER_OPERATIONS: operations,
    },
  }
}

async function createConcurrentExportFakeWrangler(workDir: string): Promise<{
  env: NodeJS.ProcessEnv
  firstExportStarted: string
  releaseFirstExport: string
  secondExportStarted: string
}> {
  const binDir = join(workDir, 'concurrent-export-bin')
  const coordinationDir = join(workDir, 'concurrent-export-coordination')
  const firstExportStarted = join(coordinationDir, 'A-d1-started')
  const releaseFirstExport = join(coordinationDir, 'release-A-d1')
  const secondExportStarted = join(coordinationDir, 'B-d1-started')
  const executable = join(binDir, 'wrangler')
  await mkdir(binDir, { recursive: true })
  await mkdir(coordinationDir, { recursive: true })
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = process.argv.slice(2)
const runId = process.env.GENERATION_EXPORT_RUN_ID
const coordinationDir = process.env.GENERATION_EXPORT_COORDINATION_DIR
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
if (args[0] === 'd1' && args[1] === 'export') {
  writeFileSync(join(coordinationDir, \`\${runId}-d1-started\`), '')
  if (runId === 'A') {
    const deadline = Date.now() + 5000
    while (!existsSync(join(coordinationDir, 'release-A-d1'))) {
      if (Date.now() >= deadline) process.exit(97)
      await delay(10)
    }
  }
  const output = args[args.indexOf('--output') + 1]
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, \`CREATE TABLE cipher_attachments (object_key TEXT NOT NULL UNIQUE); INSERT INTO cipher_attachments VALUES ('attachments/object-one'); -- generation \${runId}\\n\`)
  process.exit(0)
}
if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--file')) {
  process.exit(0)
}
if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--command')) {
  process.stdout.write(JSON.stringify([{ results: [{ objectKey: 'attachments/object-one' }] }]))
  process.exit(0)
}
if (args[0] === 'r2' && args[1] === 'object' && args[2] === 'get') {
  const output = args[args.indexOf('--file') + 1]
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, \`BODY-\${runId}\`)
  process.exit(0)
}
process.exit(98)
`,
    { mode: 0o700 },
  )
  return {
    env: {
      ...process.env,
      GENERATION_EXPORT_COORDINATION_DIR: coordinationDir,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    firstExportStarted,
    releaseFirstExport,
    secondExportStarted,
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (true) {
    try {
      await readFile(path)
      return
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for fixture file: ${path}`, {
          cause: error,
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
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
