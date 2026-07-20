#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  createIdempotentCleanup,
  installSignalCleanup,
  stopDetachedProcessTree,
} from './honowarden-signal-cleanup.mjs'

const repoRoot = fileURLToPath(new globalThis.URL('..', import.meta.url))
const databaseName = 'honowarden'
const email = 'hon203-lifecycle@example.test'
const userId = 'hon203-lifecycle-user'
const cipherId = 'hon203-lifecycle-cipher'
const oldHash = 'synthetic-hon203-old-authentication-hash'
const newHash = 'synthetic-hon203-new-authentication-hash'
const oldUserKey = '2.synthetic-hon203-old-user-key'
const newUserKey = '2.synthetic-hon203-new-user-key'
const tokenSecret = 'synthetic-hon203-token-secret-with-32-bytes'
const oldDevice = 'hon203-old-device'
const newDevice = 'hon203-new-device'
const initialRevision = '2026-07-19T00:00:00.000Z'
const initialSecurityStamp = 'hon203-initial-security-stamp'
const encryptedCipher = {
  name: '2.synthetic-hon203-encrypted-name',
  notes: '2.synthetic-hon203-encrypted-notes',
  login: {
    username: '2.synthetic-hon203-encrypted-username',
    password: '2.synthetic-hon203-encrypted-password',
    uris: [],
  },
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args)
  const managedState = !options.persistTo
  const persistTo = options.persistTo
    ? await ensureDirectory(options.persistTo)
    : await mkdtemp(join(tmpdir(), 'honowarden-hon203-'))
  let worker = null
  const cleanup = createIdempotentCleanup(async () => {
    const activeWorker = worker
    worker = null
    if (activeWorker) {
      await stopWorker(activeWorker)
    }
    if (managedState && !options.keepState) {
      await rm(persistTo, { recursive: true, force: true })
    }
  })
  const removeSignalCleanup = installSignalCleanup(cleanup)

  try {
    await runWrangler([
      'd1',
      'migrations',
      'apply',
      databaseName,
      '--local',
      '--persist-to',
      persistTo,
    ])
    await runWrangler([
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      persistTo,
      '--command',
      seedSql(),
      '--yes',
      '--json',
    ])

    const [port, inspectorPort] = await findDistinctFreePorts()
    worker = startWorker({ persistTo, port, inspectorPort })
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHealth(baseUrl, worker)

    const prelogin = await requestJson(baseUrl, '/identity/accounts/prelogin', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email }),
    })
    assertStatus(prelogin, 200, 'prelogin')
    assert(
      prelogin.body.kdf === 0 && prelogin.body.kdfIterations === 600000,
      'prelogin KDF does not match the seeded account',
    )

    const oldLogin = await passwordGrant(baseUrl, oldHash, oldDevice)
    assertStatus(oldLogin, 200, 'old-password login before change')
    const oldAccessToken = requiredString(
      oldLogin.body.access_token,
      'access token',
    )
    const oldRefreshToken = requiredString(
      oldLogin.body.refresh_token,
      'refresh token',
    )

    const beforeSync = await authorizedJson(
      baseUrl,
      '/api/sync',
      oldAccessToken,
    )
    assertStatus(beforeSync, 200, 'sync before change')
    const beforeCipher = findCipher(beforeSync.body)
    assert(
      beforeSync.body.profile?.key === oldUserKey,
      'old wrapped user key is missing',
    )

    const verifyBefore = await postCredentialJson(
      baseUrl,
      '/api/accounts/verify-password',
      oldAccessToken,
      { masterPasswordHash: oldHash },
    )
    assertStatus(verifyBefore, 200, 'verify-password before change')
    assert(
      verifyBefore.body.object === 'masterPasswordPolicy',
      'verify-password policy projection is missing',
    )

    const passwordChange = await postCredentialJson(
      baseUrl,
      '/api/accounts/password',
      oldAccessToken,
      passwordChangeBody(),
    )
    assertStatus(passwordChange, 200, 'password change')

    const oldAccessAfter = await authorizedJson(
      baseUrl,
      '/api/sync',
      oldAccessToken,
    )
    assertStatus(oldAccessAfter, 401, 'old access token after change')
    const oldRefreshAfter = await refreshGrant(baseUrl, oldRefreshToken)
    assertStatus(oldRefreshAfter, 400, 'old refresh token after change')
    assert(
      oldRefreshAfter.body.error === 'invalid_grant',
      'old refresh token was not rejected',
    )
    const oldLoginAfter = await passwordGrant(
      baseUrl,
      oldHash,
      'hon203-rejected-device',
    )
    assertStatus(oldLoginAfter, 400, 'old-password login after change')
    assert(
      oldLoginAfter.body.error === 'invalid_grant',
      'old password was not rejected',
    )

    const newLogin = await passwordGrant(baseUrl, newHash, newDevice)
    assertStatus(newLogin, 200, 'new-password login after change')
    const newAccessToken = requiredString(
      newLogin.body.access_token,
      'new access token',
    )
    assert(
      newLogin.body.Key === newUserKey,
      'new wrapped user key is missing from login',
    )
    assert(
      newLogin.body.Kdf === 0 && newLogin.body.KdfIterations === 600000,
      'KDF changed during password change',
    )

    const afterSync = await authorizedJson(baseUrl, '/api/sync', newAccessToken)
    assertStatus(afterSync, 200, 'sync after change')
    assert(
      afterSync.body.profile?.key === newUserKey,
      'sync did not expose the new wrapped user key',
    )
    assert(
      JSON.stringify(findCipher(afterSync.body)) ===
        JSON.stringify(beforeCipher),
      'encrypted vault data changed during password change',
    )
    const verifyAfter = await postCredentialJson(
      baseUrl,
      '/api/accounts/verify-password',
      newAccessToken,
      { masterPasswordHash: newHash },
    )
    assertStatus(verifyAfter, 200, 'verify-password after change')

    await stopWorker(worker)
    worker = null
    const readback = await readDatabaseState(persistTo)
    const checks = [
      check('prelogin_kdf_stable', true),
      check('old_access_token_rejected', oldAccessAfter.status === 401),
      check('old_refresh_token_rejected', oldRefreshAfter.status === 400),
      check('old_password_rejected', oldLoginAfter.status === 400),
      check('new_password_login_succeeds', newLogin.status === 200),
      check('new_password_verifies', verifyAfter.status === 200),
      check('authentication_hash_replaced', readback.newHashCommitted),
      check('wrapped_user_key_replaced', readback.newUserKeyCommitted),
      check('kdf_and_salt_unchanged', readback.kdfAndSaltUnchanged),
      check('security_stamp_rotated', readback.securityStampRotated),
      check('old_device_revoked', readback.oldDeviceRevoked),
      check('old_refresh_token_revoked', readback.oldRefreshTokenRevoked),
      check('new_device_active', readback.newDeviceActive),
      check(
        'mandatory_audit_persisted',
        readback.passwordChangeAuditCount === 1,
      ),
      check('encrypted_vault_unchanged', readback.encryptedVaultUnchanged),
    ]
    const status = checks.every((entry) => entry.status === 'pass')
      ? 'passed'
      : 'failed'
    const report = {
      schemaVersion: 1,
      status,
      mode: 'wrangler-local-d1-synthetic',
      upstreamPins: {
        server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
        client: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
      },
      routes: {
        prelogin: prelogin.status,
        oldLoginBeforeChange: oldLogin.status,
        verifyBeforeChange: verifyBefore.status,
        passwordChange: passwordChange.status,
        oldAccessAfterChange: oldAccessAfter.status,
        oldRefreshAfterChange: oldRefreshAfter.status,
        oldLoginAfterChange: oldLoginAfter.status,
        newLoginAfterChange: newLogin.status,
        syncAfterChange: afterSync.status,
        verifyAfterChange: verifyAfter.status,
      },
      readback: {
        passwordChangeAuditCount: readback.passwordChangeAuditCount,
      },
      checks,
      limitations: [
        'Synthetic account, authentication hashes, wrapped key, and encrypted vault payload only.',
        'No remote Cloudflare resource, production deployment, real user, or official client UI was used.',
        'Durable notification socket invalidation is covered by route tests, not this local lifecycle.',
      ],
    }

    if (status !== 'passed') {
      throw new Error('password-change lifecycle checks failed')
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    try {
      await cleanup()
    } finally {
      removeSignalCleanup()
    }
  }
}

function parseOptions(args) {
  const options = { keepState: false, persistTo: null }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--keep-state') {
      options.keepState = true
      continue
    }
    if (arg === '--persist-to') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('--persist-to requires a value')
      }
      options.persistTo = value
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true })
  return path
}

function seedSql() {
  const encryptedJson = JSON.stringify(encryptedCipher)
  return `
    INSERT INTO users (
      id, email, email_normalized, display_name, kdf_algorithm,
      kdf_iterations, kdf_memory, kdf_parallelism, master_password_hash,
      user_key, public_key, private_key, security_stamp, revision_date
    ) VALUES (
      ${sql(userId)}, ${sql(email)}, ${sql(email)}, 'HON-203 Lifecycle',
      'pbkdf2-sha256', 600000, NULL, NULL, ${sql(oldHash)}, ${sql(oldUserKey)},
      'synthetic-public-key', '2.synthetic-private-key',
      ${sql(initialSecurityStamp)}, ${sql(initialRevision)}
    );
    INSERT INTO ciphers (
      id, user_id, folder_id, type, favorite, encrypted_json,
      revision_date, created_at, updated_at
    ) VALUES (
      ${sql(cipherId)}, ${sql(userId)}, NULL, 1, 0, ${sql(encryptedJson)},
      ${sql(initialRevision)}, ${sql(initialRevision)}, ${sql(initialRevision)}
    );
  `
}

function passwordChangeBody() {
  const kdf = {
    kdfType: 0,
    iterations: 600000,
    memory: null,
    parallelism: null,
  }
  return {
    masterPasswordHash: oldHash,
    newMasterPasswordHash: newHash,
    key: newUserKey,
    masterPasswordHint: '',
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: newHash,
      salt: email,
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: newUserKey,
      salt: email,
    },
  }
}

async function passwordGrant(baseUrl, password, deviceIdentifier) {
  return requestJson(baseUrl, '/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'password',
      username: email,
      password,
      scope: 'api offline_access',
      deviceIdentifier,
      deviceName: 'HON-203 Synthetic Lifecycle',
      deviceType: '8',
    }),
  })
}

async function refreshGrant(baseUrl, refreshToken) {
  return requestJson(baseUrl, '/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
}

function authorizedJson(baseUrl, path, accessToken) {
  return requestJson(baseUrl, path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

function postCredentialJson(baseUrl, path, accessToken, body) {
  return requestJson(baseUrl, path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...jsonHeaders(),
    },
    body: JSON.stringify(body),
  })
}

async function requestJson(baseUrl, path, init) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    ...init,
    signal: globalThis.AbortSignal.timeout(10_000),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
  }
}

function jsonHeaders() {
  return { 'Content-Type': 'application/json' }
}

function startWorker({ persistTo, port, inspectorPort }) {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--local',
      '--local-protocol',
      'http',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistTo,
      '--log-level',
      'error',
      '--var',
      `HONOWARDEN_ALLOWED_EMAILS:${email}`,
      '--var',
      `HONOWARDEN_TOKEN_SECRET:${tokenSecret}`,
      '--var',
      'HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED:false',
      '--var',
      'HONOWARDEN_AUDIT_LOGS:false',
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: commandEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.output = ''
  child.stdout.on('data', (chunk) => appendWorkerOutput(child, chunk))
  child.stderr.on('data', (chunk) => appendWorkerOutput(child, chunk))
  return child
}

function appendWorkerOutput(child, chunk) {
  child.output = `${child.output}${chunk.toString()}`.slice(-40_000)
}

async function waitForHealth(baseUrl, worker) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(
        `wrangler dev exited early (${worker.exitCode})\n${worker.output}`,
      )
    }
    try {
      const response = await globalThis.fetch(`${baseUrl}/health`, {
        signal: globalThis.AbortSignal.timeout(1_000),
      })
      if (response.status === 200) {
        return
      }
    } catch {
      // The worker is still starting.
    }
    await delay(100)
  }
  throw new Error(`wrangler dev did not become healthy\n${worker.output}`)
}

async function stopWorker(worker) {
  await stopDetachedProcessTree(worker)
}

async function readDatabaseState(persistTo) {
  const query = `
    SELECT
      master_password_hash = ${sql(newHash)} AS new_hash_committed,
      user_key = ${sql(newUserKey)} AS new_user_key_committed,
      email_normalized = ${sql(email)}
        AND kdf_algorithm = 'pbkdf2-sha256'
        AND kdf_iterations = 600000
        AND kdf_memory IS NULL
        AND kdf_parallelism IS NULL AS kdf_and_salt_unchanged,
      security_stamp <> ${sql(initialSecurityStamp)} AS security_stamp_rotated
    FROM users WHERE id = ${sql(userId)};
    SELECT
      SUM(CASE WHEN identifier = ${sql(oldDevice)} AND revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS old_device_revoked,
      SUM(CASE WHEN identifier = ${sql(newDevice)} AND revoked_at IS NULL THEN 1 ELSE 0 END) AS new_device_active
    FROM devices WHERE user_id = ${sql(userId)};
    SELECT
      SUM(CASE WHEN device_id = ${sql(`${userId}:${oldDevice}`)} AND revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS old_refresh_token_revoked
    FROM refresh_tokens WHERE user_id = ${sql(userId)};
    SELECT COUNT(*) AS password_change_audit_count
    FROM audit_events
    WHERE actor_user_id = ${sql(userId)} AND name = 'account.password.change';
    SELECT encrypted_json = ${sql(JSON.stringify(encryptedCipher))} AS encrypted_vault_unchanged
    FROM ciphers WHERE id = ${sql(cipherId)} AND user_id = ${sql(userId)};
  `
  const result = await runWrangler([
    'd1',
    'execute',
    databaseName,
    '--local',
    '--persist-to',
    persistTo,
    '--command',
    query,
    '--yes',
    '--json',
  ])
  const executions = JSON.parse(result.stdout)
  const rows = executions.map((execution) => execution.results?.[0] ?? {})
  return {
    newHashCommitted: rows[0]?.new_hash_committed === 1,
    newUserKeyCommitted: rows[0]?.new_user_key_committed === 1,
    kdfAndSaltUnchanged: rows[0]?.kdf_and_salt_unchanged === 1,
    securityStampRotated: rows[0]?.security_stamp_rotated === 1,
    oldDeviceRevoked: rows[1]?.old_device_revoked === 1,
    newDeviceActive: rows[1]?.new_device_active === 1,
    oldRefreshTokenRevoked: rows[2]?.old_refresh_token_revoked === 1,
    passwordChangeAuditCount: Number(rows[3]?.password_change_audit_count ?? 0),
    encryptedVaultUnchanged: rows[4]?.encrypted_vault_unchanged === 1,
  }
}

function runWrangler(args) {
  return runCommand('pnpm', ['exec', 'wrangler', ...args])
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: commandEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          `${command} ${args.slice(0, 4).join(' ')} failed (${code})\n${stderr}`,
        ),
      )
    })
  })
}

function commandEnvironment() {
  return {
    ...process.env,
    CI: 'true',
    NO_COLOR: '1',
    pnpm_config_verify_deps_before_run: 'false',
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) {
          reject(error)
        } else if (port) {
          resolve(port)
        } else {
          reject(new Error('failed to allocate a local port'))
        }
      })
    })
  })
}

async function findDistinctFreePorts() {
  const port = await findFreePort()
  let inspectorPort = await findFreePort()
  while (inspectorPort === port) {
    inspectorPort = await findFreePort()
  }
  return [port, inspectorPort]
}

function findCipher(syncBody) {
  const cipher = syncBody.ciphers?.find(
    (candidate) => candidate.id === cipherId,
  )
  assert(cipher, 'synthetic cipher is missing from sync')
  return cipher
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${name} is missing`)
  }
  return value
}

function assertStatus(result, expected, name) {
  assert(
    result.status === expected,
    `${name} returned ${result.status}, expected ${expected}`,
  )
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function check(id, passed) {
  return { id, status: passed ? 'pass' : 'fail' }
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
