#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { request as requestHttp } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { normalizeCredentialMaterial } from './honowarden-credential-lifecycle.mjs'
import {
  generateOfficialCredentialFixture,
  isolatedClientEnvironment,
  resolveHarnessRoot,
  runCapturedProcess,
  validateHarnessDirectories,
  validateHarnessRoot,
} from './honowarden-official-client-harness.mjs'
import {
  createIdempotentCleanup,
  installSignalCleanup,
  runCleanupSteps,
  stopDetachedProcessTree,
} from './honowarden-signal-cleanup.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binarySha256 =
  'b40c0f110cf88c41954c7be67d15139beb7202cfff8f384af5260f654e94db57'
const defaultBinary = 'test/.tmp/current-cli-20260922-wwV0oV/bw'
const defaultCryptoRoot = 'test/.tmp/current-client-seed-20260922-0916'
const confirmation = 'current-cli-smoke'

async function runtimeFingerprint() {
  const files = []
  const visit = async (directory) => {
    for (const entry of await readdir(join(repoRoot, directory), {
      withFileTypes: true,
    })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(path)
      else throw new Error('runtime source contains an unsupported file type')
    }
  }
  for (const directory of ['src', 'migrations', 'scripts'])
    await visit(directory)
  files.push(
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'wrangler.jsonc',
  )
  const source = createHash('sha256')
  for (const path of files.sort()) {
    const bytes = await readFile(join(repoRoot, path))
    source.update(`${path}\0${bytes.length}\0`).update(bytes)
  }
  const dependencies = createHash('sha256')
  const installed = {}
  for (const name of ['hono', 'wrangler', 'miniflare', 'vitest']) {
    const bytes = await readFile(
      join(repoRoot, 'node_modules', name, 'package.json'),
    )
    dependencies.update(`${name}\0${bytes.length}\0`).update(bytes)
    installed[name] = JSON.parse(bytes).version
  }
  dependencies.update(await readFile(join(repoRoot, 'pnpm-lock.yaml')))
  return {
    sourceSha256: source.digest('hex'),
    dependenciesSha256: dependencies.digest('hex'),
    sourceFileCount: files.length,
    installed,
    nodeVersion: process.version,
  }
}

export async function verifyCurrentCliBinary(path) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('current CLI binary must be a regular file')
  }
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== binarySha256) {
    throw new Error('current CLI binary digest mismatch')
  }
  return { version: '2026.9.0', sha256: binarySha256, bytes: bytes.length }
}

export function currentCliEnvironment(root, caPath, source = process.env) {
  return {
    ...isolatedClientEnvironment(root, {
      PATH: source.PATH,
      LANG: source.LANG,
    }),
    NODE_EXTRA_CA_CERTS: caPath,
    WRANGLER_SEND_METRICS: 'false',
  }
}

export function assertDecryptedFields(item, expected) {
  const equal =
    item?.name === expected.itemName &&
    item?.notes === expected.itemNotes &&
    item?.login?.username === expected.itemUsername &&
    item?.login?.password === expected.itemPassword &&
    item?.login?.uris?.[0]?.uri === expected.itemUri
  if (!equal) throw new Error('CLI decrypted field equality failed')
}

export function assertMutationState(items, trash, id, state, expected) {
  if (!Array.isArray(items) || !Array.isArray(trash))
    throw new Error('CLI item lists were invalid')
  const active = items.filter((item) => item.id === id)
  const deleted = trash.filter((item) => item.id === id)
  if (state === 'present') {
    if (active.length !== 1 || deleted.length !== 0 || active[0].deletedDate)
      throw new Error('CLI active mutation state mismatch')
    assertDecryptedFields(active[0], expected)
  } else if (state === 'trash') {
    if (active.length !== 0 || deleted.length !== 1 || !deleted[0].deletedDate)
      throw new Error('CLI trash mutation state mismatch')
    assertDecryptedFields(deleted[0], expected)
  } else if (state === 'absent') {
    if (active.length !== 0 || deleted.length !== 0)
      throw new Error('CLI permanent deletion state mismatch')
  } else throw new Error('CLI mutation state was invalid')
}

export function assertR2Snapshot(page, key, bodySha256) {
  if (
    !page ||
    !Array.isArray(page.keys) ||
    page.truncated !== false ||
    page.cursor !== null ||
    page.keys.length !== 1 ||
    page.keys[0] !== key ||
    page.bodySha256 !== bodySha256
  ) {
    throw new Error('local R2 sentinel identity changed')
  }
}

async function reservePort() {
  const server = createNetServer()
  await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', ok)
  })
  const port = server.address().port
  await new Promise((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  )
  return port
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`

async function encryptOrganizationField(key, plaintext) {
  const iv = randomBytes(16)
  const aes = await webcrypto.subtle.importKey(
    'raw',
    key.subarray(0, 32),
    'AES-CBC',
    false,
    ['encrypt'],
  )
  const hmac = await webcrypto.subtle.importKey(
    'raw',
    key.subarray(32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const ciphertext = Buffer.from(
    await webcrypto.subtle.encrypt({ name: 'AES-CBC', iv }, aes, plaintext),
  )
  const mac = Buffer.from(
    await webcrypto.subtle.sign('HMAC', hmac, Buffer.concat([iv, ciphertext])),
  )
  return `2.${iv.toString('base64')}|${ciphertext.toString('base64')}|${mac.toString('base64')}`
}

async function organizationFixture(baseline, plaintext, userId, email, now) {
  const id = randomUUID()
  const membershipId = randomUUID()
  const collectionId = randomUUID()
  const cipherId = randomUUID()
  const secondaryId = randomUUID()
  const secondaryMembershipId = randomUUID()
  const secondaryEmail = `secondary-${secondaryId}@example.invalid`
  const secondaryKeyPair = await webcrypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const secondaryPublicKey = Buffer.from(
    await webcrypto.subtle.exportKey('spki', secondaryKeyPair.publicKey),
  ).toString('base64')
  const key = randomBytes(64)
  const cipherKey = randomBytes(64)
  const publicKey = await webcrypto.subtle.importKey(
    'spki',
    Buffer.from(baseline.accountKeys.accountPublicKey, 'base64'),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const wrappedOrgKey = `3.${Buffer.from(await webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, key)).toString('base64')}`
  const wrappedCipherKey = await encryptOrganizationField(key, cipherKey)
  const expected = {
    ...plaintext,
    itemName: `${plaintext.itemName} organization`,
    itemNotes: `${plaintext.itemNotes} organization`,
    itemUsername: `${plaintext.itemUsername}-organization`,
    itemPassword: `${plaintext.itemPassword}-organization`,
    itemUri: `https://organization-${id}.example.invalid`,
  }
  const encrypt = (value) =>
    encryptOrganizationField(cipherKey, Buffer.from(value))
  const name = 'Synthetic current CLI organization'
  const collectionName = `Synthetic current CLI collection ${collectionId}`
  const payload = {
    type: 1,
    organizationId: id,
    folderId: null,
    favorite: false,
    reprompt: 0,
    name: await encrypt(expected.itemName),
    notes: await encrypt(expected.itemNotes),
    key: wrappedCipherKey,
    login: {
      username: await encrypt(expected.itemUsername),
      password: await encrypt(expected.itemPassword),
      totp: null,
      uris: [
        {
          uri: await encrypt(expected.itemUri),
          uriChecksum: await encrypt(
            createHash('sha256').update(expected.itemUri).digest('base64'),
          ),
          match: null,
        },
      ],
    },
  }
  const seed = `INSERT INTO organizations (id,name,billing_email,plan_type,public_key,private_key,enabled,use_totp,revision_date,created_at,updated_at) VALUES (${sql(id)},${sql(name)},${sql(email)},0,NULL,NULL,1,0,${sql(now)},${sql(now)},${sql(now)});
INSERT INTO organization_users (id,organization_id,user_id,email,org_key,status,type,permissions,created_at,updated_at) VALUES (${sql(membershipId)},${sql(id)},${sql(userId)},${sql(email)},${sql(wrappedOrgKey)},2,0,NULL,${sql(now)},${sql(now)});
INSERT INTO collections (id,organization_id,encrypted_name,type,revision_date,created_at) VALUES (${sql(collectionId)},${sql(id)},${sql(await encryptOrganizationField(key, Buffer.from(collectionName)))},0,${sql(now)},${sql(now)});
INSERT INTO collection_users (collection_id,organization_user_id,read_only,hide_passwords,manage) VALUES (${sql(collectionId)},${sql(membershipId)},0,0,1);
INSERT INTO ciphers (id,user_id,folder_id,type,favorite,encrypted_json,revision_date,created_at,updated_at,organization_id,cipher_key) VALUES (${sql(cipherId)},${sql(userId)},NULL,1,0,${sql(JSON.stringify(payload))},${sql(now)},${sql(now)},${sql(now)},${sql(id)},${sql(wrappedCipherKey)});
INSERT INTO collection_ciphers (collection_id,cipher_id) VALUES (${sql(collectionId)},${sql(cipherId)});
INSERT INTO users (id,email,email_normalized,display_name,kdf_algorithm,kdf_iterations,master_password_hash,user_key,public_key,security_stamp,revision_date,created_at,updated_at) VALUES (${sql(secondaryId)},${sql(secondaryEmail)},${sql(secondaryEmail)},'Synthetic Accepted Member','pbkdf2-sha256',600000,${sql(baseline.masterPasswordAuthenticationHash)},${sql(baseline.masterKeyEncryptedUserKey)},${sql(secondaryPublicKey)},${sql(randomUUID())},${sql(now)},${sql(now)},${sql(now)});
INSERT INTO organization_users (id,organization_id,user_id,email,org_key,status,type,permissions,created_at,updated_at) VALUES (${sql(secondaryMembershipId)},${sql(id)},${sql(secondaryId)},${sql(secondaryEmail)},NULL,1,2,NULL,${sql(now)},${sql(now)});`
  return {
    id,
    membershipId,
    collectionId,
    cipherId,
    name,
    collectionName,
    expected,
    seed,
    key,
    secondaryMembershipId,
    secondaryEmail,
    secondaryPrivateKey: await webcrypto.subtle.exportKey(
      'pkcs8',
      secondaryKeyPair.privateKey,
    ),
  }
}

async function smoke(binaryPath, cryptoPath, organizations = false) {
  const binary = resolveHarnessRoot(binaryPath).absolute
  const cryptoRoot = resolveHarnessRoot(cryptoPath)
  await validateHarnessRoot(
    resolveHarnessRoot(relative(repoRoot, dirname(binary))),
  )
  const pin = await verifyCurrentCliBinary(binary)
  await validateHarnessDirectories(cryptoRoot)
  await mkdir(join(repoRoot, 'test/.tmp'), { recursive: true, mode: 0o700 })
  const absolute = await mkdtemp(join(repoRoot, 'test/.tmp/current-cli-smoke-'))
  const root = resolveHarnessRoot(relative(repoRoot, absolute))
  for (const part of ['home', 'tmp', 'profile', 'output', 'state']) {
    await mkdir(join(absolute, part), { mode: 0o700 })
  }
  await writeFile(join(absolute, 'profile/data.json'), '{}', { mode: 0o600 })
  await cp(binary, join(absolute, 'bw'), { errorOnExist: true, force: false })
  await verifyCurrentCliBinary(join(absolute, 'bw'))
  const fixture = resolveHarnessRoot(`${root.relative}/fixture`)
  await mkdir(fixture.absolute, { mode: 0o700 })
  for (const part of ['assets', 'crypto', 'native', 'state.json']) {
    await cp(join(cryptoRoot.absolute, part), join(fixture.absolute, part), {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
  }
  for (const part of [
    'home',
    'tmp',
    'profile',
    'requests',
    'responses',
    'output',
  ]) {
    await mkdir(join(fixture.absolute, part), { mode: 0o700 })
  }

  const outputDirectory = join(absolute, 'output')
  const caPath = join(absolute, 'ca.pem')
  const env = currentCliEnvironment(root, caPath)
  let proxy
  let worker
  let inventoryWorker
  let cleanupError
  const cleanup = createIdempotentCleanup(() =>
    runCleanupSteps(
      [
        async () => {
          if (!proxy) return
          proxy.closeAllConnections()
          await new Promise((ok, fail) =>
            proxy.close((error) => (error ? fail(error) : ok())),
          )
        },
        async () => {
          if (worker) await stopDetachedProcessTree(worker)
        },
        async () => {
          if (inventoryWorker) await stopDetachedProcessTree(inventoryWorker)
        },
      ],
      'current CLI local process cleanup',
    ),
  )
  const removeSignalCleanup = installSignalCleanup(cleanup)
  const report = {
    schemaVersion: 1,
    clientVersion: pin.version,
    binarySha256: pin.sha256,
    startedAt: new Date().toISOString(),
    status: 'failed',
    syntheticOnly: true,
    noRemoteMutation: true,
    organizationReadRequested: organizations,
    organizationConfirmationRequested: organizations,
    root: root.relative,
    checks: [],
    routes: [],
    runtimeBefore: await runtimeFingerprint(),
  }
  const run = async (command, args, label, extraEnv = {}) => {
    const result = await runCapturedProcess(command, args, {
      cwd: repoRoot,
      env: {
        ...env,
        NODE_EXTRA_CA_CERTS:
          command === join(absolute, 'bw') ? caPath : undefined,
        ...extraEnv,
      },
      outputDirectory,
      timeoutMs: 120_000,
      label: `${label}-${randomUUID()}`,
    })
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error(`${label} failed; inspect private run output`)
    }
    return result
  }
  const cli = async (args, label, extraEnv = {}) => {
    const result = await run(join(absolute, 'bw'), args, label, extraEnv)
    if (result.stderr.bytes !== 0)
      throw new Error(`${label} emitted stderr; inspect private run output`)
    return (
      await readFile(join(outputDirectory, result.stdout.file), 'utf8')
    ).trim()
  }

  try {
    if ((await cli(['--version'], 'version')) !== pin.version) {
      throw new Error('current CLI version mismatch')
    }
    const generated = await generateOfficialCredentialFixture(fixture)
    const material = normalizeCredentialMaterial(generated.material)
    const baseline = material.stages.baseline
    const userId = randomUUID()
    const cipherId = randomUUID()
    const now = new Date().toISOString()
    const cipher = {
      type: 1,
      folderId: null,
      organizationId: null,
      favorite: false,
      reprompt: 0,
      name: baseline.vault.cipher.name,
      notes: baseline.vault.cipher.notes,
      key: null,
      login: {
        username: baseline.vault.cipher.username,
        password: baseline.vault.cipher.password,
        totp: null,
        uris: [{ uri: baseline.vault.cipher.uri, match: null }],
      },
    }
    const config = {
      name: 'honowarden-current-cli-local',
      main: join(repoRoot, 'src/index.ts'),
      compatibility_date: '2026-07-06',
      workers_dev: false,
      preview_urls: false,
      vars: {
        HONOWARDEN_ENV: 'development',
        HONOWARDEN_ALLOWED_EMAILS: material.email,
        HONOWARDEN_TOKEN_SECRET: `synthetic-current-cli-${randomUUID()}`,
        HONOWARDEN_USER_KEY_ID_ENABLED: 'true',
        HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED: String(organizations),
        HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'false',
        HONOWARDEN_KDF_MUTATION_ENABLED: 'false',
        HONOWARDEN_PASSWORD_CHANGE_ENABLED: 'false',
        HONOWARDEN_USER_KEY_ROTATION_ENABLED: 'false',
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'false',
        HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'false',
        HONOWARDEN_AUDIT_LOGS: 'false',
      },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'current-cli-local',
          database_id: '00000000-0000-0000-0000-000000000001',
          migrations_dir: join(repoRoot, 'migrations'),
        },
      ],
      r2_buckets: [
        { binding: 'VAULT_OBJECTS', bucket_name: 'current-cli-local-objects' },
      ],
      durable_objects: {
        bindings: [{ name: 'NOTIFICATION_HUB', class_name: 'NotificationHub' }],
      },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['NotificationHub'] }],
    }
    const configPath = join(absolute, 'wrangler.json')
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
    const wrangler = ['exec', 'wrangler']
    const flags = [
      '--config',
      configPath,
      '--local',
      '--persist-to',
      join(absolute, 'state'),
    ]
    await run(
      'pnpm',
      [...wrangler, 'd1', 'migrations', 'apply', 'current-cli-local', ...flags],
      'migrate',
    )
    const seed = `INSERT INTO users (id,email,email_normalized,display_name,kdf_algorithm,kdf_iterations,kdf_memory,kdf_parallelism,master_password_hash,user_key,public_key,private_key,security_stamp,revision_date,created_at,updated_at) VALUES (${sql(userId)},${sql(material.email)},${sql(material.email)},'Synthetic Current CLI','pbkdf2-sha256',600000,NULL,NULL,${sql(baseline.masterPasswordAuthenticationHash)},${sql(baseline.masterKeyEncryptedUserKey)},${sql(baseline.accountKeys.accountPublicKey)},${sql(baseline.accountKeys.userKeyEncryptedAccountPrivateKey)},${sql(randomUUID())},${sql(now)},${sql(now)},${sql(now)}); INSERT INTO ciphers (id,user_id,folder_id,type,favorite,encrypted_json,revision_date,created_at,updated_at,organization_id,cipher_key) VALUES (${sql(cipherId)},${sql(userId)},NULL,1,0,${sql(JSON.stringify(cipher))},${sql(now)},${sql(now)},${sql(now)},NULL,NULL);`
    const seedPath = join(absolute, 'seed.sql')
    const organization = organizations
      ? await organizationFixture(
          baseline,
          material.plaintext,
          userId,
          material.email,
          now,
        )
      : null
    await writeFile(seedPath, `${seed}${organization?.seed ?? ''}`, {
      mode: 0o600,
    })
    await run(
      'pnpm',
      [
        ...wrangler,
        'd1',
        'execute',
        'current-cli-local',
        ...flags,
        '--file',
        seedPath,
        '--yes',
      ],
      'seed',
    )
    await run(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        join(absolute, 'key.pem'),
        '-out',
        caPath,
        '-subj',
        '/CN=localhost',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      'certificate',
    )
    await Promise.all([
      chmod(join(absolute, 'key.pem'), 0o600),
      chmod(caPath, 0o600),
    ])
    const backendPort = await reservePort()
    const inspectorPort = await reservePort()
    const workerStdout = await open(
      join(outputDirectory, 'worker.stdout.log'),
      'wx',
      0o600,
    )
    const workerStderr = await open(
      join(outputDirectory, 'worker.stderr.log'),
      'wx',
      0o600,
    )
    try {
      worker = spawn(
        'pnpm',
        [
          ...wrangler,
          'dev',
          ...flags,
          '--ip',
          '127.0.0.1',
          '--port',
          String(backendPort),
          '--inspector-port',
          String(inspectorPort),
          '--local-protocol',
          'http',
          '--log-level',
          'error',
        ],
        {
          cwd: repoRoot,
          env,
          detached: true,
          stdio: ['ignore', workerStdout.fd, workerStderr.fd],
        },
      )
    } finally {
      await Promise.all([workerStdout.close(), workerStderr.close()])
    }
    let workerFailure
    worker.once('error', () => {
      workerFailure = true
    })
    const deadline = Date.now() + 60_000
    let healthy = false
    while (Date.now() < deadline) {
      if (workerFailure || worker.exitCode !== null)
        throw new Error('local Worker exited before readiness')
      try {
        healthy =
          (
            await globalThis.fetch(`http://127.0.0.1:${backendPort}/health`, {
              signal: globalThis.AbortSignal.timeout(1000),
            })
          ).status === 200
      } catch {
        /* Readiness polling is bounded by the deadline. */
      }
      if (healthy) break
      await new Promise((ok) => globalThis.setTimeout(ok, 100))
    }
    if (!healthy) throw new Error('local Worker readiness timed out')
    const inventoryToken = randomUUID()
    const sentinelKey = `synthetic-current-cli-unrelated/${randomUUID()}`
    const sentinelBody = `synthetic-opaque-r2-sentinel-${randomUUID()}`
    const sentinelSha256 = createHash('sha256')
      .update(sentinelBody)
      .digest('hex')
    const inventoryMain = join(absolute, 'r2-inspection.mjs')
    await writeFile(
      inventoryMain,
      `const sentinelKey = ${JSON.stringify(sentinelKey)};
export default { async fetch(request, env) {
  if (request.headers.get('authorization') !== ${JSON.stringify(`Bearer ${inventoryToken}`)}) return new Response(null, {status:401});
  const url = new URL(request.url);
  if (url.pathname === '/seed' && request.method === 'POST') {
    const existing = await env.VAULT_OBJECTS.list({limit:1});
    if (existing.objects.length || existing.truncated) return new Response(null, {status:409});
    await env.VAULT_OBJECTS.put(sentinelKey, ${JSON.stringify(sentinelBody)});
    return new Response(null, {status:201});
  }
  if (url.pathname !== '/inventory' || request.method !== 'GET') return new Response(null, {status:404});
  const page = await env.VAULT_OBJECTS.list();
  const object = await env.VAULT_OBJECTS.get(sentinelKey);
  const digest = object ? await crypto.subtle.digest('SHA-256', await object.arrayBuffer()) : null;
  const bodySha256 = digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') : null;
  return Response.json({keys:page.objects.map(object => object.key),truncated:page.truncated,cursor:page.cursor ?? null,bodySha256});
} };`,
      { mode: 0o600 },
    )
    const inventoryConfig = join(absolute, 'r2-inspection.json')
    await writeFile(
      inventoryConfig,
      JSON.stringify({
        name: 'current-cli-local-r2-inspection',
        main: inventoryMain,
        compatibility_date: '2026-07-06',
        workers_dev: false,
        preview_urls: false,
        r2_buckets: config.r2_buckets,
      }),
      { mode: 0o600 },
    )
    const inventoryPort = await reservePort()
    const inventoryInspector = await reservePort()
    const inventoryStdout = await open(
      join(outputDirectory, 'r2-inspection.stdout.log'),
      'wx',
      0o600,
    )
    const inventoryStderr = await open(
      join(outputDirectory, 'r2-inspection.stderr.log'),
      'wx',
      0o600,
    )
    try {
      inventoryWorker = spawn(
        'pnpm',
        [
          ...wrangler,
          'dev',
          '--config',
          inventoryConfig,
          '--local',
          '--persist-to',
          join(absolute, 'state'),
          '--ip',
          '127.0.0.1',
          '--port',
          String(inventoryPort),
          '--inspector-port',
          String(inventoryInspector),
          '--local-protocol',
          'http',
          '--log-level',
          'error',
        ],
        {
          cwd: repoRoot,
          env,
          detached: true,
          stdio: ['ignore', inventoryStdout.fd, inventoryStderr.fd],
        },
      )
    } finally {
      await Promise.all([inventoryStdout.close(), inventoryStderr.close()])
    }
    let inventoryFailure = false
    inventoryWorker.once('error', () => {
      inventoryFailure = true
    })
    const readR2Page = async () => {
      const deadline = Date.now() + 60_000
      let page
      while (Date.now() < deadline) {
        if (inventoryFailure || inventoryWorker.exitCode !== null)
          throw new Error('local R2 inspection Worker exited')
        let response
        try {
          response = await globalThis.fetch(
            `http://127.0.0.1:${inventoryPort}/inventory`,
            {
              headers: { authorization: `Bearer ${inventoryToken}` },
              signal: globalThis.AbortSignal.timeout(1000),
            },
          )
        } catch {
          /* Initial loopback listener readiness has a fixed deadline. */
        }
        if (response) {
          if (response.status !== 200)
            throw new Error('local R2 inspection request failed')
          page = await response.json()
          break
        }
        await new Promise((ok) => globalThis.setTimeout(ok, 100))
      }
      if (!page) throw new Error('local R2 inspection readiness timed out')
      return page
    }
    const empty = await readR2Page()
    if (
      !Array.isArray(empty.keys) ||
      empty.keys.length !== 0 ||
      empty.truncated !== false ||
      empty.cursor !== null
    )
      throw new Error('fresh local R2 bucket was not empty')
    const seeded = await globalThis.fetch(
      `http://127.0.0.1:${inventoryPort}/seed`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${inventoryToken}` },
        signal: globalThis.AbortSignal.timeout(5000),
      },
    )
    if (seeded.status !== 201)
      throw new Error('local R2 sentinel initialization failed')
    const assertUnchangedR2 = async (phase) => {
      const page = await readR2Page()
      assertR2Snapshot(page, sentinelKey, sentinelSha256)
      report.checks.push({
        flow: `r2-unrelated-sentinel-${phase}`,
        passed: true,
        keyCount: 1,
        keySetSha256: createHash('sha256')
          .update(JSON.stringify(page.keys))
          .digest('hex'),
        bodySha256: sentinelSha256,
      })
    }
    await assertUnchangedR2('before-mutation')
    proxy = createHttpsServer(
      {
        cert: await readFile(caPath),
        key: await readFile(join(absolute, 'key.pem')),
      },
      (request, response) => {
        const headers = { ...request.headers, 'x-forwarded-proto': 'https' }
        delete headers['accept-encoding']
        const upstream = requestHttp(
          {
            host: '127.0.0.1',
            port: backendPort,
            method: request.method,
            path: request.url,
            headers,
          },
          (reply) => {
            report.routes.push({
              method: request.method,
              path: new globalThis.URL(request.url, 'https://localhost')
                .pathname,
              status: reply.statusCode,
            })
            response.writeHead(reply.statusCode, reply.headers)
            reply.pipe(response)
          },
        )
        upstream.once('error', () => {
          if (!response.headersSent) response.writeHead(502)
          response.end()
        })
        request.pipe(upstream)
      },
    )
    await new Promise((ok, fail) => {
      proxy.once('error', fail)
      proxy.listen(0, '127.0.0.1', ok)
    })
    const origin = `https://127.0.0.1:${proxy.address().port}`
    await cli(['config', 'server', origin], 'configure')
    if ((await cli(['config', 'server'], 'read-config')) !== origin)
      throw new Error('isolated CLI origin mismatch')
    const passwordEnv = { BW_PASSWORD: baseline.password }
    const login = () =>
      cli(
        [
          'login',
          material.email,
          '--passwordenv',
          'BW_PASSWORD',
          '--raw',
          '--nointeraction',
        ],
        'login',
        passwordEnv,
      )
    const readback = async (session) => {
      if (!session || session.includes('\n'))
        throw new Error('CLI did not return a session')
      const sessionEnv = { BW_SESSION: session }
      await cli(['sync', '--force'], 'sync', sessionEnv)
      const item = JSON.parse(
        await cli(['get', 'item', cipherId], 'decrypted-read', sessionEnv),
      )
      assertDecryptedFields(item, material.plaintext)
      report.checks.push({
        flow: 'populated-sync-five-field-decryption',
        passed: true,
      })
    }
    const firstSession = await login()
    await readback(firstSession)
    const sessionEnv = { BW_SESSION: firstSession }
    if (organization) {
      const organizationsList = JSON.parse(
        await cli(['list', 'organizations'], 'organization-list', sessionEnv),
      )
      if (
        !Array.isArray(organizationsList) ||
        organizationsList.length !== 1 ||
        organizationsList[0].id !== organization.id ||
        organizationsList[0].name !== organization.name
      )
        throw new Error('CLI organization projection mismatch')
      for (const kind of ['collections', 'org-collections']) {
        const collections = JSON.parse(
          await cli(
            ['list', kind, '--organizationid', organization.id],
            `organization-${kind}`,
            sessionEnv,
          ),
        )
        if (
          !Array.isArray(collections) ||
          collections.length !== 1 ||
          collections[0].id !== organization.collectionId ||
          collections[0].organizationId !== organization.id ||
          collections[0].name !== organization.collectionName
        )
          throw new Error('CLI organization collection decryption mismatch')
      }
      const members = JSON.parse(
        await cli(
          ['list', 'org-members', '--organizationid', organization.id],
          'organization-members',
          sessionEnv,
        ),
      )
      if (!Array.isArray(members))
        throw new Error('CLI organization members are not an array')
      const owner = members.find(
        (member) => member.id === organization.membershipId,
      )
      const acceptedMember = members.find(
        (member) => member.id === organization.secondaryMembershipId,
      )
      if (
        !Array.isArray(members) ||
        members.length !== 2 ||
        owner?.email !== material.email ||
        owner?.status !== 2 ||
        owner?.type !== 0 ||
        owner?.twoFactorEnabled !== false ||
        acceptedMember?.email !== organization.secondaryEmail ||
        acceptedMember?.status !== 1 ||
        acceptedMember?.type !== 2
      )
        throw new Error('CLI organization member projection mismatch')
      const items = JSON.parse(
        await cli(
          ['list', 'items', '--organizationid', organization.id],
          'organization-items',
          sessionEnv,
        ),
      )
      if (
        !Array.isArray(items) ||
        items.length !== 1 ||
        items[0].id !== organization.cipherId ||
        items[0].organizationId !== organization.id ||
        !items[0].collectionIds?.includes(organization.collectionId)
      )
        throw new Error('CLI organization item projection mismatch')
      assertDecryptedFields(items[0], organization.expected)
      const item = JSON.parse(
        await cli(
          ['get', 'item', organization.cipherId],
          'organization-item-read',
          sessionEnv,
        ),
      )
      assertDecryptedFields(item, organization.expected)
      report.checks.push({
        flow: 'current-cli-seeded-owner-organization-collection-members-item-decryption',
        passed: true,
        confirmedOwnerCount: 1,
        collectionCount: 1,
        organizationCipherCount: 1,
      })
      await cli(
        [
          'confirm',
          'org-member',
          organization.secondaryMembershipId,
          '--organizationid',
          organization.id,
        ],
        'organization-member-confirm',
        sessionEnv,
      )
      const confirmedMembers = JSON.parse(
        await cli(
          ['list', 'org-members', '--organizationid', organization.id],
          'organization-confirmed-members',
          sessionEnv,
        ),
      )
      if (
        confirmedMembers.length !== 2 ||
        confirmedMembers.find(
          (member) => member.id === organization.secondaryMembershipId,
        )?.status !== 2
      )
        throw new Error('CLI confirmed member readback mismatch')
      const confirmationReadback = await run(
        'pnpm',
        [
          ...wrangler,
          'd1',
          'execute',
          'current-cli-local',
          ...flags,
          '--command',
          `SELECT status,org_key FROM organization_users WHERE id=${sql(organization.secondaryMembershipId)} AND organization_id=${sql(organization.id)}`,
          '--json',
        ],
        'organization-confirmation-sql-readback',
      )
      const confirmationData = JSON.parse(
        await readFile(
          join(outputDirectory, confirmationReadback.stdout.file),
          'utf8',
        ),
      )
      const confirmed = confirmationData[0]?.results
      if (
        !Array.isArray(confirmed) ||
        confirmed.length !== 1 ||
        confirmed[0].status !== 2 ||
        typeof confirmed[0].org_key !== 'string' ||
        !/^[34]\./.test(confirmed[0].org_key)
      )
        throw new Error('native confirmation SQL status/key readback mismatch')
      const keyType = Number(confirmed[0].org_key[0])
      const secondaryPrivateKey = await webcrypto.subtle.importKey(
        'pkcs8',
        organization.secondaryPrivateKey,
        { name: 'RSA-OAEP', hash: keyType === 3 ? 'SHA-256' : 'SHA-1' },
        false,
        ['decrypt'],
      )
      const decryptedOrgKey = Buffer.from(
        await webcrypto.subtle.decrypt(
          { name: 'RSA-OAEP' },
          secondaryPrivateKey,
          Buffer.from(confirmed[0].org_key.slice(2), 'base64'),
        ),
      )
      if (!decryptedOrgKey.equals(organization.key))
        throw new Error('native confirmation wrapped organization key mismatch')
      report.checks.push({
        flow: 'current-cli-accepted-member-confirm-rsa-wrapped-org-key',
        passed: true,
        confirmedStatus: 2,
        keyType,
        decryptedOrgKeyMatches: true,
      })
    }
    let expected = {
      ...material.plaintext,
      itemName: `${material.plaintext.itemName} created`,
      itemNotes: `${material.plaintext.itemNotes} created`,
    }
    const payload = {
      type: 1,
      name: expected.itemName,
      notes: expected.itemNotes,
      favorite: false,
      folderId: null,
      organizationId: null,
      reprompt: 0,
      fields: [],
      login: {
        username: expected.itemUsername,
        password: expected.itemPassword,
        totp: null,
        uris: [{ uri: expected.itemUri, match: null }],
      },
    }
    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString('base64')
    const created = JSON.parse(
      await cli(['create', 'item', encode(payload)], 'create-item', sessionEnv),
    )
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        created.id ?? '',
      )
    )
      throw new Error('CLI created item identifier invalid')
    const mutationId = created.id
    assertDecryptedFields(created, expected)
    const mutationReadback = async (state, phase) => {
      await cli(['sync', '--force'], `mutation-sync-${phase}`, sessionEnv)
      const items = JSON.parse(
        await cli(['list', 'items'], `mutation-list-${phase}`, sessionEnv),
      )
      const trash = JSON.parse(
        await cli(
          ['list', 'items', '--trash'],
          `mutation-trash-${phase}`,
          sessionEnv,
        ),
      )
      assertMutationState(items, trash, mutationId, state, expected)
      if (state === 'present')
        assertDecryptedFields(
          JSON.parse(
            await cli(
              ['get', 'item', mutationId],
              `mutation-read-${phase}`,
              sessionEnv,
            ),
          ),
          expected,
        )
      report.checks.push({ flow: `current-cli-${phase}`, passed: true, state })
    }
    await mutationReadback('present', 'create')
    expected = {
      ...expected,
      itemName: `${material.plaintext.itemName} edited`,
      itemNotes: `${material.plaintext.itemNotes} edited`,
      itemUsername: `${material.plaintext.itemUsername}-edited`,
      itemPassword: `${material.plaintext.itemPassword}-edited`,
      itemUri: `https://edited-${randomUUID()}.example.invalid`,
    }
    const edited = {
      ...created,
      name: expected.itemName,
      notes: expected.itemNotes,
      login: {
        ...created.login,
        username: expected.itemUsername,
        password: expected.itemPassword,
        uris: [{ uri: expected.itemUri, match: null }],
      },
    }
    assertDecryptedFields(
      JSON.parse(
        await cli(
          ['edit', 'item', mutationId, encode(edited)],
          'edit-item',
          sessionEnv,
        ),
      ),
      expected,
    )
    await mutationReadback('present', 'edit')
    await cli(['delete', 'item', mutationId], 'soft-delete-item', sessionEnv)
    await mutationReadback('trash', 'soft-delete')
    await cli(['restore', 'item', mutationId], 'restore-item', sessionEnv)
    await mutationReadback('present', 'restore')
    await cli(
      ['delete', 'item', mutationId],
      'soft-delete-before-permanent',
      sessionEnv,
    )
    await mutationReadback('trash', 'soft-delete-before-permanent')
    await cli(
      ['delete', 'item', mutationId, '--permanent'],
      'permanent-delete-item',
      sessionEnv,
    )
    await mutationReadback('absent', 'permanent-delete')
    await assertUnchangedR2('after-mutation')
    await cli(['lock'], 'lock')
    await readback(
      await cli(
        ['unlock', '--passwordenv', 'BW_PASSWORD', '--raw'],
        'unlock',
        passwordEnv,
      ),
    )
    const logout = async () => {
      await cli(['logout'], 'logout')
      const status = JSON.parse(await cli(['status'], 'status'))
      if (status.status !== 'unauthenticated')
        throw new Error('CLI logout did not remove authentication')
    }
    await logout()
    await readback(await login())
    await logout()
    const registrations = report.routes.filter(
      (route) => route.path === '/api/accounts/key-management/user-key-id',
    )
    if (registrations.length !== 1 || registrations[0].status !== 200)
      throw new Error('key-ID backfill was not single-shot')
    if (report.routes.some((route) => ![200, 201, 204].includes(route.status)))
      throw new Error('current CLI request failed')
    report.checks.push({
      flow: 'single-key-id-backfill-lock-unlock-repeat-login-logout',
      passed: true,
    })
    report.status = 'passed'
  } catch (error) {
    await writeFile(
      join(absolute, 'failure.private.log'),
      String(error?.stack ?? 'local smoke failed'),
      {
        mode: 0o600,
      },
    )
    throw error
  } finally {
    try {
      await cleanup()
      report.localProcessesStopped = true
      report.runtimeAfter = await runtimeFingerprint()
      report.runtimeUnchanged =
        JSON.stringify(report.runtimeBefore) ===
        JSON.stringify(report.runtimeAfter)
      if (!report.runtimeUnchanged) {
        report.status = 'failed'
        cleanupError = new Error(
          'runtime source or dependencies changed during CLI acceptance',
        )
      }
    } catch (error) {
      report.status = 'failed'
      report.localProcessesStopped = false
      cleanupError = error
      await writeFile(
        join(absolute, 'cleanup-failure.private.log'),
        String(error?.stack ?? 'cleanup failed'),
        { mode: 0o600 },
      )
    } finally {
      removeSignalCleanup()
      report.finishedAt = new Date().toISOString()
      await writeFile(join(absolute, 'report.json'), JSON.stringify(report), {
        mode: 0o600,
      })
    }
  }
  if (cleanupError) throw cleanupError
  return report
}

async function main(args) {
  const [action, ...rest] = args[0] === '--' ? args.slice(1) : args
  if (action !== 'plan' && action !== 'run')
    throw new Error('action must be plan or run')
  const options = {}
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index]
    if (key === '--execute') options.execute = true
    else if (key === '--organizations') options.organizations = true
    else if (
      ['--binary', '--crypto-root', '--confirm'].includes(key) &&
      rest[index + 1]
    )
      options[key.slice(2)] = rest[++index]
    else throw new Error('unsupported current CLI smoke option')
  }
  if (action === 'plan' && options.execute)
    throw new Error('plan cannot execute')
  const binary = resolveHarnessRoot(options.binary ?? defaultBinary).relative
  const cryptoRoot = resolveHarnessRoot(
    options['crypto-root'] ?? defaultCryptoRoot,
  ).relative
  if (action === 'run') {
    if (!options.execute || options.confirm !== confirmation)
      throw new Error('run requires --execute --confirm current-cli-smoke')
    const report = await smoke(
      binary,
      cryptoRoot,
      options.organizations === true,
    )
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, status: 'planned', executed: false, version: '2026.9.0', binarySha256, binary, cryptoRoot, syntheticOnly: true, loopbackOnly: true, downloads: false, organizationReadRequested: options.organizations === true, next: `pnpm exec node scripts/honowarden-current-cli-smoke.mjs run --execute --confirm current-cli-smoke${options.organizations ? ' --organizations' : ''}` }, null, 2)}\n`,
    )
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      'current CLI smoke failed; inspect private run output or verify retained asset inputs\n',
    )
    process.exitCode = 1
  })
}
