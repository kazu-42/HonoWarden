#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

  printUsage()
  process.exitCode = 1
}

async function runExport(options) {
  const outDir = resolveRequiredPath(options.out, '--out')
  const database = requireValue(options.database, '--database')
  const bucket = requireValue(options.bucket, '--bucket')
  const mode = parseMode(options.mode)
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
  await writeManifest(outDir, manifest)

  if (execute) {
    await runCommands(commands)
    await addManifestHashes(outDir, manifest)
    await writeManifest(outDir, manifest)
  }
  const manifestPath = join(outDir, manifestFileName)

  writeJson({
    action: 'export',
    audit: await buildBackupAuditPacket({
      name: 'backup.export',
      manifestPath,
      resultStatus: execute ? 'executed' : 'planned',
    }),
    executed: execute,
    manifest: manifestPath,
    commands,
  })
}

async function runRestore(options) {
  const fromDir = resolveRequiredPath(options.from, '--from')
  const manifest = await readManifest(fromDir)
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
      resultStatus: execute ? 'executed' : 'planned',
    }),
    executed: execute,
    manifest: manifestPath,
    commands,
  })
}

async function buildBackupAuditPacket({ name, manifestPath, resultStatus }) {
  return {
    name,
    outcome: 'success',
    manifestId: `sha256:${await sha256File(manifestPath)}`,
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
      stdio: 'inherit',
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

async function readManifest(fromDir) {
  const manifestPath = join(fromDir, manifestFileName)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

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

  return manifest
}

function objectFileName(key) {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

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
      case '--persist-to': {
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

function requireFreshTargetConfirmation(options) {
  if (!options.confirmFreshTarget) {
    throw new Error(
      '--confirm-fresh-target is required before restore --execute',
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
  node scripts/honowarden-backup.mjs export --out <dir> --database <name> --bucket <name> [--r2-objects <file> | --r2-list] [--r2-prefix <prefix>] [--r2-list-page-size <1-1000>] [--mode local|remote] [--execute]
  node scripts/honowarden-backup.mjs restore --from <dir> [--database <name>] [--bucket <name>] [--mode local|remote] [--execute --confirm-fresh-target]
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
