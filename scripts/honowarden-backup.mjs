#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'

const manifestFileName = 'backup-manifest.json'
const d1ExportFileName = 'd1.sql'
const r2DirectoryName = 'r2'
const manifestSchemaVersion = 1
const defaultR2ListPageSize = 1000
const maxR2ListPageSize = 1000
const defaultR2Region = 'auto'
const credentialGenerationSchemaVersion = 1
const backupSourceDomain = 'honowarden.backup-source.v1'
const credentialGenerationDomain = 'honowarden.credential-generation-binding.v1'
const inventoryValidationDirectoryName = '.inventory-validation'
const generationBoundExportClaimFileName = '.generation-bound-export.lock'
const maxCapturedCommandBytes = 16 * 1024 * 1024

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv

  if (command === 'export') {
    const options = parseOptions(rest)
    await runExport(options)
    return
  }

  if (command === 'restore') {
    const options = parseOptions(rest)
    await runRestore(options)
    return
  }

  if (command === 'evidence') {
    const options = parseOptions(rest)
    await runEvidence(options)
    return
  }

  printUsage()
  process.exitCode = 1
}

async function runExport(options) {
  rejectUnsupportedBindingOptions('export', options)
  const outDir = resolveRequiredPath(options.out, '--out')
  const database = requireValue(options.database, '--database')
  const bucket = requireValue(options.bucket, '--bucket')
  const mode = parseMode(options.mode)
  const generationManifestSha256 = validateOptionalSha256(
    options.generationManifestSha256,
    '--generation-manifest-sha256',
  )
  enforceGenerationBoundExportSource({
    generationManifestSha256,
    mode,
    options,
    execute: Boolean(options.execute),
  })
  const result = await withGenerationBoundOutputClaim(
    { generationManifestSha256, outDir },
    async () => {
      rejectRemotePersistence(mode, options)
      const execute = Boolean(options.execute)
      const objectDiscovery = await resolveExportObjects({
        bucket,
        mode,
        options,
      })
      const d1File = join(outDir, d1ExportFileName)
      const r2Dir = join(outDir, r2DirectoryName)
      const objects = objectDiscovery.keys.map((key) => ({
        key,
        file: `${r2DirectoryName}/${objectFileName(key)}`,
      }))
      const commands = [
        buildD1ExportCommand({ database, d1File, mode, options }),
        ...objects.map((object) =>
          buildR2GetCommand({
            bucket,
            key: object.key,
            file: join(outDir, object.file),
            mode,
            options,
          }),
        ),
      ]
      const manifest = {
        schemaVersion: manifestSchemaVersion,
        createdAt: new Date().toISOString(),
        mode,
        database,
        bucket,
        d1: {
          file: d1ExportFileName,
        },
        r2: {
          objectListRequired: objectDiscovery.objectListRequired,
          objectListSource: objectDiscovery.objectListSource,
          ...(objectDiscovery.prefix === undefined
            ? {}
            : { prefix: objectDiscovery.prefix }),
          ...(objectDiscovery.pageSize === undefined
            ? {}
            : { pageSize: objectDiscovery.pageSize }),
          objects,
        },
        restore: {
          command: 'node scripts/honowarden-backup.mjs restore',
        },
        commands,
      }

      await mkdir(r2Dir, { recursive: true })
      if (!generationManifestSha256) {
        await writeManifest(outDir, manifest)
      }

      if (execute) {
        if (generationManifestSha256) {
          await runCommand(commands[0])
          await verifyGenerationBoundR2Inventory({
            database,
            d1File,
            inventoryKeys: objectDiscovery.keys,
            options,
            outDir,
          })
          await runCommands(commands.slice(1))
        } else {
          await runCommands(commands)
        }
        await addManifestHashes(outDir, manifest)
        if (generationManifestSha256) {
          manifest.credentialGeneration = deriveCredentialGenerationBinding({
            lifecycleManifestSha256: generationManifestSha256,
            manifest,
          })
        }
        await writeManifest(outDir, manifest)
      }
      const manifestPath = join(outDir, manifestFileName)

      return {
        action: 'export',
        audit: await buildBackupAuditPacket({
          name: 'backup.export',
          manifestPath,
          resultStatus: execute ? 'executed' : 'planned',
        }),
        executed: execute,
        manifest: manifestPath,
        commands,
      }
    },
  )
  writeJson(result)
}

async function runRestore(options) {
  rejectUnsupportedBindingOptions('restore', options)
  const fromDir = resolveRequiredPath(options.from, '--from')
  const expectedManifestSha256 = validateOptionalSha256(
    options.expectedManifestSha256,
    '--expected-manifest-sha256',
  )
  const expectedGenerationManifestSha256 = validateOptionalSha256(
    options.expectedGenerationManifestSha256,
    '--expected-generation-manifest-sha256',
  )
  if (expectedGenerationManifestSha256 && !expectedManifestSha256) {
    throw new Error(
      '--expected-generation-manifest-sha256 requires --expected-manifest-sha256',
    )
  }
  const { manifest, manifestSha256 } = await readManifestWithIdentity(fromDir)
  verifyExpectedRestoreBinding({
    manifest,
    manifestSha256,
    expectedManifestSha256,
    expectedGenerationManifestSha256,
  })
  const database = options.database ?? manifest.database
  const bucket = options.bucket ?? manifest.bucket
  const mode = parseMode(options.mode ?? manifest.mode)
  rejectRemotePersistence(mode, options)
  const execute = Boolean(options.execute)
  const d1File = join(fromDir, manifest.d1.file)
  const commands = [
    buildD1ImportCommand({ database, d1File, mode, options }),
    ...manifest.r2.objects.map((object) =>
      buildR2PutCommand({
        bucket,
        key: object.key,
        file: join(fromDir, object.file),
        mode,
        options,
      }),
    ),
  ]

  if (execute) {
    requireFreshTargetConfirmation(options)
    await verifyBackupFiles(fromDir, manifest)
    await runCommands(commands)
  }
  const manifestPath = join(fromDir, manifestFileName)

  writeJson({
    action: 'restore',
    audit: await buildBackupAuditPacket({
      name: 'backup.restore',
      manifestPath,
      manifestSha256,
      resultStatus: execute ? 'executed' : 'planned',
    }),
    executed: execute,
    manifest: manifestPath,
    commands,
  })
}

async function runEvidence(options) {
  rejectUnsupportedBindingOptions('evidence', options)
  const fromDir = resolveRequiredPath(options.from, '--from')
  const outPath = options.out ? resolve(options.out) : undefined
  const sourceCommit = validateOptionalSourceCommit(options.sourceCommit)
  const runUrl = validateOptionalRunUrl(options.runUrl)
  const { manifest, manifestSha256 } = await readManifestWithIdentity(fromDir)
  await verifyBackupFiles(fromDir, manifest)

  const d1Path = join(fromDir, manifest.d1.file)
  const d1Stats = await stat(d1Path)
  const objectEvidence = await buildR2Evidence(fromDir, manifest)
  const evidence = {
    schemaVersion: 1,
    action: 'backup.evidence',
    status: 'executed',
    generatedAt: new Date().toISOString(),
    sourceCommit,
    runUrl,
    mode: manifest.mode,
    createdAt: manifest.createdAt,
    manifestId: `sha256:${manifestSha256}`,
    credentialGeneration: manifest.credentialGeneration
      ? {
          manifestSha256: manifest.credentialGeneration.manifestSha256,
        }
      : null,
    d1: {
      sha256: manifest.d1.sha256,
      sizeBytes: d1Stats.size,
    },
    r2: objectEvidence,
    safety: {
      includesDatabaseName: false,
      includesBucketName: false,
      includesObjectKeys: false,
      includesObjectBodies: false,
    },
  }

  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`)
  }

  writeJson(evidence)
}

async function buildR2Evidence(fromDir, manifest) {
  let totalSizeBytes = 0
  const objectHashes = []

  for (const object of manifest.r2.objects) {
    const objectPath = join(fromDir, object.file)
    const objectStats = await stat(objectPath)
    totalSizeBytes += objectStats.size
    objectHashes.push(object.sha256)
  }

  return {
    objectCount: manifest.r2.objects.length,
    objectListRequired: manifest.r2.objectListRequired,
    objectListSource: manifest.r2.objectListSource ?? null,
    objectDigestId: `sha256:${sha256Hex(objectHashes.sort().join('\n'))}`,
    totalSizeBytes,
  }
}

async function buildBackupAuditPacket({
  name,
  manifestPath,
  manifestSha256,
  resultStatus,
}) {
  return {
    name,
    outcome: 'success',
    manifestId: `sha256:${manifestSha256 ?? (await sha256File(manifestPath))}`,
    resultStatus,
  }
}

function buildD1ExportCommand({ database, d1File, mode, options }) {
  return [
    'wrangler',
    'd1',
    'export',
    database,
    modeFlag(mode),
    '--output',
    d1File,
    '--skip-confirmation',
    ...wranglerEnvFlags(options),
    ...wranglerConfigFlags(options),
  ]
}

function buildD1ImportCommand({ database, d1File, mode, options }) {
  return [
    'wrangler',
    'd1',
    'execute',
    database,
    modeFlag(mode),
    '--file',
    d1File,
    '--yes',
    ...wranglerEnvFlags(options),
    ...wranglerConfigFlags(options),
    ...localPersistenceFlags(options),
  ]
}

function buildR2GetCommand({ bucket, key, file, mode, options }) {
  return [
    'wrangler',
    'r2',
    'object',
    'get',
    `${bucket}/${key}`,
    modeFlag(mode),
    '--file',
    file,
    ...wranglerEnvFlags(options),
    ...wranglerConfigFlags(options),
    ...localPersistenceFlags(options),
  ]
}

function buildR2PutCommand({ bucket, key, file, mode, options }) {
  return [
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucket}/${key}`,
    modeFlag(mode),
    '--file',
    file,
    ...wranglerEnvFlags(options),
    ...wranglerConfigFlags(options),
    ...localPersistenceFlags(options),
  ]
}

function wranglerEnvFlags(options) {
  const flags = []

  if (options.env) {
    flags.push('--env', options.env)
  }

  return flags
}

function wranglerConfigFlags(options) {
  return options.config ? ['--config', resolve(options.config)] : []
}

function localPersistenceFlags(options) {
  const flags = []

  if (options.persistTo) {
    flags.push('--persist-to', options.persistTo)
  }

  return flags
}

async function runCommands(commands) {
  for (const command of commands) {
    await runCommand(command)
  }
}

function runCommand(command) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['inherit', process.stderr, process.stderr],
      shell: process.platform === 'win32',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolveCommand()
        return
      }

      rejectCommand(
        new Error(
          `Command failed with exit code ${code}: ${command.join(' ')}`,
        ),
      )
    })

    child.on('error', rejectCommand)
  })
}

function runJsonCommand(command) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['inherit', 'pipe', process.stderr],
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stdoutBytes = 0
    let settled = false

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (settled) return
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > maxCapturedCommandBytes) {
        settled = true
        child.kill('SIGTERM')
        rejectCommand(new Error('Wrangler JSON output exceeded 16 MiB'))
        return
      }
      stdout += chunk
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (code !== 0) {
        rejectCommand(
          new Error(
            `Command failed with exit code ${code}: ${command.join(' ')}`,
          ),
        )
        return
      }
      try {
        resolveCommand(JSON.parse(stdout))
      } catch {
        rejectCommand(new Error('Wrangler returned invalid JSON'))
      }
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      rejectCommand(error)
    })
  })
}

async function readObjectList(path) {
  const contents = await readFile(path, 'utf8')
  const keys = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  for (const key of keys) {
    validateObjectKey(key)
  }

  return [...new Set(keys)]
}

async function resolveExportObjects({ bucket, mode, options }) {
  if (options.r2Objects && options.r2List) {
    throw new Error('--r2-objects and --r2-list cannot be used together')
  }

  if (options.r2Objects) {
    return {
      objectListRequired: true,
      objectListSource: 'explicit',
      keys: await readObjectList(options.r2Objects),
    }
  }

  if (!options.r2List) {
    return {
      objectListRequired: true,
      objectListSource: 'none',
      keys: [],
    }
  }

  if (mode !== 'remote') {
    throw new Error(
      '--r2-list requires --mode remote because Wrangler does not expose a local R2 object listing command',
    )
  }

  const prefix = options.r2Prefix ?? ''
  validateObjectPrefix(prefix)
  const pageSize = parseR2ListPageSize(options.r2ListPageSize)
  const config = resolveR2ListConfig(options)
  const keys = await listR2ObjectKeys({
    bucket,
    prefix,
    pageSize,
    config,
  })

  return {
    objectListRequired: false,
    objectListSource: 'r2_list_objects_v2',
    prefix,
    pageSize,
    keys,
  }
}

function resolveR2ListConfig(options) {
  const accountId =
    options.r2AccountId ??
    process.env.R2_ACCOUNT_ID ??
    process.env.CLOUDFLARE_ACCOUNT_ID
  const endpoint =
    options.r2ListEndpoint ??
    process.env.R2_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined)
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
  const region = options.r2Region ?? process.env.R2_REGION ?? defaultR2Region

  if (!endpoint) {
    throw new Error(
      '--r2-list requires --r2-list-endpoint or CLOUDFLARE_ACCOUNT_ID/R2_ACCOUNT_ID',
    )
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      '--r2-list requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY',
    )
  }

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    region,
  }
}

async function listR2ObjectKeys({ bucket, prefix, pageSize, config }) {
  const keys = []
  const seenKeys = new Set()
  const seenContinuationTokens = new Set()
  let continuationToken

  do {
    const page = await fetchR2ListObjectsPage({
      bucket,
      prefix,
      pageSize,
      continuationToken,
      config,
    })

    for (const key of page.keys) {
      validateObjectKey(key)

      if (prefix && !key.startsWith(prefix)) {
        throw new Error(`R2 object key does not match requested prefix: ${key}`)
      }

      if (seenKeys.has(key)) {
        throw new Error(`duplicate R2 object key returned by listing: ${key}`)
      }

      seenKeys.add(key)
      keys.push(key)
    }

    if (!page.isTruncated) {
      continuationToken = undefined
      continue
    }

    if (!page.nextContinuationToken) {
      throw new Error(
        'R2 object listing was truncated without a continuation token',
      )
    }

    if (seenContinuationTokens.has(page.nextContinuationToken)) {
      throw new Error('R2 object listing repeated a continuation token')
    }

    seenContinuationTokens.add(page.nextContinuationToken)
    continuationToken = page.nextContinuationToken
  } while (continuationToken)

  return keys
}

async function fetchR2ListObjectsPage({
  bucket,
  prefix,
  pageSize,
  continuationToken,
  config,
}) {
  const request = buildR2ListObjectsRequest({
    bucket,
    prefix,
    pageSize,
    continuationToken,
    config,
    now: new Date(),
  })
  const response = await globalThis.fetch(request.url, {
    method: 'GET',
    headers: request.headers,
  })
  const body = await response.text()

  if (!response.ok) {
    throw new Error(
      `R2 object listing failed with HTTP ${response.status}: ${body.slice(0, 500)}`,
    )
  }

  return parseListObjectsXml(body)
}

function buildR2ListObjectsRequest({
  bucket,
  prefix,
  pageSize,
  continuationToken,
  config,
  now,
}) {
  const query = [
    ['encoding-type', 'url'],
    ['list-type', '2'],
    ['max-keys', String(pageSize)],
  ]

  if (prefix) {
    query.push(['prefix', prefix])
  }

  if (continuationToken) {
    query.push(['continuation-token', continuationToken])
  }

  const url = buildR2ListObjectsUrl({
    endpoint: config.endpoint,
    bucket,
    query,
  })
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex('')
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n')
  const canonicalRequest = [
    'GET',
    url.pathname,
    canonicalQueryString(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')
  const signingKey = createSigningKey({
    secretAccessKey: config.secretAccessKey,
    dateStamp,
    region: config.region,
  })
  const signature = hmacHex(signingKey, stringToSign)
  const authorization = [
    'AWS4-HMAC-SHA256',
    `Credential=${config.accessKeyId}/${credentialScope},`,
    `SignedHeaders=${signedHeaders},`,
    `Signature=${signature}`,
  ].join(' ')

  return {
    url,
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  }
}

function buildR2ListObjectsUrl({ endpoint, bucket, query }) {
  const url = new URL(endpoint)
  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = `${basePath}/${encodePathSegment(bucket)}`
  url.search = canonicalQueryString(query)
  return url
}

function canonicalQueryString(query) {
  return [...query]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyCompare = leftKey.localeCompare(rightKey)
      return keyCompare === 0 ? leftValue.localeCompare(rightValue) : keyCompare
    })
    .map(
      ([key, value]) =>
        `${encodeAwsURIComponent(key)}=${encodeAwsURIComponent(value)}`,
    )
    .join('&')
}

function parseListObjectsXml(xml) {
  const keys = [
    ...xml.matchAll(/<Contents(?:\s[^>]*)?>([\s\S]*?)<\/Contents>/g),
  ]
    .map((match) => requireXmlTag(match[1], 'Key'))
    .map((key) => decodeURIComponent(decodeXmlEntities(key)))
  const isTruncated = optionalXmlTag(xml, 'IsTruncated') === 'true'
  const nextContinuationToken = optionalXmlTag(xml, 'NextContinuationToken')

  return {
    keys,
    isTruncated,
    nextContinuationToken: nextContinuationToken
      ? decodeXmlEntities(nextContinuationToken)
      : undefined,
  }
}

function requireXmlTag(xml, tagName) {
  const value = optionalXmlTag(xml, tagName)

  if (value === undefined) {
    throw new Error(`R2 object listing response is missing ${tagName}`)
  }

  return value
}

function optionalXmlTag(xml, tagName) {
  const match = xml.match(
    new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`),
  )

  return match?.[1]
}

function decodeXmlEntities(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

async function writeManifest(outDir, manifest) {
  const manifestPath = join(outDir, manifestFileName)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function readManifestWithIdentity(fromDir) {
  const manifestPath = join(fromDir, manifestFileName)
  const contents = await readFile(manifestPath)
  const manifest = JSON.parse(contents.toString('utf8'))

  if (
    manifest?.schemaVersion !== manifestSchemaVersion ||
    typeof manifest.database !== 'string' ||
    typeof manifest.bucket !== 'string' ||
    typeof manifest.d1?.file !== 'string' ||
    !Array.isArray(manifest.r2?.objects) ||
    typeof manifest.r2.objectListRequired !== 'boolean'
  ) {
    throw new Error(`Invalid backup manifest: ${manifestPath}`)
  }

  assertCredentialGenerationShape(manifest.credentialGeneration, manifestPath)

  assertSafeManifestPath(manifest.d1.file, 'd1.file')

  for (const [index, object] of manifest.r2.objects.entries()) {
    if (typeof object?.key !== 'string' || typeof object?.file !== 'string') {
      throw new Error(`Invalid backup manifest: ${manifestPath}`)
    }

    validateObjectKey(object.key)
    assertSafeManifestPath(
      object.file,
      `r2.objects[${index}].file`,
      `${r2DirectoryName}/`,
    )
    assertManifestObjectFileMatchesKey(object, index)
  }

  verifyCredentialGenerationBinding(manifest, manifestPath)

  return {
    manifest,
    manifestSha256: sha256Hex(contents),
  }
}

function objectFileName(key) {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--') {
      continue
    }

    switch (arg) {
      case '--execute':
        options.execute = true
        break
      case '--confirm-fresh-target':
        options.confirmFreshTarget = true
        break
      case '--r2-list':
        options.r2List = true
        break
      case '--out':
      case '--from':
      case '--database':
      case '--bucket':
      case '--mode':
      case '--r2-objects':
      case '--r2-prefix':
      case '--r2-list-page-size':
      case '--r2-list-endpoint':
      case '--r2-account-id':
      case '--r2-region':
      case '--env':
      case '--config':
      case '--persist-to':
      case '--generation-manifest-sha256':
      case '--expected-manifest-sha256':
      case '--expected-generation-manifest-sha256':
      case '--source-commit':
      case '--run-url': {
        const value = args[index + 1]
        if (!value) {
          throw new Error(`${arg} requires a value`)
        }
        options[toCamelCase(arg.slice(2))] = value
        index += 1
        break
      }
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function parseMode(value = 'local') {
  if (value === 'local' || value === 'remote') {
    return value
  }

  throw new Error('--mode must be local or remote')
}

function rejectRemotePersistence(mode, options) {
  if (mode === 'remote' && options.persistTo) {
    throw new Error('--persist-to can only be used with --mode local')
  }
}

function enforceGenerationBoundExportSource({
  generationManifestSha256,
  mode,
  options,
  execute,
}) {
  if (!generationManifestSha256) {
    return
  }

  if (mode !== 'local') {
    throw new Error('--generation-manifest-sha256 requires --mode local')
  }
  if (!options.config) {
    throw new Error('--generation-manifest-sha256 requires --config')
  }
  if (!options.persistTo) {
    throw new Error('--generation-manifest-sha256 requires --persist-to')
  }

  const configPath = resolve(options.config)
  const expectedPersistenceRoot = join(
    dirname(configPath),
    '.wrangler',
    'state',
  )
  if (resolve(options.persistTo) !== expectedPersistenceRoot) {
    throw new Error(
      '--persist-to must equal <config-directory>/.wrangler/state for a generation-bound export',
    )
  }
  if (!options.r2Objects) {
    throw new Error('--generation-manifest-sha256 requires --r2-objects')
  }
  if (!execute) {
    throw new Error('--generation-manifest-sha256 requires --execute')
  }
}

async function withGenerationBoundOutputClaim(
  { generationManifestSha256, outDir },
  operation,
) {
  if (!generationManifestSha256) {
    return operation()
  }

  const claimPath = await claimFreshGenerationBoundOutput(outDir)
  try {
    return await operation()
  } finally {
    await rm(claimPath, { force: true })
  }
}

async function claimFreshGenerationBoundOutput(outDir) {
  await mkdir(outDir, { recursive: true, mode: 0o700 })

  const outputStats = await lstat(outDir)
  if (!outputStats.isDirectory()) {
    throw new Error(
      '--out must be missing or an empty directory for a generation-bound export',
    )
  }

  const claimPath = join(outDir, generationBoundExportClaimFileName)
  try {
    await writeFile(claimPath, '', { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('generation-bound output is already claimed', {
        cause: error,
      })
    }
    throw error
  }

  try {
    const entries = await readdir(outDir)
    if (
      entries.length !== 1 ||
      entries[0] !== generationBoundExportClaimFileName
    ) {
      throw new Error(
        '--out must be missing or an empty directory for a generation-bound export',
      )
    }
    return claimPath
  } catch (error) {
    await rm(claimPath, { force: true })
    throw error
  }
}

async function verifyGenerationBoundR2Inventory({
  database,
  d1File,
  inventoryKeys,
  options,
  outDir,
}) {
  const validationRoot = join(outDir, inventoryValidationDirectoryName)
  await mkdir(validationRoot, { recursive: true, mode: 0o700 })

  try {
    let executions
    try {
      await runCommand(
        buildD1ImportCommand({
          database,
          d1File,
          mode: 'local',
          options: { ...options, persistTo: validationRoot },
        }),
      )
      executions = await runJsonCommand([
        'wrangler',
        'd1',
        'execute',
        database,
        '--local',
        '--command',
        'SELECT object_key AS objectKey FROM cipher_attachments ORDER BY object_key;',
        '--yes',
        '--json',
        ...wranglerEnvFlags(options),
        ...wranglerConfigFlags(options),
        '--persist-to',
        validationRoot,
      ])
    } catch {
      throw new Error(
        'Generation-bound D1 export could not be validated for R2 attachment coverage',
      )
    }

    if (
      !Array.isArray(executions) ||
      executions.length !== 1 ||
      !Array.isArray(executions[0]?.results)
    ) {
      throw new Error(
        'Generation-bound D1 export returned invalid attachment coverage evidence',
      )
    }

    const referencedKeys = executions[0].results.map((row) => row?.objectKey)
    if (
      referencedKeys.some((key) => typeof key !== 'string') ||
      new Set(referencedKeys).size !== referencedKeys.length
    ) {
      throw new Error(
        'Generation-bound D1 export returned invalid attachment object keys',
      )
    }
    for (const key of referencedKeys) validateObjectKey(key)

    const inventory = new Set(inventoryKeys)
    const missingCount = referencedKeys.filter(
      (key) => !inventory.has(key),
    ).length
    if (missingCount !== 0) {
      throw new Error(
        `Generation-bound R2 inventory is missing ${missingCount} D1 attachment object${missingCount === 1 ? '' : 's'}`,
      )
    }
  } finally {
    await rm(validationRoot, { recursive: true, force: true })
  }
}

function deriveCredentialGenerationBinding({
  lifecycleManifestSha256,
  manifest,
}) {
  if (
    !isSha256(lifecycleManifestSha256) ||
    !isSha256(manifest.d1?.sha256) ||
    !Array.isArray(manifest.r2?.objects) ||
    manifest.r2.objects.some((object) => !isSha256(object.sha256))
  ) {
    throw new Error(
      'Credential generation binding requires complete D1 and R2 checksums',
    )
  }

  const sourceStateSha256 = sha256Hex(
    JSON.stringify({
      domain: backupSourceDomain,
      d1: { sha256: manifest.d1.sha256 },
      r2: {
        objects: [...manifest.r2.objects]
          .sort(compareObjectKeys)
          .map((object) => ({
            key: object.key,
            sha256: object.sha256,
          })),
      },
    }),
  )
  const manifestSha256 = sha256Hex(
    JSON.stringify({
      domain: credentialGenerationDomain,
      lifecycleManifestSha256,
      sourceStateSha256,
    }),
  )

  return {
    schemaVersion: credentialGenerationSchemaVersion,
    lifecycleManifestSha256,
    sourceStateSha256,
    manifestSha256,
  }
}

function assertCredentialGenerationShape(credentialGeneration, manifestPath) {
  if (credentialGeneration === undefined) {
    return
  }

  if (
    !credentialGeneration ||
    typeof credentialGeneration !== 'object' ||
    Array.isArray(credentialGeneration) ||
    Object.keys(credentialGeneration).length !== 4 ||
    credentialGeneration.schemaVersion !== credentialGenerationSchemaVersion ||
    !Object.hasOwn(credentialGeneration, 'lifecycleManifestSha256') ||
    !isSha256(credentialGeneration.lifecycleManifestSha256) ||
    !Object.hasOwn(credentialGeneration, 'sourceStateSha256') ||
    !isSha256(credentialGeneration.sourceStateSha256) ||
    !Object.hasOwn(credentialGeneration, 'manifestSha256') ||
    !isSha256(credentialGeneration.manifestSha256)
  ) {
    throw new Error(
      `Invalid backup manifest credential generation: ${manifestPath}`,
    )
  }
}

function verifyCredentialGenerationBinding(manifest, manifestPath) {
  if (!manifest.credentialGeneration) {
    return
  }

  let expected
  try {
    expected = deriveCredentialGenerationBinding({
      lifecycleManifestSha256:
        manifest.credentialGeneration.lifecycleManifestSha256,
      manifest,
    })
  } catch {
    throw new Error(
      `Invalid backup manifest credential generation: ${manifestPath}`,
    )
  }

  if (
    expected.sourceStateSha256 !==
      manifest.credentialGeneration.sourceStateSha256 ||
    expected.manifestSha256 !== manifest.credentialGeneration.manifestSha256
  ) {
    throw new Error(
      `Backup credential generation binding mismatch: ${manifestPath}`,
    )
  }
}

function compareObjectKeys(left, right) {
  if (left.key === right.key) return 0
  return left.key < right.key ? -1 : 1
}

function requireFreshTargetConfirmation(options) {
  if (!options.confirmFreshTarget) {
    throw new Error(
      '--confirm-fresh-target is required before restore --execute',
    )
  }
}

function validateOptionalSourceCommit(value) {
  if (value === undefined) {
    return null
  }

  if (!/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error('--source-commit must be a 40-character git SHA')
  }

  return value
}

function validateOptionalRunUrl(value) {
  if (value === undefined) {
    return null
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('--run-url must be a valid HTTPS URL')
  }

  if (url.protocol !== 'https:') {
    throw new Error('--run-url must be a valid HTTPS URL')
  }

  return url.toString()
}

function validateOptionalSha256(value, flagName) {
  if (value === undefined) {
    return undefined
  }

  if (!isSha256(value)) {
    throw new Error(`${flagName} must be a lowercase SHA-256`)
  }

  return value
}

function rejectUnsupportedBindingOptions(command, options) {
  const ownership = [
    {
      option: 'generationManifestSha256',
      flag: '--generation-manifest-sha256',
      command: 'export',
    },
    {
      option: 'expectedManifestSha256',
      flag: '--expected-manifest-sha256',
      command: 'restore',
    },
    {
      option: 'expectedGenerationManifestSha256',
      flag: '--expected-generation-manifest-sha256',
      command: 'restore',
    },
  ]

  for (const owner of ownership) {
    if (options[owner.option] !== undefined && command !== owner.command) {
      throw new Error(`${owner.flag} is only supported by ${owner.command}`)
    }
  }
}

function verifyExpectedRestoreBinding({
  manifest,
  manifestSha256,
  expectedManifestSha256,
  expectedGenerationManifestSha256,
}) {
  if (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256) {
    throw new Error(
      `Backup manifest SHA-256 mismatch: expected ${expectedManifestSha256}, received ${manifestSha256}`,
    )
  }

  if (!expectedGenerationManifestSha256) {
    return
  }

  const actualGenerationManifestSha256 =
    manifest.credentialGeneration?.manifestSha256
  if (!actualGenerationManifestSha256) {
    throw new Error('Backup manifest is missing credential generation binding')
  }
  if (actualGenerationManifestSha256 !== expectedGenerationManifestSha256) {
    throw new Error(
      `Backup credential generation SHA-256 mismatch: expected ${expectedGenerationManifestSha256}, received ${actualGenerationManifestSha256}`,
    )
  }
}

function modeFlag(mode) {
  return mode === 'remote' ? '--remote' : '--local'
}

function resolveRequiredPath(value, flagName) {
  return resolve(requireValue(value, flagName))
}

function requireValue(value, flagName) {
  if (!value) {
    throw new Error(`${flagName} is required`)
  }

  return value
}

function validateObjectKey(key) {
  if (!key || key.startsWith('/') || key.includes('\0')) {
    throw new Error(`Invalid R2 object key: ${key}`)
  }
}

function validateObjectPrefix(prefix) {
  if (prefix.startsWith('/') || prefix.includes('\0')) {
    throw new Error(`Invalid R2 object prefix: ${prefix}`)
  }
}

function assertManifestObjectFileMatchesKey(object, index) {
  const expected = `${r2DirectoryName}/${objectFileName(object.key)}`

  if (object.file !== expected) {
    throw new Error(
      `Invalid backup manifest: object file does not match key at r2.objects[${index}].file`,
    )
  }
}

function assertSafeManifestPath(value, fieldName, requiredPrefix) {
  if (
    !value ||
    typeof value !== 'string' ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(`Invalid backup manifest path: ${fieldName}`)
  }

  if (requiredPrefix && !value.startsWith(requiredPrefix)) {
    throw new Error(`Invalid backup manifest path: ${fieldName}`)
  }
}

async function addManifestHashes(outDir, manifest) {
  manifest.d1.sha256 = await sha256File(join(outDir, manifest.d1.file))

  for (const object of manifest.r2.objects) {
    object.sha256 = await sha256File(join(outDir, object.file))
  }
}

async function verifyBackupFiles(fromDir, manifest) {
  await verifyManifestFileHash({
    path: join(fromDir, manifest.d1.file),
    expected: manifest.d1.sha256,
    fieldName: 'd1.sha256',
  })

  for (const [index, object] of manifest.r2.objects.entries()) {
    await verifyManifestFileHash({
      path: join(fromDir, object.file),
      expected: object.sha256,
      fieldName: `r2.objects[${index}].sha256`,
    })
  }
}

async function verifyManifestFileHash({ path, expected, fieldName }) {
  if (!isSha256(expected)) {
    throw new Error(`Backup manifest missing checksum: ${fieldName}`)
  }

  const actual = await sha256File(path)

  if (actual !== expected) {
    throw new Error(`Backup file checksum mismatch: ${path}`)
  }
}

async function sha256File(path) {
  const contents = await readFile(path)
  return createHash('sha256').update(contents).digest('hex')
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function parseR2ListPageSize(value) {
  if (value === undefined) {
    return defaultR2ListPageSize
  }

  const pageSize = Number(value)

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > maxR2ListPageSize
  ) {
    throw new Error(
      `--r2-list-page-size must be between 1 and ${maxR2ListPageSize}`,
    )
  }

  return pageSize
}

function formatAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function createSigningKey({ secretAccessKey, dateStamp, region }) {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp)
  const dateRegionKey = hmacBuffer(dateKey, region)
  const dateRegionServiceKey = hmacBuffer(dateRegionKey, 's3')
  return hmacBuffer(dateRegionServiceKey, 'aws4_request')
}

function hmacBuffer(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function encodePathSegment(value) {
  return encodeAwsURIComponent(value)
}

function encodeAwsURIComponent(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-backup.mjs export --out <dir> --database <name> --bucket <name> [--r2-objects <file> | --r2-list] [--r2-prefix <prefix>] [--r2-list-page-size <1-1000>] [--mode local|remote] [--config <file>] [--persist-to <dir>] [--generation-manifest-sha256 <sha256>] [--execute]
  node scripts/honowarden-backup.mjs restore --from <dir> [--database <name>] [--bucket <name>] [--mode local|remote] [--config <file>] [--expected-manifest-sha256 <sha256>] [--expected-generation-manifest-sha256 <sha256>] [--execute --confirm-fresh-target]
  node scripts/honowarden-backup.mjs evidence --from <dir> [--out <file>] [--source-commit <sha>] [--run-url <url>]

Generation-bound export is execute-only and requires --mode local, --config <file>, --persist-to <config-directory>/.wrangler/state, and --r2-objects <file>.
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
