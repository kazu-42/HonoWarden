#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new globalThis.URL('..', import.meta.url))
const databaseName = 'honowarden'
const tokenSecret = 'synthetic-hon205-token-secret-with-32-bytes'
const initialRevision = '2026-07-19T00:00:00.000Z'
const initialSecurityStamp = 'hon205-initial-security-stamp'
const mainPair = {
  publicKey: 'synthetic-hon205-public-key',
  wrappedPrivateKey: '2.synthetic-hon205-wrapped-private-key',
}
const competingPair = {
  publicKey: 'synthetic-hon205-competing-public-key',
  wrappedPrivateKey: '2.synthetic-hon205-competing-wrapped-private-key',
}
const accounts = {
  primary: {
    id: 'hon205-primary-user',
    email: 'hon205-primary@example.test',
    passwordHash: 'synthetic-hon205-authentication-hash',
    userKey: '2.synthetic-hon205-user-key',
    device: 'hon205-primary-device',
  },
  concurrent: {
    id: 'hon205-concurrent-user',
    email: 'hon205-concurrent@example.test',
    passwordHash: 'synthetic-hon205-concurrent-authentication-hash',
    userKey: '2.synthetic-hon205-concurrent-user-key',
    device: 'hon205-concurrent-device',
  },
  rollback: {
    id: 'hon205-rollback-user',
    email: 'hon205-rollback@example.test',
    passwordHash: 'synthetic-hon205-rollback-authentication-hash',
    userKey: '2.synthetic-hon205-rollback-user-key',
    device: 'hon205-rollback-device',
  },
  updateRollback: {
    id: 'hon205-update-rollback-user',
    email: 'hon205-update-rollback@example.test',
    passwordHash: 'synthetic-hon205-update-rollback-authentication-hash',
    userKey: '2.synthetic-hon205-update-rollback-user-key',
    device: 'hon205-update-rollback-device',
  },
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args)
  const managedState = !options.persistTo
  const persistTo = options.persistTo
    ? await ensureDirectory(options.persistTo)
    : await mkdtemp(join(tmpdir(), 'honowarden-hon205-'))
  let worker = null

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
    worker = startWorker({
      persistTo,
      port,
      inspectorPort,
      accountKeysEnabled: true,
    })
    let baseUrl = `http://127.0.0.1:${port}`
    await waitForHealth(baseUrl, worker)

    const loginBeforeInitialization = await passwordGrant(
      baseUrl,
      accounts.primary,
    )
    assertStatus(loginBeforeInitialization, 200, 'initial password grant')
    assert(
      loginBeforeInitialization.body.PrivateKey === null &&
        loginBeforeInitialization.body.AccountKeys === null,
      'missing account keys were not projected as null before initialization',
    )
    const accessToken = requiredString(
      loginBeforeInitialization.body.access_token,
      'initial access token',
    )
    const initialRefreshToken = requiredString(
      loginBeforeInitialization.body.refresh_token,
      'initial refresh token',
    )

    const missingRead = await authorizedJson(
      baseUrl,
      '/api/accounts/keys',
      accessToken,
    )
    assertStatus(missingRead, 409, 'missing account-key read')
    assert(
      missingRead.body.error?.code === 'account_keys_uninitialized',
      'missing account-key read returned an unexpected error',
    )

    const initialize = await postAccountKeys(baseUrl, accessToken, mainPair)
    assertStatus(initialize, 200, 'account-key initialization')
    assertAccountKeyEnvelope(
      initialize.body,
      accounts.primary.userKey,
      mainPair,
      'initialization response',
    )

    const readAfterInitialization = await authorizedJson(
      baseUrl,
      '/api/accounts/keys',
      accessToken,
    )
    assertStatus(readAfterInitialization, 200, 'account-key read')
    assertAccountKeyEnvelope(
      readAfterInitialization.body,
      accounts.primary.userKey,
      mainPair,
      'read response',
    )
    const revisionAfterInitialization = await accountRevision(
      baseUrl,
      accessToken,
    )

    const exactReplay = await postAccountKeys(baseUrl, accessToken, mainPair)
    assertStatus(exactReplay, 200, 'exact account-key replay')
    assertAccountKeyEnvelope(
      exactReplay.body,
      accounts.primary.userKey,
      mainPair,
      'exact replay response',
    )
    const revisionAfterReplay = await accountRevision(baseUrl, accessToken)

    const differentReplacement = await postAccountKeys(
      baseUrl,
      accessToken,
      competingPair,
    )
    assertStatus(differentReplacement, 409, 'different account-key replacement')
    assert(
      differentReplacement.body.error?.code === 'account_key_conflict',
      'different account-key replacement returned an unexpected error',
    )
    const revisionAfterConflict = await accountRevision(baseUrl, accessToken)

    const existingAccessSync = await authorizedJson(
      baseUrl,
      '/api/sync',
      accessToken,
    )
    assertStatus(existingAccessSync, 200, 'sync after initialization')
    assertAccountKeyProjection(
      existingAccessSync.body.profile,
      mainPair,
      'sync profile',
    )

    const refreshAfterInitialization = await refreshGrant(
      baseUrl,
      initialRefreshToken,
    )
    assertStatus(
      refreshAfterInitialization,
      200,
      'refresh after initialization',
    )
    assertTokenAccountKeyProjection(
      refreshAfterInitialization.body,
      mainPair,
      'refresh response',
    )
    const restartRefreshToken = requiredString(
      refreshAfterInitialization.body.refresh_token,
      'rotated refresh token',
    )

    const concurrentLogin = await passwordGrant(baseUrl, accounts.concurrent)
    assertStatus(concurrentLogin, 200, 'concurrent account password grant')
    const concurrentAccessToken = requiredString(
      concurrentLogin.body.access_token,
      'concurrent account access token',
    )
    const concurrentResponses = await Promise.all([
      postAccountKeys(baseUrl, concurrentAccessToken, mainPair),
      postAccountKeys(baseUrl, concurrentAccessToken, mainPair),
    ])
    const concurrentStatuses = concurrentResponses
      .map((response) => response.status)
      .sort((left, right) => left - right)
    assert(
      concurrentStatuses.length === 2 &&
        concurrentStatuses.every((status) => status === 200),
      'concurrent exact initialization did not resolve as two successes',
    )
    for (const [index, response] of concurrentResponses.entries()) {
      assertAccountKeyEnvelope(
        response.body,
        accounts.concurrent.userKey,
        mainPair,
        `concurrent response ${index + 1}`,
      )
    }

    const rollbackLogin = await passwordGrant(baseUrl, accounts.rollback)
    assertStatus(rollbackLogin, 200, 'rollback account password grant')
    const rollbackAccessToken = requiredString(
      rollbackLogin.body.access_token,
      'rollback account access token',
    )
    const auditFailureInitialization = await postAccountKeys(
      baseUrl,
      rollbackAccessToken,
      mainPair,
    )
    assertStatus(
      auditFailureInitialization,
      503,
      'audit failure initialization',
    )
    assert(
      auditFailureInitialization.body.error?.code === 'database_unavailable',
      'audit failure did not return the generic database error',
    )

    const updateRollbackLogin = await passwordGrant(
      baseUrl,
      accounts.updateRollback,
    )
    assertStatus(
      updateRollbackLogin,
      200,
      'update-rollback account password grant',
    )
    const updateRollbackAccessToken = requiredString(
      updateRollbackLogin.body.access_token,
      'update-rollback account access token',
    )
    const userFailureInitialization = await postAccountKeys(
      baseUrl,
      updateRollbackAccessToken,
      mainPair,
    )
    assertStatus(
      userFailureInitialization,
      503,
      'user-update failure initialization',
    )
    assert(
      userFailureInitialization.body.error?.code === 'database_unavailable',
      'user-update failure did not return the generic database error',
    )

    await stopWorker(worker)
    worker = null
    const firstReadback = await readDatabaseState(persistTo)

    const [restartPort, restartInspectorPort] = await findDistinctFreePorts()
    worker = startWorker({
      persistTo,
      port: restartPort,
      inspectorPort: restartInspectorPort,
      accountKeysEnabled: true,
    })
    baseUrl = `http://127.0.0.1:${restartPort}`
    await waitForHealth(baseUrl, worker)

    const readAfterRestart = await authorizedJson(
      baseUrl,
      '/api/accounts/keys',
      accessToken,
    )
    assertStatus(readAfterRestart, 200, 'account-key read after restart')
    assertAccountKeyEnvelope(
      readAfterRestart.body,
      accounts.primary.userKey,
      mainPair,
      'restart read response',
    )

    const profileAfterRestart = await authorizedJson(
      baseUrl,
      '/api/accounts/profile',
      accessToken,
    )
    assertStatus(profileAfterRestart, 200, 'profile after restart')
    assertAccountKeyProjection(
      profileAfterRestart.body,
      mainPair,
      'restart profile',
    )

    const syncAfterRestart = await authorizedJson(
      baseUrl,
      '/api/sync',
      accessToken,
    )
    assertStatus(syncAfterRestart, 200, 'sync after restart')
    assertAccountKeyProjection(
      syncAfterRestart.body.profile,
      mainPair,
      'restart sync profile',
    )

    const refreshAfterRestart = await refreshGrant(baseUrl, restartRefreshToken)
    assertStatus(refreshAfterRestart, 200, 'refresh after restart')
    assertTokenAccountKeyProjection(
      refreshAfterRestart.body,
      mainPair,
      'restart refresh response',
    )

    await stopWorker(worker)
    worker = null
    const beforeDisabledReadback = await readDatabaseState(persistTo)

    const [disabledPort, disabledInspectorPort] = await findDistinctFreePorts()
    worker = startWorker({
      persistTo,
      port: disabledPort,
      inspectorPort: disabledInspectorPort,
      accountKeysEnabled: false,
    })
    baseUrl = `http://127.0.0.1:${disabledPort}`
    await waitForHealth(baseUrl, worker)

    const disabledRead = await authorizedJson(
      baseUrl,
      '/api/accounts/keys',
      accessToken,
    )
    assertStatus(disabledRead, 501, 'disabled account-key read')
    const disabledWrite = await postAccountKeys(baseUrl, accessToken, mainPair)
    assertStatus(disabledWrite, 501, 'disabled account-key write')

    await stopWorker(worker)
    worker = null
    const finalReadback = await readDatabaseState(persistTo)
    const disabledStateUnchanged =
      JSON.stringify(beforeDisabledReadback) === JSON.stringify(finalReadback)

    const checks = [
      check(
        'official_v1_envelope_projected',
        initialize.status === 200 &&
          readAfterInitialization.status === 200 &&
          existingAccessSync.status === 200 &&
          refreshAfterInitialization.status === 200,
      ),
      check(
        'exact_replay_is_noop',
        revisionAfterInitialization === revisionAfterReplay &&
          revisionAfterReplay === revisionAfterConflict &&
          finalReadback.initializationAuditCount === 1,
      ),
      check(
        'different_replacement_rejected',
        differentReplacement.status === 409 &&
          finalReadback.primaryPairInitialized,
      ),
      check(
        'security_stamp_and_sessions_preserved',
        finalReadback.primarySecurityStampPreserved &&
          existingAccessSync.status === 200 &&
          refreshAfterInitialization.status === 200 &&
          finalReadback.activeDeviceCount === 1 &&
          finalReadback.activeRefreshTokenCount === 1,
      ),
      check(
        'one_audit_per_initialized_account',
        finalReadback.initializationAuditCount === 1 &&
          finalReadback.concurrentAuditCount === 1 &&
          finalReadback.auditsRedacted,
      ),
      check(
        'audit_failure_rolls_back_keypair',
        auditFailureInitialization.status === 503 &&
          userFailureInitialization.status === 503 &&
          finalReadback.rollbackPairMissing &&
          finalReadback.rollbackRevisionUnchanged &&
          finalReadback.rollbackAuditCount === 0,
      ),
      check(
        'restart_preserves_read_and_session_paths',
        readAfterRestart.status === 200 &&
          profileAfterRestart.status === 200 &&
          syncAfterRestart.status === 200 &&
          refreshAfterRestart.status === 200,
      ),
      check(
        'disabled_flag_is_state_free',
        disabledRead.status === 501 &&
          disabledWrite.status === 501 &&
          disabledStateUnchanged,
      ),
      check(
        'concurrent_exact_retry_commits_once',
        concurrentStatuses.every((status) => status === 200) &&
          finalReadback.concurrentPairInitialized &&
          finalReadback.concurrentAuditCount === 1,
      ),
      check(
        'account_revision_advanced_once',
        firstReadback.primaryRevisionAdvanced &&
          firstReadback.revisionDate === finalReadback.revisionDate,
      ),
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
        loginBeforeInitialization: loginBeforeInitialization.status,
        missingRead: missingRead.status,
        initialize: initialize.status,
        readAfterInitialization: readAfterInitialization.status,
        exactReplay: exactReplay.status,
        differentReplacement: differentReplacement.status,
        existingAccessSync: existingAccessSync.status,
        refreshAfterInitialization: refreshAfterInitialization.status,
        concurrentInitialization: concurrentStatuses,
        auditFailureInitialization: auditFailureInitialization.status,
        userFailureInitialization: userFailureInitialization.status,
        readAfterRestart: readAfterRestart.status,
        profileAfterRestart: profileAfterRestart.status,
        syncAfterRestart: syncAfterRestart.status,
        refreshAfterRestart: refreshAfterRestart.status,
        disabledRead: disabledRead.status,
        disabledWrite: disabledWrite.status,
      },
      readback: {
        revisionDate: finalReadback.revisionDate,
        initializationAuditCount: finalReadback.initializationAuditCount,
        concurrentAuditCount: finalReadback.concurrentAuditCount,
        rollbackAuditCount: finalReadback.rollbackAuditCount,
        activeDeviceCount: finalReadback.activeDeviceCount,
        activeRefreshTokenCount: finalReadback.activeRefreshTokenCount,
      },
      checks,
      limitations: [
        'Synthetic client-derived authentication hashes and opaque public/wrapped-private values only.',
        'No remote Cloudflare resource, production deployment, real user, or official client UI was used.',
        'True key replacement, V2 account keys, security state, TDE, and data rewrap remain outside HON-205.',
      ],
    }

    if (status !== 'passed') {
      throw new Error('account-key lifecycle checks failed')
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    if (worker) {
      await stopWorker(worker)
    }
    if (managedState && !options.keepState) {
      await rm(persistTo, { recursive: true, force: true })
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
  return `
    ${seedUserSql(accounts.primary, 'HON-205 Primary')}
    ${seedUserSql(accounts.concurrent, 'HON-205 Concurrent')}
    ${seedUserSql(accounts.rollback, 'HON-205 Rollback')}
    ${seedUserSql(accounts.updateRollback, 'HON-205 Update Rollback')}
    CREATE TRIGGER hon205_fail_account_key_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.name = 'account.keys.initialize'
      AND NEW.actor_user_id = ${sql(accounts.rollback.id)}
    BEGIN
      SELECT RAISE(ABORT, 'synthetic HON-205 account-key audit failure');
    END;
    CREATE TRIGGER hon205_fail_account_key_user_update
    BEFORE UPDATE OF public_key, private_key ON users
    WHEN OLD.id = ${sql(accounts.updateRollback.id)}
    BEGIN
      SELECT RAISE(ABORT, 'synthetic HON-205 account-key user failure');
    END;
  `
}

function seedUserSql(account, displayName) {
  return `
    INSERT INTO users (
      id, email, email_normalized, display_name, kdf_algorithm,
      kdf_iterations, kdf_memory, kdf_parallelism, master_password_hash,
      user_key, public_key, private_key, security_stamp, revision_date
    ) VALUES (
      ${sql(account.id)}, ${sql(account.email)}, ${sql(account.email)},
      ${sql(displayName)}, 'pbkdf2-sha256', 600000, NULL, NULL,
      ${sql(account.passwordHash)}, ${sql(account.userKey)}, NULL, NULL,
      ${sql(initialSecurityStamp)}, ${sql(initialRevision)}
    );
  `
}

async function passwordGrant(baseUrl, account) {
  return requestJson(baseUrl, '/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'password',
      username: account.email,
      password: account.passwordHash,
      scope: 'api offline_access',
      deviceIdentifier: account.device,
      deviceName: 'HON-205 Synthetic Lifecycle',
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

function postAccountKeys(baseUrl, accessToken, pair) {
  return requestJson(baseUrl, '/api/accounts/keys', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      publicKey: pair.publicKey,
      encryptedPrivateKey: pair.wrappedPrivateKey,
    }),
  })
}

async function accountRevision(baseUrl, accessToken) {
  const response = await authorizedJson(
    baseUrl,
    '/api/accounts/revision-date',
    accessToken,
  )
  assertStatus(response, 200, 'account revision read')
  return requiredString(response.body, 'account revision')
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

function startWorker({ persistTo, port, inspectorPort, accountKeysEnabled }) {
  const allowedEmails = Object.values(accounts)
    .map((account) => account.email)
    .join(',')
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
      `HONOWARDEN_ALLOWED_EMAILS:${allowedEmails}`,
      '--var',
      `HONOWARDEN_TOKEN_SECRET:${tokenSecret}`,
      '--var',
      `HONOWARDEN_ACCOUNT_KEYS_ENABLED:${accountKeysEnabled ? 'true' : 'false'}`,
      '--var',
      'HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED:false',
      '--var',
      'HONOWARDEN_AUDIT_LOGS:false',
    ],
    {
      cwd: repoRoot,
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
      // The Worker is still starting.
    }
    await delay(100)
  }
  throw new Error(`wrangler dev did not become healthy\n${worker.output}`)
}

async function stopWorker(worker) {
  if (worker.exitCode !== null) {
    return
  }
  const exited = once(worker, 'exit').then(() => true)
  worker.kill('SIGTERM')
  const stopped = await Promise.race([exited, delay(5_000).then(() => false)])
  if (!stopped && worker.exitCode === null) {
    worker.kill('SIGKILL')
    await Promise.race([exited, delay(2_000)])
  }
}

async function readDatabaseState(persistTo) {
  const query = `
    SELECT
      public_key = ${sql(mainPair.publicKey)}
        AND private_key = ${sql(mainPair.wrappedPrivateKey)}
        AS primary_pair_initialized,
      security_stamp = ${sql(initialSecurityStamp)}
        AS primary_security_stamp_preserved,
      revision_date > ${sql(initialRevision)} AS primary_revision_advanced,
      revision_date
    FROM users WHERE id = ${sql(accounts.primary.id)};
    SELECT
      COUNT(*) AS initialization_audit_count,
      SUM(
        CASE WHEN instr(COALESCE(context_json, ''), ${sql(mainPair.publicKey)}) = 0
          AND instr(COALESCE(context_json, ''), ${sql(mainPair.wrappedPrivateKey)}) = 0
        THEN 1 ELSE 0 END
      ) AS redacted_audit_count
    FROM audit_events
    WHERE actor_user_id = ${sql(accounts.primary.id)}
      AND name = 'account.keys.initialize';
    SELECT COUNT(*) AS active_device_count
    FROM devices
    WHERE user_id = ${sql(accounts.primary.id)} AND revoked_at IS NULL;
    SELECT COUNT(*) AS active_refresh_token_count
    FROM refresh_tokens
    WHERE user_id = ${sql(accounts.primary.id)} AND revoked_at IS NULL;
    SELECT
      public_key = ${sql(mainPair.publicKey)}
        AND private_key = ${sql(mainPair.wrappedPrivateKey)}
        AS concurrent_pair_initialized,
      (
        SELECT COUNT(*) FROM audit_events
        WHERE actor_user_id = ${sql(accounts.concurrent.id)}
          AND name = 'account.keys.initialize'
      ) AS concurrent_audit_count
    FROM users WHERE id = ${sql(accounts.concurrent.id)};
    SELECT
      SUM(CASE WHEN public_key IS NULL AND private_key IS NULL THEN 1 ELSE 0 END) = 2
        AS rollback_pair_missing,
      SUM(CASE WHEN revision_date = ${sql(initialRevision)} THEN 1 ELSE 0 END) = 2
        AS rollback_revision_unchanged,
      (
        SELECT COUNT(*) FROM audit_events
        WHERE actor_user_id IN (
          ${sql(accounts.rollback.id)},
          ${sql(accounts.updateRollback.id)}
        )
          AND name = 'account.keys.initialize'
      ) AS rollback_audit_count
    FROM users
    WHERE id IN (
      ${sql(accounts.rollback.id)},
      ${sql(accounts.updateRollback.id)}
    );
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
  const initializationAuditCount = Number(
    rows[1]?.initialization_audit_count ?? 0,
  )
  return {
    primaryPairInitialized: rows[0]?.primary_pair_initialized === 1,
    primarySecurityStampPreserved:
      rows[0]?.primary_security_stamp_preserved === 1,
    primaryRevisionAdvanced: rows[0]?.primary_revision_advanced === 1,
    revisionDate: requiredString(rows[0]?.revision_date, 'D1 revision date'),
    initializationAuditCount,
    auditsRedacted:
      Number(rows[1]?.redacted_audit_count ?? 0) === initializationAuditCount,
    activeDeviceCount: Number(rows[2]?.active_device_count ?? 0),
    activeRefreshTokenCount: Number(rows[3]?.active_refresh_token_count ?? 0),
    concurrentPairInitialized: rows[4]?.concurrent_pair_initialized === 1,
    concurrentAuditCount: Number(rows[4]?.concurrent_audit_count ?? 0),
    rollbackPairMissing: rows[5]?.rollback_pair_missing === 1,
    rollbackRevisionUnchanged: rows[5]?.rollback_revision_unchanged === 1,
    rollbackAuditCount: Number(rows[5]?.rollback_audit_count ?? 0),
  }
}

function assertAccountKeyEnvelope(body, userKey, pair, name) {
  assert(body?.object === 'keys', `${name} object is missing`)
  assert(body?.key === userKey, `${name} wrapped user key is missing`)
  assert(body?.publicKey === pair.publicKey, `${name} public key is missing`)
  assert(
    body?.privateKey === pair.wrappedPrivateKey,
    `${name} wrapped private key is missing`,
  )
  assertAccountKeysObject(body?.accountKeys, pair, name)
}

function assertAccountKeyProjection(body, pair, name) {
  assert(
    body?.privateKey === pair.wrappedPrivateKey,
    `${name} private-key projection is missing`,
  )
  assertAccountKeysObject(body?.accountKeys, pair, name)
}

function assertTokenAccountKeyProjection(body, pair, name) {
  assert(
    body?.PrivateKey === pair.wrappedPrivateKey,
    `${name} private-key projection is missing`,
  )
  assertAccountKeysObject(body?.AccountKeys, pair, name)
}

function assertAccountKeysObject(accountKeys, pair, name) {
  assert(accountKeys?.object === 'privateKeys', `${name} object is invalid`)
  assert(accountKeys?.signatureKeyPair === null, `${name} signature key leaked`)
  assert(accountKeys?.securityState === null, `${name} security state is set`)
  const encryptionPair = accountKeys?.publicKeyEncryptionKeyPair
  assert(
    encryptionPair?.object === 'publicKeyEncryptionKeyPair' &&
      encryptionPair?.publicKey === pair.publicKey &&
      encryptionPair?.wrappedPrivateKey === pair.wrappedPrivateKey &&
      encryptionPair?.signedPublicKey === null,
    `${name} nested keypair is invalid`,
  )
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
  return { ...process.env, CI: 'true', NO_COLOR: '1' }
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
