import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URLSearchParams } from 'node:url'

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const repoRoot = path.resolve(workflowRoot, '..', '..')
const wranglerPath = path.join(repoRoot, 'node_modules', '.bin', 'wrangler')
const runId = `auth-2a-real-d1-${Date.now()}`
const persistPath = path.join(repoRoot, 'test', '.tmp', runId)
const outputPath = path.join(
  workflowRoot,
  'results',
  'auth-2a-real-d1-evidence.json',
)
const tokenSecret = 'synthetic-auth-2a-token-secret'
const masterPasswordHash = 'synthetic-auth-2a-master-password-hash'
const userId = 'synthetic-auth-2a-user'
const email = 'auth-2a@example.test'
const oldSecurityStamp = 'synthetic-auth-2a-old-security-stamp'
const oldRevisionDate = '2026-07-19T00:00:00.000Z'
const successRequestId = 'auth-2a-real-d1-success'
const rollbackRequestId = 'auth-2a-real-d1-rollback'

let completed = false
let activeServer = null

try {
  const migrationManifest = await readMigrationManifest()
  await mkdir(persistPath, { recursive: true })
  await runWrangler([
    'd1',
    'migrations',
    'apply',
    'honowarden',
    '--local',
    '--persist-to',
    persistPath,
  ])
  await executeSql(seedSql())

  const migrations = await queryOne(
    'SELECT COUNT(*) AS count, MAX(version) AS latest FROM schema_migrations',
  )
  assert.equal(Number(migrations.count), migrationManifest.count)
  assert.equal(migrations.latest, migrationManifest.latest)

  activeServer = await startServer()
  const initialToken = signAccessToken(oldSecurityStamp)
  const successResponse = await postRotation(
    activeServer.origin,
    initialToken,
    successRequestId,
  )
  assert.equal(successResponse.status, 200)
  assert.equal(await successResponse.text(), '')
  assert.equal(successResponse.headers.get('Cache-Control'), 'no-store')

  const oldTokenResponse = await globalThis.fetch(
    `${activeServer.origin}/api/sync`,
    {
      headers: { Authorization: `Bearer ${initialToken}` },
    },
  )
  assert.equal(oldTokenResponse.status, 401)
  const oldTokenBody = await oldTokenResponse.json()
  assert.equal(oldTokenBody.error?.code, 'invalid_token')
  const successLogs = activeServer.logs
  await activeServer.stop()
  activeServer = null

  const successState = normalizeState(await readState())
  assert.equal(successState.securityStampIsOld, false)
  assert.equal(successState.revisionIsOld, false)
  assert.equal(successState.ownerActiveDevices, 0)
  assert.equal(successState.ownerRevokedDevices, 2)
  assert.equal(successState.ownerActiveRefreshTokens, 0)
  assert.equal(successState.ownerRevokedRefreshTokens, 2)
  assert.equal(successState.credentialAuditEvents, 1)
  assert.equal(successState.externalActiveDevices, 1)
  assert.equal(successState.externalActiveRefreshTokens, 1)
  assert.equal(
    successLogs.some((line) =>
      line.includes('"name":"account.security_stamp.rotate"'),
    ),
    true,
  )

  activeServer = await startServer()
  const loginResponse = await passwordLogin(activeServer.origin)
  assert.equal(loginResponse.status, 200)
  const loginBody = await loginResponse.json()
  assert.equal(typeof loginBody.access_token, 'string')
  assert.equal(typeof loginBody.refresh_token, 'string')
  const newTokenResponse = await globalThis.fetch(
    `${activeServer.origin}/api/sync`,
    {
      headers: { Authorization: `Bearer ${loginBody.access_token}` },
    },
  )
  assert.equal(newTokenResponse.status, 200)
  await activeServer.stop()
  activeServer = null

  const reloginState = normalizeState(await readState())
  assert.equal(reloginState.ownerActiveDevices, 1)
  assert.equal(reloginState.ownerRevokedDevices, 1)
  assert.equal(reloginState.ownerActiveRefreshTokens, 1)
  assert.equal(reloginState.ownerRevokedRefreshTokens, 2)
  assert.equal(reloginState.credentialAuditEvents, 1)

  await executeSql(`${resetOwnerGenerationSql()}
    CREATE TRIGGER force_credential_audit_failure
    BEFORE INSERT ON audit_events
    WHEN NEW.name = 'account.security_stamp.rotate'
    BEGIN
      SELECT RAISE(ABORT, 'forced credential audit failure');
    END;
  `)
  activeServer = await startServer()
  const rollbackResponse = await postRotation(
    activeServer.origin,
    signAccessToken(oldSecurityStamp),
    rollbackRequestId,
  )
  assert.equal(rollbackResponse.status, 503)
  const rollbackBody = await rollbackResponse.json()
  assert.equal(rollbackBody.error?.code, 'database_unavailable')
  const rollbackLogs = activeServer.logs
  await activeServer.stop()
  activeServer = null

  const rollbackState = normalizeState(await readState())
  assert.equal(rollbackState.securityStampIsOld, true)
  assert.equal(rollbackState.revisionIsOld, true)
  assert.equal(rollbackState.ownerActiveDevices, 2)
  assert.equal(rollbackState.ownerRevokedDevices, 0)
  assert.equal(rollbackState.ownerActiveRefreshTokens, 2)
  assert.equal(rollbackState.ownerRevokedRefreshTokens, 0)
  assert.equal(rollbackState.credentialAuditEvents, 0)
  assert.equal(
    rollbackLogs.some((line) =>
      line.includes('account_security_stamp_rotation_failed'),
    ),
    true,
  )

  await executeSql(`
    DROP TRIGGER force_credential_audit_failure;
    ${resetOwnerGenerationSql()}
  `)
  activeServer = await startServer()
  const concurrentToken = signAccessToken(oldSecurityStamp)
  const concurrentResponses = await Promise.all([
    postRotation(
      activeServer.origin,
      concurrentToken,
      'auth-2a-concurrent-one',
    ),
    postRotation(
      activeServer.origin,
      concurrentToken,
      'auth-2a-concurrent-two',
    ),
  ])
  const concurrentStatuses = concurrentResponses
    .map((response) => response.status)
    .sort((left, right) => left - right)
  assert.equal(concurrentStatuses.filter((status) => status === 200).length, 1)
  assert.equal(
    concurrentStatuses.filter((status) => status === 401 || status === 409)
      .length,
    1,
  )
  await activeServer.stop()
  activeServer = null

  const concurrentState = normalizeState(await readState())
  assert.equal(concurrentState.securityStampIsOld, false)
  assert.equal(concurrentState.ownerActiveDevices, 0)
  assert.equal(concurrentState.ownerRevokedDevices, 2)
  assert.equal(concurrentState.ownerActiveRefreshTokens, 0)
  assert.equal(concurrentState.ownerRevokedRefreshTokens, 2)
  assert.equal(concurrentState.credentialAuditEvents, 1)

  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'passed',
    scope: 'fresh local D1 and local Worker with synthetic data only',
    migrations: {
      count: Number(migrations.count),
      latest: migrations.latest,
      files: migrationManifest.files,
      schemaChangeRequired: false,
    },
    success: {
      responseStatus: successResponse.status,
      oldAccessTokenStatus: oldTokenResponse.status,
      state: successState,
      requiredAuditLogged: true,
    },
    relogin: {
      passwordGrantStatus: loginResponse.status,
      newAccessTokenSyncStatus: newTokenResponse.status,
      state: reloginState,
    },
    rollback: {
      forcedFailure: 'audit trigger abort',
      responseStatus: rollbackResponse.status,
      state: rollbackState,
      structuredFailureLogged: true,
    },
    concurrency: {
      responseStatuses: concurrentStatuses,
      exactlyOneSuccess: true,
      state: concurrentState,
    },
    safety: {
      remoteDatabaseUsed: false,
      productionAccountUsed: false,
      realCredentialUsed: false,
      plaintextVaultDataUsed: false,
      temporaryStateRemovedAfterSuccess: true,
    },
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  completed = true
  console.log(JSON.stringify({ ...evidence, output: outputPath }, null, 2))
} finally {
  if (activeServer) {
    await activeServer.stop()
  }
  if (completed) {
    await rm(persistPath, { recursive: true, force: true })
  } else {
    console.error(`real D1 state retained for diagnosis: ${persistPath}`)
  }
}

async function postRotation(origin, token, requestId) {
  return globalThis.fetch(`${origin}/api/accounts/security-stamp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    },
    body: JSON.stringify({ masterPasswordHash }),
  })
}

async function readMigrationManifest() {
  const files = (await readdir(path.join(repoRoot, 'migrations')))
    .filter((file) => /^[0-9][0-9a-z]*_.+\.sql$/.test(file))
    .sort()
  assert.notEqual(files.length, 0)
  const latest = files.at(-1)?.split('_', 1)[0]
  assert(latest)
  return { count: files.length, latest, files }
}

async function passwordLogin(origin) {
  return globalThis.fetch(`${origin}/identity/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: email,
      password: masterPasswordHash,
      scope: 'api offline_access',
      deviceIdentifier: 'fixture-device',
      deviceName: 'Synthetic CLI',
      deviceType: '8',
    }),
  })
}

function signAccessToken(securityStamp) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' })
  const payload = encodeJson({
    sub: userId,
    email,
    device: 'fixture-device',
    securityStamp,
    iat: issuedAt,
    exp: issuedAt + 3600,
    authMethod: 'password',
  })
  const signingInput = `${header}.${payload}`
  const signature = createHmac('sha256', tokenSecret)
    .update(signingInput)
    .digest('base64url')
  return `${signingInput}.${signature}`
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

async function startServer() {
  const port = await findFreePort()
  const inspectorPort = await findFreePort()
  const logs = []
  const child = spawn(
    wranglerPath,
    [
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistPath,
      '--var',
      `HONOWARDEN_TOKEN_SECRET:${tokenSecret}`,
      '--log-level',
      'log',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))
  const origin = `http://127.0.0.1:${port}`

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited early: ${logs.join('')}`)
    }
    try {
      const response = await globalThis.fetch(`${origin}/healthz`)
      if (response.status === 200) {
        return {
          origin,
          logs,
          stop: () => stopProcess(child),
        }
      }
    } catch {
      // The local listener is not ready yet.
    }
    await delay(100)
  }
  await stopProcess(child)
  throw new Error(`wrangler dev did not become ready: ${logs.join('')}`)
}

async function stopProcess(child) {
  if (child.exitCode !== null) {
    return
  }
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    delay(5000).then(() => false),
  ])
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

async function findFreePort() {
  const server = net.createServer()
  server.unref()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  const port = address.port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function executeSql(sql) {
  await runWrangler([
    'd1',
    'execute',
    'honowarden',
    '--local',
    '--persist-to',
    persistPath,
    '--command',
    sql,
    '--yes',
  ])
}

async function queryOne(sql) {
  const result = await runWrangler([
    'd1',
    'execute',
    'honowarden',
    '--local',
    '--persist-to',
    persistPath,
    '--command',
    sql,
    '--json',
    '--yes',
  ])
  const payload = JSON.parse(result.stdout)
  const entries = Array.isArray(payload) ? payload : [payload]
  const rows = entries.flatMap((entry) => entry.results ?? [])
  assert.equal(rows.length, 1)
  return rows[0]
}

async function runWrangler(args) {
  const child = spawn(wranglerPath, args, {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const [exitCode] = await once(child, 'exit')
  if (exitCode !== 0) {
    throw new Error(
      `wrangler ${args.slice(0, 3).join(' ')} failed (${exitCode}): ${stderr || stdout}`,
    )
  }
  return { stdout, stderr }
}

function normalizeState(row) {
  return {
    securityStampIsOld: row.securityStamp === oldSecurityStamp,
    revisionIsOld: row.revisionDate === oldRevisionDate,
    ownerActiveDevices: Number(row.ownerActiveDevices),
    ownerRevokedDevices: Number(row.ownerRevokedDevices),
    ownerActiveRefreshTokens: Number(row.ownerActiveRefreshTokens),
    ownerRevokedRefreshTokens: Number(row.ownerRevokedRefreshTokens),
    credentialAuditEvents: Number(row.credentialAuditEvents),
    externalActiveDevices: Number(row.externalActiveDevices),
    externalActiveRefreshTokens: Number(row.externalActiveRefreshTokens),
  }
}

async function readState() {
  return queryOne(`
    SELECT
      (SELECT security_stamp FROM users WHERE id = '${userId}') AS securityStamp,
      (SELECT revision_date FROM users WHERE id = '${userId}') AS revisionDate,
      (SELECT COUNT(*) FROM devices WHERE user_id = '${userId}' AND revoked_at IS NULL) AS ownerActiveDevices,
      (SELECT COUNT(*) FROM devices WHERE user_id = '${userId}' AND revoked_at IS NOT NULL) AS ownerRevokedDevices,
      (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = '${userId}' AND revoked_at IS NULL) AS ownerActiveRefreshTokens,
      (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = '${userId}' AND revoked_at IS NOT NULL) AS ownerRevokedRefreshTokens,
      (SELECT COUNT(*) FROM audit_events WHERE name = 'account.security_stamp.rotate') AS credentialAuditEvents,
      (SELECT COUNT(*) FROM devices WHERE user_id = 'synthetic-external-user' AND revoked_at IS NULL) AS externalActiveDevices,
      (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = 'synthetic-external-user' AND revoked_at IS NULL) AS externalActiveRefreshTokens
  `)
}

function resetOwnerGenerationSql() {
  return `
    DELETE FROM audit_events;
    DELETE FROM refresh_tokens WHERE user_id = '${userId}';
    DELETE FROM devices WHERE user_id = '${userId}';
    UPDATE users
    SET security_stamp = '${oldSecurityStamp}',
        revision_date = '${oldRevisionDate}',
        updated_at = '${oldRevisionDate}'
    WHERE id = '${userId}';
    INSERT INTO devices (id, user_id, identifier, name, type)
    VALUES
      ('${userId}:fixture-device', '${userId}', 'fixture-device', 'Synthetic CLI', 8),
      ('${userId}:other-device', '${userId}', 'other-device', 'Synthetic Browser', 3);
    INSERT INTO refresh_tokens (id, user_id, device_id, token_hash, expires_at)
    VALUES
      ('synthetic-owner-token-one', '${userId}', '${userId}:fixture-device', 'synthetic-owner-token-hash-one', '2999-07-19T00:00:00.000Z'),
      ('synthetic-owner-token-two', '${userId}', '${userId}:other-device', 'synthetic-owner-token-hash-two', '2999-07-19T00:00:00.000Z');
  `
}

function seedSql() {
  return `
    INSERT INTO users (
      id, email, email_normalized, display_name, kdf_algorithm,
      kdf_iterations, master_password_hash, user_key, public_key, private_key,
      security_stamp, revision_date, updated_at
    ) VALUES
      ('${userId}', '${email}', '${email}', 'Synthetic AUTH-2A', 'pbkdf2-sha256',
       600000, '${masterPasswordHash}', '2.synthetic-user-key', 'synthetic-public-key',
       '2.synthetic-private-key', '${oldSecurityStamp}', '${oldRevisionDate}', '${oldRevisionDate}'),
      ('synthetic-external-user', 'external-auth-2a@example.test', 'external-auth-2a@example.test',
       'Synthetic External', 'pbkdf2-sha256', 600000, 'synthetic-external-hash',
       '2.synthetic-external-user-key', NULL, NULL, 'synthetic-external-stamp',
       '${oldRevisionDate}', '${oldRevisionDate}');
    ${resetOwnerGenerationSql()}
    INSERT INTO devices (id, user_id, identifier, name, type)
    VALUES ('synthetic-external-device', 'synthetic-external-user', 'external-device', 'External', 8);
    INSERT INTO refresh_tokens (id, user_id, device_id, token_hash, expires_at)
    VALUES ('synthetic-external-token', 'synthetic-external-user', 'synthetic-external-device',
            'synthetic-external-token-hash', '2999-07-19T00:00:00.000Z');
  `
}
