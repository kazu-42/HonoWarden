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
const email = 'hon204-lifecycle@example.test'
const pendingEmail = 'hon204-pending@example.test'
const userId = 'hon204-lifecycle-user'
const cipherId = 'hon204-lifecycle-cipher'
const oldHash = 'synthetic-hon204-old-authentication-hash'
const newHash = 'synthetic-hon204-new-authentication-hash'
const finalHash = 'synthetic-hon204-final-pbkdf2-authentication-hash'
const oldUserKey = '2.synthetic-hon204-old-user-key'
const newUserKey = '2.synthetic-hon204-new-user-key'
const finalUserKey = '2.synthetic-hon204-final-pbkdf2-user-key'
const tokenSecret = 'synthetic-hon204-token-secret-with-32-bytes'
const oldDevice = 'hon204-old-device'
const newDevice = 'hon204-new-device'
const finalDevice = 'hon204-final-device'
const initialRevision = '2026-07-19T00:00:00.000Z'
const initialSecurityStamp = 'hon204-initial-security-stamp'
const encryptedCipher = {
  name: '2.synthetic-hon204-encrypted-name',
  notes: '2.synthetic-hon204-encrypted-notes',
  login: {
    username: '2.synthetic-hon204-encrypted-username',
    password: '2.synthetic-hon204-encrypted-password',
    uris: [],
  },
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args)
  const managedState = !options.persistTo
  const persistTo = options.persistTo
    ? await ensureDirectory(options.persistTo)
    : await mkdtemp(join(tmpdir(), 'honowarden-hon204-'))
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
    worker = startWorker({ persistTo, port, inspectorPort })
    let baseUrl = `http://127.0.0.1:${port}`
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
    const unknownPreloginBefore = await preloginRequest(baseUrl, pendingEmail)
    assertStatus(
      unknownPreloginBefore,
      200,
      'unknown-account prelogin before KDF change',
    )
    assert(
      unknownPreloginBefore.body.kdf === 0 &&
        unknownPreloginBefore.body.kdfIterations === 600000,
      'unknown-account prelogin did not use the stored PBKDF2 population',
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

    const kdfChange = await postCredentialJson(
      baseUrl,
      '/api/accounts/kdf',
      oldAccessToken,
      kdfChangeBody(),
    )
    assertStatus(kdfChange, 200, 'KDF change')

    const preloginAfter = await requestJson(
      baseUrl,
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ email }),
      },
    )
    assertStatus(preloginAfter, 200, 'prelogin after KDF change')
    assert(
      preloginAfter.body.kdf === 1 &&
        preloginAfter.body.kdfIterations === 6 &&
        preloginAfter.body.kdfMemory === 32 &&
        preloginAfter.body.kdfParallelism === 4 &&
        preloginAfter.body.kdfSettings?.kdfType === 1 &&
        preloginAfter.body.salt === email,
      'prelogin did not project the Argon2id generation',
    )
    const unknownPreloginAfter = await preloginRequest(baseUrl, pendingEmail)
    assertStatus(
      unknownPreloginAfter,
      200,
      'unknown-account prelogin after KDF change',
    )
    assert(
      unknownPreloginAfter.body.kdf === 1 &&
        unknownPreloginAfter.body.kdfIterations === 6 &&
        unknownPreloginAfter.body.kdfMemory === 32 &&
        unknownPreloginAfter.body.kdfParallelism === 4,
      'unknown-account prelogin did not track the stored Argon2id population',
    )

    const oldAccessAfter = await authorizedJson(
      baseUrl,
      '/api/sync',
      oldAccessToken,
    )
    assertStatus(oldAccessAfter, 401, 'old access token after KDF change')
    const oldRefreshAfter = await refreshGrant(baseUrl, oldRefreshToken)
    assertStatus(oldRefreshAfter, 400, 'old refresh token after KDF change')
    assert(
      oldRefreshAfter.body.error === 'invalid_grant',
      'old refresh token was not rejected',
    )
    const oldLoginAfter = await passwordGrant(
      baseUrl,
      oldHash,
      'hon204-rejected-device',
    )
    assertStatus(oldLoginAfter, 400, 'old-KDF login after change')
    assert(
      oldLoginAfter.body.error === 'invalid_grant',
      'old KDF authentication hash was not rejected',
    )

    const newLogin = await passwordGrant(baseUrl, newHash, newDevice)
    assertStatus(newLogin, 200, 'new-KDF login after change')
    const newAccessToken = requiredString(
      newLogin.body.access_token,
      'new access token',
    )
    assert(
      newLogin.body.Key === newUserKey,
      'new wrapped user key is missing from login',
    )
    assert(
      newLogin.body.Kdf === 1 &&
        newLogin.body.KdfIterations === 6 &&
        newLogin.body.KdfMemory === 32 &&
        newLogin.body.KdfParallelism === 4 &&
        newLogin.body.UserDecryptionOptions?.MasterPasswordUnlock?.Kdf
          ?.KdfType === 1,
      'login did not project the Argon2id generation',
    )

    const profile = await authorizedJson(
      baseUrl,
      '/api/accounts/profile',
      newAccessToken,
    )
    assertStatus(profile, 200, 'profile after KDF change')
    assert(
      profile.body.userDecryptionOptions?.masterPasswordUnlock?.kdf?.kdfType ===
        1,
      'profile did not project the Argon2id generation',
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
      'encrypted vault data changed during KDF change',
    )
    assert(
      afterSync.body.userDecryption?.masterPasswordUnlock?.kdf?.kdfType === 1,
      'sync did not project the Argon2id generation',
    )
    const verifyAfter = await postCredentialJson(
      baseUrl,
      '/api/accounts/verify-password',
      newAccessToken,
      { masterPasswordHash: newHash },
    )
    assertStatus(verifyAfter, 200, 'verify-password after change')
    const newRefreshToken = requiredString(
      newLogin.body.refresh_token,
      'new refresh token',
    )
    const newRefresh = await refreshGrant(baseUrl, newRefreshToken)
    assertStatus(newRefresh, 200, 'new refresh token after KDF change')
    assert(
      newRefresh.body.Kdf === 1 &&
        newRefresh.body.KdfIterations === 6 &&
        newRefresh.body.KdfMemory === 32 &&
        newRefresh.body.KdfParallelism === 4,
      'refresh response did not project the Argon2id generation',
    )
    const argonRefreshToken = requiredString(
      newRefresh.body.refresh_token,
      'rotated Argon2id refresh token',
    )

    await stopWorker(worker)
    worker = null
    const firstReadback = await readDatabaseState(persistTo, {
      masterPasswordHash: newHash,
      userKey: newUserKey,
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      revokedDeviceIdentifier: oldDevice,
      activeDeviceIdentifier: newDevice,
      revokedRefreshDeviceId: `${userId}:${oldDevice}`,
    })

    const [roundTripPort, roundTripInspectorPort] =
      await findDistinctFreePorts()
    worker = startWorker({
      persistTo,
      port: roundTripPort,
      inspectorPort: roundTripInspectorPort,
    })
    baseUrl = `http://127.0.0.1:${roundTripPort}`
    await waitForHealth(baseUrl, worker)

    const kdfChangeBackToPbkdf2 = await postCredentialJson(
      baseUrl,
      '/api/accounts/kdf',
      newAccessToken,
      pbkdf2KdfChangeBody(),
    )
    assertStatus(kdfChangeBackToPbkdf2, 200, 'Argon2id-to-PBKDF2 KDF change')

    const preloginAfterRoundTrip = await preloginRequest(baseUrl, email)
    assertStatus(preloginAfterRoundTrip, 200, 'prelogin after KDF round trip')
    assert(
      preloginAfterRoundTrip.body.kdf === 0 &&
        preloginAfterRoundTrip.body.kdfIterations === 600000 &&
        preloginAfterRoundTrip.body.kdfMemory === null &&
        preloginAfterRoundTrip.body.kdfParallelism === null &&
        preloginAfterRoundTrip.body.kdfSettings?.kdfType === 0,
      'prelogin did not project the final PBKDF2 generation',
    )
    const unknownPreloginAfterRoundTrip = await preloginRequest(
      baseUrl,
      pendingEmail,
    )
    assertStatus(
      unknownPreloginAfterRoundTrip,
      200,
      'unknown-account prelogin after KDF round trip',
    )
    assert(
      unknownPreloginAfterRoundTrip.body.kdf === 0 &&
        unknownPreloginAfterRoundTrip.body.kdfIterations === 600000 &&
        unknownPreloginAfterRoundTrip.body.kdfMemory === null &&
        unknownPreloginAfterRoundTrip.body.kdfParallelism === null,
      'unknown-account prelogin did not track the final PBKDF2 population',
    )

    const argonAccessAfterRoundTrip = await authorizedJson(
      baseUrl,
      '/api/sync',
      newAccessToken,
    )
    assertStatus(
      argonAccessAfterRoundTrip,
      401,
      'Argon2id access token after KDF round trip',
    )
    const argonRefreshAfterRoundTrip = await refreshGrant(
      baseUrl,
      argonRefreshToken,
    )
    assertStatus(
      argonRefreshAfterRoundTrip,
      400,
      'Argon2id refresh token after KDF round trip',
    )
    const argonLoginAfterRoundTrip = await passwordGrant(
      baseUrl,
      newHash,
      'hon204-rejected-argon-device',
    )
    assertStatus(
      argonLoginAfterRoundTrip,
      400,
      'Argon2id authentication hash after KDF round trip',
    )

    const pbkdf2LoginAfterRoundTrip = await passwordGrant(
      baseUrl,
      finalHash,
      finalDevice,
    )
    assertStatus(
      pbkdf2LoginAfterRoundTrip,
      200,
      'PBKDF2 login after KDF round trip',
    )
    const finalAccessToken = requiredString(
      pbkdf2LoginAfterRoundTrip.body.access_token,
      'final PBKDF2 access token',
    )
    assert(
      pbkdf2LoginAfterRoundTrip.body.Key === finalUserKey &&
        pbkdf2LoginAfterRoundTrip.body.Kdf === 0 &&
        pbkdf2LoginAfterRoundTrip.body.KdfIterations === 600000 &&
        pbkdf2LoginAfterRoundTrip.body.KdfMemory === null &&
        pbkdf2LoginAfterRoundTrip.body.KdfParallelism === null &&
        pbkdf2LoginAfterRoundTrip.body.UserDecryptionOptions
          ?.MasterPasswordUnlock?.Kdf?.KdfType === 0,
      'login did not project the final PBKDF2 generation',
    )

    const profileAfterRoundTrip = await authorizedJson(
      baseUrl,
      '/api/accounts/profile',
      finalAccessToken,
    )
    assertStatus(profileAfterRoundTrip, 200, 'profile after KDF round trip')
    assert(
      profileAfterRoundTrip.body.userDecryptionOptions?.masterPasswordUnlock
        ?.kdf?.kdfType === 0,
      'profile did not project the final PBKDF2 generation',
    )
    const syncAfterRoundTrip = await authorizedJson(
      baseUrl,
      '/api/sync',
      finalAccessToken,
    )
    assertStatus(syncAfterRoundTrip, 200, 'sync after KDF round trip')
    assert(
      syncAfterRoundTrip.body.profile?.key === finalUserKey &&
        syncAfterRoundTrip.body.userDecryption?.masterPasswordUnlock?.kdf
          ?.kdfType === 0,
      'sync did not project the final PBKDF2 generation',
    )
    assert(
      JSON.stringify(findCipher(syncAfterRoundTrip.body)) ===
        JSON.stringify(beforeCipher),
      'encrypted vault data changed during the KDF round trip',
    )
    const verifyAfterRoundTrip = await postCredentialJson(
      baseUrl,
      '/api/accounts/verify-password',
      finalAccessToken,
      { masterPasswordHash: finalHash },
    )
    assertStatus(
      verifyAfterRoundTrip,
      200,
      'verify-password after KDF round trip',
    )
    const finalRefreshToken = requiredString(
      pbkdf2LoginAfterRoundTrip.body.refresh_token,
      'final PBKDF2 refresh token',
    )
    const refreshAfterRoundTrip = await refreshGrant(baseUrl, finalRefreshToken)
    assertStatus(
      refreshAfterRoundTrip,
      200,
      'PBKDF2 refresh after KDF round trip',
    )
    assert(
      refreshAfterRoundTrip.body.Kdf === 0 &&
        refreshAfterRoundTrip.body.KdfIterations === 600000 &&
        refreshAfterRoundTrip.body.KdfMemory === null &&
        refreshAfterRoundTrip.body.KdfParallelism === null,
      'refresh response did not project the final PBKDF2 generation',
    )

    await stopWorker(worker)
    worker = null
    const finalReadback = await readDatabaseState(persistTo, {
      masterPasswordHash: finalHash,
      userKey: finalUserKey,
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      revokedDeviceIdentifier: newDevice,
      activeDeviceIdentifier: finalDevice,
      revokedRefreshDeviceId: `${userId}:${newDevice}`,
    })
    const checks = [
      check('prelogin_projects_argon2id', preloginAfter.body.kdf === 1),
      check(
        'unknown_prelogin_tracks_stored_distribution',
        unknownPreloginBefore.body.kdf === 0 &&
          unknownPreloginAfter.body.kdf === 1,
      ),
      check('old_access_token_rejected', oldAccessAfter.status === 401),
      check('old_refresh_token_rejected', oldRefreshAfter.status === 400),
      check('old_kdf_login_rejected', oldLoginAfter.status === 400),
      check('new_kdf_login_succeeds', newLogin.status === 200),
      check('new_kdf_verifies', verifyAfter.status === 200),
      check('new_kdf_refresh_succeeds', newRefresh.status === 200),
      check(
        'authentication_hash_replaced',
        firstReadback.authenticationHashCommitted,
      ),
      check('wrapped_user_key_replaced', firstReadback.userKeyCommitted),
      check('kdf_changed_to_argon2id', firstReadback.kdfCommitted),
      check(
        'kdf_population_tracks_argon2id_generation',
        firstReadback.populationMatchesExpectedGeneration,
      ),
      check('account_salt_unchanged', firstReadback.accountSaltUnchanged),
      check(
        'security_stamp_rotated',
        firstReadback.securityStamp !== initialSecurityStamp,
      ),
      check('old_device_revoked', firstReadback.revokedDevice),
      check('old_refresh_token_revoked', firstReadback.revokedRefreshToken),
      check('new_device_active', firstReadback.activeDevice),
      check(
        'first_mandatory_audit_persisted',
        firstReadback.kdfChangeAuditCount === 1,
      ),
      check(
        'first_encrypted_vault_unchanged',
        firstReadback.encryptedVaultUnchanged,
      ),
      check(
        'kdf_changed_back_to_pbkdf2',
        kdfChangeBackToPbkdf2.status === 200 && finalReadback.kdfCommitted,
      ),
      check(
        'kdf_population_tracks_final_pbkdf2_generation',
        finalReadback.populationMatchesExpectedGeneration,
      ),
      check(
        'old_argon_access_token_rejected',
        argonAccessAfterRoundTrip.status === 401,
      ),
      check(
        'old_argon_refresh_token_rejected',
        argonRefreshAfterRoundTrip.status === 400,
      ),
      check(
        'old_argon_login_rejected',
        argonLoginAfterRoundTrip.status === 400,
      ),
      check('pbkdf2_prelogin_projected', preloginAfterRoundTrip.body.kdf === 0),
      check(
        'unknown_prelogin_tracks_round_trip_distribution',
        unknownPreloginAfterRoundTrip.body.kdf === 0,
      ),
      check('pbkdf2_login_succeeds', pbkdf2LoginAfterRoundTrip.status === 200),
      check('pbkdf2_verifies', verifyAfterRoundTrip.status === 200),
      check('pbkdf2_refresh_succeeds', refreshAfterRoundTrip.status === 200),
      check(
        'final_authentication_hash_committed',
        finalReadback.authenticationHashCommitted,
      ),
      check('final_wrapped_user_key_committed', finalReadback.userKeyCommitted),
      check(
        'account_revision_advanced_each_generation',
        revisionAdvanced(firstReadback.revisionDate, initialRevision) &&
          revisionAdvanced(
            finalReadback.revisionDate,
            firstReadback.revisionDate,
          ),
      ),
      check(
        'security_stamp_rotated_each_generation',
        firstReadback.securityStamp !== initialSecurityStamp &&
          finalReadback.securityStamp !== firstReadback.securityStamp,
      ),
      check('argon_device_revoked', finalReadback.revokedDevice),
      check('argon_refresh_token_revoked', finalReadback.revokedRefreshToken),
      check('final_device_active', finalReadback.activeDevice),
      check(
        'two_mandatory_audits_persisted',
        finalReadback.kdfChangeAuditCount === 2,
      ),
      check(
        'encrypted_vault_unchanged_after_round_trip',
        finalReadback.encryptedVaultUnchanged,
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
        prelogin: prelogin.status,
        unknownPreloginBeforeChange: unknownPreloginBefore.status,
        oldLoginBeforeChange: oldLogin.status,
        verifyBeforeChange: verifyBefore.status,
        kdfChange: kdfChange.status,
        preloginAfterChange: preloginAfter.status,
        unknownPreloginAfterChange: unknownPreloginAfter.status,
        oldAccessAfterChange: oldAccessAfter.status,
        oldRefreshAfterChange: oldRefreshAfter.status,
        oldLoginAfterChange: oldLoginAfter.status,
        newLoginAfterChange: newLogin.status,
        syncAfterChange: afterSync.status,
        profileAfterChange: profile.status,
        refreshAfterChange: newRefresh.status,
        verifyAfterChange: verifyAfter.status,
        kdfChangeBackToPbkdf2: kdfChangeBackToPbkdf2.status,
        preloginAfterRoundTrip: preloginAfterRoundTrip.status,
        unknownPreloginAfterRoundTrip: unknownPreloginAfterRoundTrip.status,
        argonAccessAfterRoundTrip: argonAccessAfterRoundTrip.status,
        argonRefreshAfterRoundTrip: argonRefreshAfterRoundTrip.status,
        argonLoginAfterRoundTrip: argonLoginAfterRoundTrip.status,
        pbkdf2LoginAfterRoundTrip: pbkdf2LoginAfterRoundTrip.status,
        syncAfterRoundTrip: syncAfterRoundTrip.status,
        profileAfterRoundTrip: profileAfterRoundTrip.status,
        refreshAfterRoundTrip: refreshAfterRoundTrip.status,
        verifyAfterRoundTrip: verifyAfterRoundTrip.status,
      },
      readback: {
        kdfChangeAuditCount: finalReadback.kdfChangeAuditCount,
        firstRevisionDate: firstReadback.revisionDate,
        finalRevisionDate: finalReadback.revisionDate,
      },
      checks,
      limitations: [
        'Synthetic account, authentication hashes, wrapped key, and encrypted vault payload only.',
        'No remote Cloudflare resource, production deployment, real user, or official client UI was used.',
        'Durable notification socket invalidation is covered by route tests, not this local lifecycle.',
      ],
    }

    if (status !== 'passed') {
      throw new Error('KDF-change lifecycle checks failed')
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
  const encryptedJson = JSON.stringify(encryptedCipher)
  return `
    INSERT INTO users (
      id, email, email_normalized, display_name, kdf_algorithm,
      kdf_iterations, kdf_memory, kdf_parallelism, master_password_hash,
      user_key, public_key, private_key, security_stamp, revision_date
    ) VALUES (
      ${sql(userId)}, ${sql(email)}, ${sql(email)}, 'HON-204 Lifecycle',
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

function kdfChangeBody() {
  const kdf = {
    kdfType: 1,
    iterations: 6,
    memory: 32,
    parallelism: 4,
  }
  return {
    masterPasswordHash: oldHash,
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

function pbkdf2KdfChangeBody() {
  const kdf = {
    kdfType: 0,
    iterations: 600000,
    memory: null,
    parallelism: null,
  }
  return {
    masterPasswordHash: newHash,
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: finalHash,
      salt: email,
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: finalUserKey,
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
      deviceName: 'HON-204 Synthetic Lifecycle',
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

function preloginRequest(baseUrl, accountEmail) {
  return requestJson(baseUrl, '/identity/accounts/prelogin', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email: accountEmail }),
  })
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
      `HONOWARDEN_ALLOWED_EMAILS:${email},${pendingEmail}`,
      '--var',
      `HONOWARDEN_TOKEN_SECRET:${tokenSecret}`,
      '--var',
      'HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED:false',
      '--var',
      'HONOWARDEN_KDF_MUTATION_ENABLED:true',
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
      // The worker is still starting.
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

async function readDatabaseState(persistTo, expected) {
  const query = `
    SELECT
      master_password_hash,
      user_key,
      kdf_algorithm,
      kdf_iterations,
      kdf_memory,
      kdf_parallelism,
      email_normalized,
      security_stamp,
      revision_date
    FROM users WHERE id = ${sql(userId)};
    SELECT identifier, revoked_at
    FROM devices WHERE user_id = ${sql(userId)};
    SELECT device_id, revoked_at
    FROM refresh_tokens WHERE user_id = ${sql(userId)};
    SELECT COUNT(*) AS kdf_change_audit_count
    FROM audit_events
    WHERE actor_user_id = ${sql(userId)} AND name = 'account.kdf.change';
    SELECT encrypted_json
    FROM ciphers WHERE id = ${sql(cipherId)} AND user_id = ${sql(userId)};
    SELECT
      kdf_algorithm,
      kdf_iterations,
      CASE WHEN kdf_memory_is_null = 1 THEN NULL ELSE kdf_memory END AS kdf_memory,
      CASE WHEN kdf_parallelism_is_null = 1 THEN NULL ELSE kdf_parallelism END AS kdf_parallelism,
      account_count
    FROM account_kdf_population
    ORDER BY
      kdf_algorithm,
      kdf_iterations,
      kdf_memory,
      kdf_parallelism;
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
  const account = executions[0]?.results?.[0] ?? {}
  const devices = executions[1]?.results ?? []
  const refreshTokens = executions[2]?.results ?? []
  const audit = executions[3]?.results?.[0] ?? {}
  const cipher = executions[4]?.results?.[0] ?? {}
  const population = executions[5]?.results ?? []
  const expectedRefreshTokens = refreshTokens.filter(
    (token) => token.device_id === expected.revokedRefreshDeviceId,
  )

  return {
    authenticationHashCommitted:
      account.master_password_hash === expected.masterPasswordHash,
    userKeyCommitted: account.user_key === expected.userKey,
    kdfCommitted:
      account.kdf_algorithm === expected.kdfAlgorithm &&
      Number(account.kdf_iterations) === expected.kdfIterations &&
      account.kdf_memory === expected.kdfMemory &&
      account.kdf_parallelism === expected.kdfParallelism,
    populationMatchesExpectedGeneration:
      population.length === 1 &&
      population[0]?.kdf_algorithm === expected.kdfAlgorithm &&
      Number(population[0]?.kdf_iterations) === expected.kdfIterations &&
      population[0]?.kdf_memory === expected.kdfMemory &&
      population[0]?.kdf_parallelism === expected.kdfParallelism &&
      Number(population[0]?.account_count) === 1,
    accountSaltUnchanged: account.email_normalized === email,
    securityStamp:
      typeof account.security_stamp === 'string' ? account.security_stamp : '',
    revisionDate:
      typeof account.revision_date === 'string' ? account.revision_date : '',
    revokedDevice: devices.some(
      (device) =>
        device.identifier === expected.revokedDeviceIdentifier &&
        device.revoked_at !== null,
    ),
    activeDevice: devices.some(
      (device) =>
        device.identifier === expected.activeDeviceIdentifier &&
        device.revoked_at === null,
    ),
    revokedRefreshToken:
      expectedRefreshTokens.length > 0 &&
      expectedRefreshTokens.every((token) => token.revoked_at !== null),
    kdfChangeAuditCount: Number(audit.kdf_change_audit_count ?? 0),
    encryptedVaultUnchanged:
      cipher.encrypted_json === JSON.stringify(encryptedCipher),
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

function revisionAdvanced(candidate, previous) {
  const candidateTime = Date.parse(candidate)
  const previousTime = Date.parse(previous)
  return (
    Number.isFinite(candidateTime) &&
    Number.isFinite(previousTime) &&
    candidateTime > previousTime
  )
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
