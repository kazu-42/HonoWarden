#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new globalThis.URL('..', import.meta.url))
const databaseName = 'honowarden'
const r2BucketName = 'honowarden-vault-objects'
const tokenSecret = 'synthetic-hon206-token-secret-with-32-bytes'
const initialRevision = '2026-07-20T00:00:00.000Z'
const r2SentinelBody = Buffer.from(
  'synthetic-hon206-r2-body::opaque-attachment-ciphertext',
)

const scenarios = {
  primary: scenario({
    slug: 'primary',
    userId: '11111111-1111-4111-8111-111111111111',
    folderId: '11111111-1111-4111-8111-111111111112',
    cipherId: '11111111-1111-4111-8111-111111111113',
    attachmentId: '11111111-1111-4111-8111-111111111114',
    trustedDeviceId: '11111111-1111-4111-8111-111111111115',
  }),
  rollback: scenario({
    slug: 'rollback',
    userId: '22222222-2222-4222-8222-222222222221',
    folderId: '22222222-2222-4222-8222-222222222222',
    cipherId: '22222222-2222-4222-8222-222222222223',
    attachmentId: '22222222-2222-4222-8222-222222222224',
    trustedDeviceId: '22222222-2222-4222-8222-222222222225',
  }),
  concurrent: scenario({
    slug: 'concurrent',
    userId: '33333333-3333-4333-8333-333333333331',
    folderId: '33333333-3333-4333-8333-333333333332',
    cipherId: '33333333-3333-4333-8333-333333333333',
    attachmentId: '33333333-3333-4333-8333-333333333334',
    trustedDeviceId: '33333333-3333-4333-8333-333333333335',
  }),
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args)
  const managedState = !options.persistTo
  const persistTo = options.persistTo
    ? await ensureDirectory(options.persistTo)
    : await mkdtemp(join(tmpdir(), 'honowarden-hon206-'))
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
    await putR2Sentinel(persistTo)

    const [port, inspectorPort] = await findDistinctFreePorts()
    worker = startWorker({
      persistTo,
      port,
      inspectorPort,
      rotationEnabled: true,
      globalQuotaEnabled: false,
    })
    let baseUrl = `http://127.0.0.1:${port}`
    await waitForHealth(baseUrl, worker)

    const primaryOldLoginBefore = await passwordGrant(
      baseUrl,
      scenarios.primary,
      generation(scenarios.primary, 'old').passwordHash,
      scenarios.primary.oldDeviceIdentifier,
    )
    assertStatus(
      primaryOldLoginBefore,
      200,
      'primary old login before rotation',
    )
    const primaryOldAccessToken = requiredString(
      primaryOldLoginBefore.body.access_token,
      'primary old access token',
    )
    const primaryOldRefreshToken = requiredString(
      primaryOldLoginBefore.body.refresh_token,
      'primary old refresh token',
    )
    assertTokenProjection(
      primaryOldLoginBefore.body,
      scenarios.primary,
      generation(scenarios.primary, 'old'),
      'primary old login',
    )

    const primarySyncBefore = await authorizedJson(
      baseUrl,
      '/api/sync',
      primaryOldAccessToken,
    )
    assertStatus(primarySyncBefore, 200, 'primary sync before rotation')
    assertProfileProjection(
      primarySyncBefore.body.profile,
      scenarios.primary,
      generation(scenarios.primary, 'old'),
      'primary sync before rotation',
    )
    const primaryAttachmentBefore = await authorizedBytes(
      baseUrl,
      attachmentPath(scenarios.primary),
      primaryOldAccessToken,
    )
    assertStatus(
      primaryAttachmentBefore,
      200,
      'primary attachment before rotation',
    )
    assert(
      primaryAttachmentBefore.body.equals(r2SentinelBody),
      'primary R2 sentinel bytes differ before rotation',
    )

    const primaryRotation = await postRotation(
      baseUrl,
      primaryOldAccessToken,
      rotationBody(scenarios.primary, 'next'),
      'primary',
    )
    assertStatus(primaryRotation, 200, 'primary rotation')

    const rollbackOldLoginBefore = await passwordGrant(
      baseUrl,
      scenarios.rollback,
      generation(scenarios.rollback, 'old').passwordHash,
      scenarios.rollback.oldDeviceIdentifier,
    )
    assertStatus(
      rollbackOldLoginBefore,
      200,
      'rollback old login before rotation',
    )
    const rollbackOldAccessToken = requiredString(
      rollbackOldLoginBefore.body.access_token,
      'rollback old access token',
    )
    const rollbackRotation = await postRotation(
      baseUrl,
      rollbackOldAccessToken,
      rotationBody(scenarios.rollback, 'next'),
      'rollback',
    )
    assertStatus(rollbackRotation, 503, 'required-audit abort rotation')
    assert(
      rollbackRotation.body.error?.code === 'database_unavailable',
      'required-audit abort did not return the generic database error',
    )
    const rollbackAccessAfterAbort = await authorizedJson(
      baseUrl,
      '/api/sync',
      rollbackOldAccessToken,
    )
    assertStatus(rollbackAccessAfterAbort, 200, 'rollback access after abort')

    const concurrentOldLoginBefore = await passwordGrant(
      baseUrl,
      scenarios.concurrent,
      generation(scenarios.concurrent, 'old').passwordHash,
      scenarios.concurrent.oldDeviceIdentifier,
    )
    assertStatus(
      concurrentOldLoginBefore,
      200,
      'concurrent old login before rotation',
    )
    const concurrentOldAccessToken = requiredString(
      concurrentOldLoginBefore.body.access_token,
      'concurrent old access token',
    )
    const concurrentResponses = await Promise.all([
      postRotation(
        baseUrl,
        concurrentOldAccessToken,
        rotationBody(scenarios.concurrent, 'first'),
        'concurrent-first',
      ),
      postRotation(
        baseUrl,
        concurrentOldAccessToken,
        rotationBody(scenarios.concurrent, 'second'),
        'concurrent-second',
      ),
    ])
    const concurrentRotation = concurrentResponses
      .map((response) => response.status)
      .sort((left, right) => left - right)
    assert(
      concurrentRotation.filter((status) => status === 200).length === 1 &&
        concurrentRotation.every((status) => [200, 401, 409].includes(status)),
      `concurrent route results were not one success plus one safe rejection: ${concurrentRotation.join(',')}`,
    )

    const primaryOldAccessAfter = await authorizedJson(
      baseUrl,
      '/api/sync',
      primaryOldAccessToken,
    )
    assertStatus(
      primaryOldAccessAfter,
      401,
      'primary old access after rotation',
    )
    const primaryOldRefreshAfter = await refreshGrant(
      baseUrl,
      primaryOldRefreshToken,
    )
    assertStatus(
      primaryOldRefreshAfter,
      400,
      'primary old refresh after rotation',
    )
    const primaryOldPasswordAfter = await passwordGrant(
      baseUrl,
      scenarios.primary,
      generation(scenarios.primary, 'old').passwordHash,
      'hon206-primary-rejected-old-password',
    )
    assertStatus(
      primaryOldPasswordAfter,
      400,
      'primary old password after rotation',
    )

    await stopWorker(worker)
    worker = null
    const firstReadback = await readDatabaseState(persistTo)
    const firstR2Readback = await readR2Sentinel(persistTo, 'first')

    const [restartPort, restartInspectorPort] = await findDistinctFreePorts()
    worker = startWorker({
      persistTo,
      port: restartPort,
      inspectorPort: restartInspectorPort,
      rotationEnabled: true,
      globalQuotaEnabled: false,
    })
    baseUrl = `http://127.0.0.1:${restartPort}`
    await waitForHealth(baseUrl, worker)

    const primaryOldAccessAfterRestart = await authorizedJson(
      baseUrl,
      '/api/sync',
      primaryOldAccessToken,
    )
    assertStatus(
      primaryOldAccessAfterRestart,
      401,
      'primary old access after restart',
    )
    const primaryNewLoginAfterRestart = await passwordGrant(
      baseUrl,
      scenarios.primary,
      generation(scenarios.primary, 'next').passwordHash,
      scenarios.primary.newDeviceIdentifier,
    )
    assertStatus(
      primaryNewLoginAfterRestart,
      200,
      'primary new login after restart',
    )
    const primaryNewAccessToken = requiredString(
      primaryNewLoginAfterRestart.body.access_token,
      'primary new access token',
    )
    assertTokenProjection(
      primaryNewLoginAfterRestart.body,
      scenarios.primary,
      generation(scenarios.primary, 'next'),
      'primary new login after restart',
    )

    const profileAfterRestart = await authorizedJson(
      baseUrl,
      '/api/accounts/profile',
      primaryNewAccessToken,
    )
    assertStatus(profileAfterRestart, 200, 'profile after restart')
    assertProfileProjection(
      profileAfterRestart.body,
      scenarios.primary,
      generation(scenarios.primary, 'next'),
      'profile after restart',
    )

    const syncAfterRestart = await authorizedJson(
      baseUrl,
      '/api/sync',
      primaryNewAccessToken,
    )
    assertStatus(syncAfterRestart, 200, 'sync after restart')
    assertCompleteVaultProjection(
      syncAfterRestart.body,
      scenarios.primary,
      'next',
      'sync after restart',
    )

    const backupAfterRestart = await authorizedJson(
      baseUrl,
      '/api/accounts/export',
      primaryNewAccessToken,
      { method: 'POST' },
    )
    assertStatus(backupAfterRestart, 200, 'backup after restart')
    assertBackupProjection(backupAfterRestart.body, scenarios.primary, 'next')

    const attachmentAfterRestart = await authorizedBytes(
      baseUrl,
      attachmentPath(scenarios.primary),
      primaryNewAccessToken,
    )
    assertStatus(attachmentAfterRestart, 200, 'attachment after restart')
    assert(
      attachmentAfterRestart.body.equals(r2SentinelBody),
      'primary R2 sentinel bytes differ after rotation and restart',
    )

    await stopWorker(worker)
    worker = null
    const beforeDisabledReadback = await readDatabaseState(persistTo)
    const secondR2Readback = await readR2Sentinel(persistTo, 'second')

    const [disabledPort, disabledInspectorPort] = await findDistinctFreePorts()
    worker = startWorker({
      persistTo,
      port: disabledPort,
      inspectorPort: disabledInspectorPort,
      rotationEnabled: false,
      globalQuotaEnabled: true,
    })
    baseUrl = `http://127.0.0.1:${disabledPort}`
    await waitForHealth(baseUrl, worker)
    const disabledPost = await postRotation(
      baseUrl,
      primaryNewAccessToken,
      rotationBody(scenarios.primary, 'next'),
      'disabled',
    )
    assertStatus(disabledPost, 501, 'disabled rotation')

    await stopWorker(worker)
    worker = null
    const finalReadback = await readDatabaseState(persistTo)
    const finalR2Readback = await readR2Sentinel(persistTo, 'final')
    const disabledStateUnchanged =
      JSON.stringify(beforeDisabledReadback) === JSON.stringify(finalReadback)
    const r2Unchanged = [
      firstR2Readback,
      secondR2Readback,
      finalR2Readback,
    ].every((body) => body.equals(r2SentinelBody))

    const checks = [
      check(
        'primary_populated_generation_committed',
        primaryRotation.status === 200 &&
          firstReadback.primaryGenerationCommitted &&
          firstReadback.primaryVaultGenerationCommitted &&
          firstReadback.primaryAttachmentIdentityPreserved &&
          firstReadback.primaryTrustedDeviceRotated,
      ),
      check(
        'old_access_refresh_password_rejected',
        primaryOldAccessAfter.status === 401 &&
          primaryOldRefreshAfter.status === 400 &&
          primaryOldPasswordAfter.status === 400 &&
          primaryOldAccessAfterRestart.status === 401 &&
          finalReadback.primaryOldSessionsRevoked,
      ),
      check(
        'new_profile_sync_backup_consistent_after_restart',
        primaryNewLoginAfterRestart.status === 200 &&
          profileAfterRestart.status === 200 &&
          syncAfterRestart.status === 200 &&
          backupAfterRestart.status === 200 &&
          finalReadback.primaryGenerationCommitted &&
          finalReadback.activePrimaryDeviceCount === 1 &&
          finalReadback.activePrimaryRefreshTokenCount === 1,
      ),
      check(
        'required_audit_abort_rolls_back_every_mutation',
        rollbackRotation.status === 503 &&
          rollbackAccessAfterAbort.status === 200 &&
          firstReadback.rollbackGenerationUnchanged &&
          firstReadback.rollbackVaultUnchanged &&
          firstReadback.rollbackSessionPreserved &&
          firstReadback.rollbackRotationAuditCount === 0,
      ),
      check(
        'concurrent_requests_commit_exactly_one_generation',
        concurrentRotation.filter((status) => status === 200).length === 1 &&
          firstReadback.concurrentGenerationCoherent &&
          firstReadback.concurrentRotationAuditCount === 1,
      ),
      check(
        'r2_object_identity_and_bytes_unchanged',
        primaryAttachmentBefore.body.equals(r2SentinelBody) &&
          attachmentAfterRestart.body.equals(r2SentinelBody) &&
          r2Unchanged &&
          finalReadback.primaryAttachmentIdentityPreserved,
      ),
      check(
        'auth_requests_superseded_atomically',
        firstReadback.primarySupersededAuthRequestCount === 2,
      ),
      check('required_audits_are_redacted', finalReadback.auditsRedacted),
      check(
        'disabled_route_is_state_free',
        disabledPost.status === 501 && disabledStateUnchanged,
      ),
    ]
    const status = checks.every((entry) => entry.status === 'pass')
      ? 'passed'
      : 'failed'
    const report = {
      schemaVersion: 1,
      status,
      mode: 'wrangler-local-d1-r2-synthetic',
      upstreamPins: {
        server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
        client: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
      },
      routes: {
        primaryOldLoginBefore: primaryOldLoginBefore.status,
        primarySyncBefore: primarySyncBefore.status,
        primaryAttachmentBefore: primaryAttachmentBefore.status,
        primaryRotation: primaryRotation.status,
        primaryOldAccessAfter: primaryOldAccessAfter.status,
        primaryOldRefreshAfter: primaryOldRefreshAfter.status,
        primaryOldPasswordAfter: primaryOldPasswordAfter.status,
        rollbackOldLoginBefore: rollbackOldLoginBefore.status,
        rollbackRotation: rollbackRotation.status,
        rollbackAccessAfterAbort: rollbackAccessAfterAbort.status,
        concurrentOldLoginBefore: concurrentOldLoginBefore.status,
        concurrentRotation,
        primaryOldAccessAfterRestart: primaryOldAccessAfterRestart.status,
        primaryNewLoginAfterRestart: primaryNewLoginAfterRestart.status,
        profileAfterRestart: profileAfterRestart.status,
        syncAfterRestart: syncAfterRestart.status,
        backupAfterRestart: backupAfterRestart.status,
        attachmentAfterRestart: attachmentAfterRestart.status,
        disabledPost: disabledPost.status,
      },
      readback: {
        primaryRotationAuditCount: finalReadback.primaryRotationAuditCount,
        rollbackRotationAuditCount: finalReadback.rollbackRotationAuditCount,
        concurrentRotationAuditCount:
          finalReadback.concurrentRotationAuditCount,
        primarySupersededAuthRequestCount:
          finalReadback.primarySupersededAuthRequestCount,
        activePrimaryDeviceCount: finalReadback.activePrimaryDeviceCount,
        activePrimaryRefreshTokenCount:
          finalReadback.activePrimaryRefreshTokenCount,
        r2SentinelSha256: sha256(r2SentinelBody),
      },
      checks,
      limitations: [
        'Synthetic client-derived authentication hashes, wrapped keys, encrypted vault payloads, and R2 bytes only.',
        'No remote Cloudflare resource, production deployment, real user, or official client UI was used.',
        'The pinned request is fixture-only evidence and does not promote any official-client compatibility row.',
        'Durable notification transport rejection is covered by focused route tests; this lifecycle runs with notifications disabled.',
      ],
    }

    if (status !== 'passed') {
      throw new Error('user-key rotation lifecycle checks failed')
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

function scenario(input) {
  return {
    ...input,
    email: `hon206-${input.slug}@example.test`,
    publicKey: `synthetic-hon206-${input.slug}-public-key`,
    oldDeviceIdentifier: `hon206-${input.slug}-old-device`,
    newDeviceIdentifier: `hon206-${input.slug}-new-device`,
    r2ObjectKey: `attachments/hon206-${input.slug}-immutable-object`,
  }
}

function generation(target, label) {
  return {
    passwordHash: `synthetic-hon206-${target.slug}-${label}-authentication-hash`,
    userKey: `2.synthetic-hon206-${target.slug}-${label}-user-key`,
    wrappedPrivateKey: `2.synthetic-hon206-${target.slug}-${label}-private-key`,
    folderName: `2.synthetic-hon206-${target.slug}-${label}-folder-name`,
    cipherName: `2.synthetic-hon206-${target.slug}-${label}-cipher-name`,
    attachmentFileName: `2.synthetic-hon206-${target.slug}-${label}-file-name`,
    attachmentKey: `2.synthetic-hon206-${target.slug}-${label}-attachment-key`,
    trustedPublicKey: `2.synthetic-hon206-${target.slug}-${label}-device-public-key`,
    trustedUserKey: `2.synthetic-hon206-${target.slug}-${label}-device-user-key`,
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
    ${seedScenarioSql(scenarios.primary, true)}
    ${seedScenarioSql(scenarios.rollback, false)}
    ${seedScenarioSql(scenarios.concurrent, false)}
    CREATE TRIGGER hon206_fail_rotation_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.name = 'account.keys.rotate'
      AND NEW.actor_user_id = ${sql(scenarios.rollback.userId)}
    BEGIN
      SELECT RAISE(ABORT, 'synthetic HON-206 required-audit failure');
    END;
  `
}

function seedScenarioSql(target, includeAuthRequests) {
  const old = generation(target, 'old')
  const attachmentSize =
    target === scenarios.primary ? r2SentinelBody.byteLength : 32
  return `
    INSERT INTO users (
      id, email, email_normalized, display_name, kdf_algorithm,
      kdf_iterations, kdf_memory, kdf_parallelism, master_password_hash,
      user_key, public_key, private_key, security_stamp, revision_date,
      created_at, updated_at
    ) VALUES (
      ${sql(target.userId)}, ${sql(target.email)}, ${sql(target.email)},
      ${sql(`HON-206 ${target.slug}`)}, 'pbkdf2-sha256', 600000, NULL, NULL,
      ${sql(old.passwordHash)}, ${sql(old.userKey)}, ${sql(target.publicKey)},
      ${sql(old.wrappedPrivateKey)}, ${sql(`${target.slug}-old-security-stamp`)},
      ${sql(initialRevision)}, ${sql(initialRevision)}, ${sql(initialRevision)}
    );
    INSERT INTO folders (
      id, user_id, encrypted_name, revision_date, created_at, updated_at
    ) VALUES (
      ${sql(target.folderId)}, ${sql(target.userId)}, ${sql(old.folderName)},
      ${sql(initialRevision)}, ${sql(initialRevision)}, ${sql(initialRevision)}
    );
    INSERT INTO ciphers (
      id, user_id, folder_id, type, favorite, encrypted_json, revision_date,
      created_at, updated_at, organization_id, cipher_key
    ) VALUES (
      ${sql(target.cipherId)}, ${sql(target.userId)}, ${sql(target.folderId)},
      1, 0, ${sql(JSON.stringify(storedCipherPayload(target, 'old')))},
      ${sql(initialRevision)}, ${sql(initialRevision)}, ${sql(initialRevision)},
      NULL, NULL
    );
    INSERT INTO cipher_attachments (
      id, user_id, cipher_id, object_key, file_name, attachment_key, size,
      content_type, revision_date, created_at, updated_at
    ) VALUES (
      ${sql(target.attachmentId)}, ${sql(target.userId)}, ${sql(target.cipherId)},
      ${sql(target.r2ObjectKey)}, ${sql(old.attachmentFileName)},
      ${sql(old.attachmentKey)}, ${attachmentSize}, 'application/octet-stream',
      ${sql(initialRevision)}, ${sql(initialRevision)}, ${sql(initialRevision)}
    );
    INSERT INTO devices (
      id, user_id, identifier, name, type, last_seen_at, revoked_at,
      encrypted_user_key, encrypted_public_key, encrypted_private_key,
      created_at, updated_at
    ) VALUES (
      ${sql(target.trustedDeviceId)}, ${sql(target.userId)},
      ${sql(`hon206-${target.slug}-trusted-device`)},
      ${sql(`HON-206 ${target.slug} trusted device`)}, 8,
      ${sql(initialRevision)}, NULL, ${sql(old.trustedUserKey)},
      ${sql(old.trustedPublicKey)},
      ${sql(`2.synthetic-hon206-${target.slug}-immutable-device-private-key`)},
      ${sql(initialRevision)}, ${sql(initialRevision)}
    );
    ${includeAuthRequests ? seedAuthRequestsSql(target) : ''}
  `
}

function seedAuthRequestsSql(target) {
  return ['pending', 'approved']
    .map((status, index) => {
      const approved = status === 'approved'
      const id = `hon206-${target.slug}-auth-request-${index + 1}`
      return `
        INSERT INTO auth_requests (
          id, user_id, email_hash, request_type, request_device_identifier,
          request_device_type, request_public_key, access_code_hash, status,
          request_approved, encrypted_response_key, created_at, response_at,
          expires_at, retention_delete_after, updated_at
        ) VALUES (
          ${sql(id)}, ${sql(target.userId)}, ${sql(`email-hash-${id}`)}, 0,
          ${sql(`request-device-${id}`)}, 8, ${sql(`request-public-key-${id}`)},
          ${sql(`access-code-hash-${id}`)}, ${sql(status)},
          ${approved ? 1 : 'NULL'},
          ${approved ? sql(`encrypted-response-${id}`) : 'NULL'},
          ${sql(initialRevision)}, ${approved ? sql(initialRevision) : 'NULL'},
          '2026-08-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z',
          ${sql(initialRevision)}
        );
      `
    })
    .join('\n')
}

function rotationBody(target, label) {
  const next = generation(target, label)
  return {
    oldMasterKeyAuthenticationHash: generation(target, 'old').passwordHash,
    accountUnlockData: {
      masterPasswordUnlockData: {
        kdfType: 0,
        kdfIterations: 600000,
        email: target.email,
        masterKeyAuthenticationHash: next.passwordHash,
        masterKeyEncryptedUserKey: next.userKey,
      },
      emergencyAccessUnlockData: [],
      organizationAccountRecoveryUnlockData: [],
      passkeyUnlockData: [],
      deviceKeyUnlockData: [
        {
          deviceId: target.trustedDeviceId,
          encryptedPublicKey: next.trustedPublicKey,
          encryptedUserKey: next.trustedUserKey,
        },
      ],
    },
    accountKeys: {
      userKeyEncryptedAccountPrivateKey: next.wrappedPrivateKey,
      accountPublicKey: target.publicKey,
      publicKeyEncryptionKeyPair: {
        wrappedPrivateKey: next.wrappedPrivateKey,
        publicKey: target.publicKey,
        signedPublicKey: null,
      },
      signatureKeyPair: null,
      securityState: null,
    },
    accountData: {
      ciphers: [rotationCipherPayload(target, label)],
      folders: [{ id: target.folderId, name: next.folderName }],
      sends: [],
    },
  }
}

function storedCipherPayload(target, label) {
  const next = generation(target, label)
  return {
    type: 1,
    folderId: target.folderId,
    organizationId: null,
    favorite: false,
    reprompt: 0,
    archivedDate: null,
    name: next.cipherName,
    notes: `2.synthetic-hon206-${target.slug}-${label}-notes`,
    key: `2.synthetic-hon206-${target.slug}-${label}-cipher-key`,
    login: {
      username: `2.synthetic-hon206-${target.slug}-${label}-username`,
      password: `2.synthetic-hon206-${target.slug}-${label}-password`,
      totp: null,
      passwordRevisionDate: '2026-07-17T00:00:00.000Z',
      autofillOnPageLoad: true,
      uris: [
        {
          uri: `2.synthetic-hon206-${target.slug}-${label}-uri`,
          match: 2,
          uriChecksum: `2.synthetic-hon206-${target.slug}-${label}-checksum`,
        },
      ],
      fido2Credentials: [
        {
          credentialId: `2.synthetic-hon206-${target.slug}-${label}-credential-id`,
          creationDate: '2026-07-18T00:00:00.000Z',
        },
      ],
    },
    secureNote: null,
    card: null,
    identity: null,
    sshKey: null,
    bankAccount: null,
    driversLicense: null,
    passport: null,
    fields: [
      {
        type: 1,
        name: `2.synthetic-hon206-${target.slug}-${label}-field-name`,
        value: `2.synthetic-hon206-${target.slug}-${label}-field-value`,
        linkedId: null,
      },
    ],
    passwordHistory: [
      {
        lastUsedDate: '2026-07-19T00:00:00.000Z',
        password: `2.synthetic-hon206-${target.slug}-${label}-history-password`,
      },
    ],
  }
}

function rotationCipherPayload(target, label) {
  const next = generation(target, label)
  return {
    id: target.cipherId,
    encryptedFor: target.userId,
    ...storedCipherPayload(target, label),
    attachments: {
      [target.attachmentId]: next.attachmentFileName,
    },
    attachments2: {
      [target.attachmentId]: {
        fileName: next.attachmentFileName,
        key: next.attachmentKey,
        lastKnownRevisionDate: initialRevision,
      },
    },
    lastKnownRevisionDate: initialRevision,
  }
}

async function passwordGrant(baseUrl, target, password, deviceIdentifier) {
  return requestJson(baseUrl, '/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'password',
      username: target.email,
      password,
      scope: 'api offline_access',
      deviceIdentifier,
      deviceName: 'HON-206 Synthetic Lifecycle',
      deviceType: '8',
    }),
  })
}

function refreshGrant(baseUrl, refreshToken) {
  return requestJson(baseUrl, '/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
}

function authorizedJson(baseUrl, path, accessToken, init = {}) {
  return requestJson(baseUrl, path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  })
}

function authorizedBytes(baseUrl, path, accessToken) {
  return requestBytes(baseUrl, path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

function postRotation(baseUrl, accessToken, body, requestId) {
  return requestJson(
    baseUrl,
    '/api/accounts/key-management/rotate-user-account-keys',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Request-Id': `hon206-${requestId}`,
      },
      body: JSON.stringify(body),
    },
  )
}

async function requestJson(baseUrl, path, init) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    ...init,
    signal: globalThis.AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
  }
}

async function requestBytes(baseUrl, path, init) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    ...init,
    signal: globalThis.AbortSignal.timeout(15_000),
  })
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
  }
}

function startWorker({
  persistTo,
  port,
  inspectorPort,
  rotationEnabled,
  globalQuotaEnabled,
}) {
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
      `HONOWARDEN_ALLOWED_EMAILS:${Object.values(scenarios)
        .map((target) => target.email)
        .join(',')}`,
      '--var',
      `HONOWARDEN_TOKEN_SECRET:${tokenSecret}`,
      '--var',
      `HONOWARDEN_USER_KEY_ROTATION_ENABLED:${rotationEnabled}`,
      '--var',
      `HONOWARDEN_GLOBAL_REQUEST_QUOTA:${globalQuotaEnabled}`,
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
  const processGroupId = worker.pid
  if (!processGroupId) {
    return
  }

  signalProcessGroup(worker, processGroupId, 'SIGTERM')
  let stopped = await waitForProcessGroupExit(processGroupId, 5_000)
  if (!stopped) {
    signalProcessGroup(worker, processGroupId, 'SIGKILL')
    stopped = await waitForProcessGroupExit(processGroupId, 2_000)
  }
  worker.stdout.destroy()
  worker.stderr.destroy()
  if (!stopped) {
    throw new Error(`wrangler process group ${processGroupId} did not stop`)
  }
}

function signalProcessGroup(worker, processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      worker.kill(signal)
    }
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      process.kill(-processGroupId, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') {
        return true
      }
      throw error
    }
    await delay(50)
  }
  return false
}

async function putR2Sentinel(persistTo) {
  const evidenceDirectory = await ensureDirectory(join(persistTo, 'evidence'))
  const sourcePath = join(evidenceDirectory, 'r2-sentinel-source.bin')
  await writeFile(sourcePath, r2SentinelBody)
  await runWrangler([
    'r2',
    'object',
    'put',
    `${r2BucketName}/${scenarios.primary.r2ObjectKey}`,
    '--local',
    '--persist-to',
    persistTo,
    '--file',
    sourcePath,
    '--force',
  ])
}

async function readR2Sentinel(persistTo, label) {
  const outputPath = join(persistTo, 'evidence', `r2-sentinel-${label}.bin`)
  await runWrangler([
    'r2',
    'object',
    'get',
    `${r2BucketName}/${scenarios.primary.r2ObjectKey}`,
    '--local',
    '--persist-to',
    persistTo,
    '--file',
    outputPath,
  ])
  return readFile(outputPath)
}

async function readDatabaseState(persistTo) {
  const primary = scenarios.primary
  const primaryNext = generation(primary, 'next')
  const rollback = scenarios.rollback
  const rollbackOld = generation(rollback, 'old')
  const concurrent = scenarios.concurrent
  const query = `
    SELECT
      master_password_hash as masterPasswordHash,
      user_key as userKey,
      public_key as publicKey,
      private_key as privateKey,
      security_stamp as securityStamp,
      revision_date as revisionDate
    FROM users WHERE id = ${sql(primary.userId)};
    SELECT encrypted_name as encryptedName, revision_date as revisionDate
    FROM folders WHERE id = ${sql(primary.folderId)};
    SELECT encrypted_json as encryptedJson, revision_date as revisionDate
    FROM ciphers WHERE id = ${sql(primary.cipherId)};
    SELECT
      object_key as objectKey,
      file_name as fileName,
      attachment_key as attachmentKey,
      size,
      content_type as contentType,
      revision_date as revisionDate
    FROM cipher_attachments WHERE id = ${sql(primary.attachmentId)};
    SELECT
      SUM(CASE WHEN identifier = ${sql(primary.oldDeviceIdentifier)} AND revoked_at IS NOT NULL THEN 1 ELSE 0 END) as oldDeviceRevoked,
      SUM(CASE WHEN identifier = ${sql(primary.newDeviceIdentifier)} AND revoked_at IS NULL THEN 1 ELSE 0 END) as newDeviceActive,
      SUM(CASE WHEN id = ${sql(primary.trustedDeviceId)} AND revoked_at IS NOT NULL AND encrypted_user_key = ${sql(primaryNext.trustedUserKey)} AND encrypted_public_key = ${sql(primaryNext.trustedPublicKey)} AND encrypted_private_key = ${sql(`2.synthetic-hon206-${primary.slug}-immutable-device-private-key`)} THEN 1 ELSE 0 END) as trustedDeviceRotated,
      SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as activeDeviceCount
    FROM devices WHERE user_id = ${sql(primary.userId)};
    SELECT
      SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) as revokedRefreshTokenCount,
      SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as activeRefreshTokenCount
    FROM refresh_tokens WHERE user_id = ${sql(primary.userId)};
    SELECT COUNT(*) as supersededCount
    FROM auth_requests
    WHERE user_id = ${sql(primary.userId)}
      AND status = 'superseded'
      AND request_approved = 0
      AND encrypted_response_key IS NULL;
    SELECT
      SUM(CASE WHEN actor_user_id = ${sql(primary.userId)} THEN 1 ELSE 0 END) as primaryCount,
      SUM(CASE WHEN actor_user_id = ${sql(rollback.userId)} THEN 1 ELSE 0 END) as rollbackCount,
      SUM(CASE WHEN actor_user_id = ${sql(concurrent.userId)} THEN 1 ELSE 0 END) as concurrentCount,
      SUM(CASE WHEN context_json LIKE '%synthetic-hon206-%' OR context_json LIKE '%attachments/hon206-%' THEN 1 ELSE 0 END) as secretContextCount
    FROM audit_events WHERE name = 'account.keys.rotate';
    SELECT
      (SELECT COUNT(*) FROM users WHERE id = ${sql(rollback.userId)} AND master_password_hash = ${sql(rollbackOld.passwordHash)} AND user_key = ${sql(rollbackOld.userKey)} AND public_key = ${sql(rollback.publicKey)} AND private_key = ${sql(rollbackOld.wrappedPrivateKey)} AND security_stamp = ${sql(`${rollback.slug}-old-security-stamp`)} AND revision_date = ${sql(initialRevision)}) as accountUnchanged,
      (SELECT COUNT(*) FROM folders WHERE id = ${sql(rollback.folderId)} AND encrypted_name = ${sql(rollbackOld.folderName)} AND revision_date = ${sql(initialRevision)}) as folderUnchanged,
      (SELECT COUNT(*) FROM ciphers WHERE id = ${sql(rollback.cipherId)} AND encrypted_json = ${sql(JSON.stringify(storedCipherPayload(rollback, 'old')))} AND revision_date = ${sql(initialRevision)}) as cipherUnchanged,
      (SELECT COUNT(*) FROM cipher_attachments WHERE id = ${sql(rollback.attachmentId)} AND object_key = ${sql(rollback.r2ObjectKey)} AND file_name = ${sql(rollbackOld.attachmentFileName)} AND attachment_key = ${sql(rollbackOld.attachmentKey)} AND revision_date = ${sql(initialRevision)}) as attachmentUnchanged,
      (SELECT COUNT(*) FROM devices WHERE user_id = ${sql(rollback.userId)} AND revoked_at IS NULL) as activeDeviceCount,
      (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ${sql(rollback.userId)} AND revoked_at IS NULL) as activeRefreshTokenCount;
    SELECT
      user_key as userKey,
      master_password_hash as masterPasswordHash,
      private_key as privateKey,
      (SELECT encrypted_name FROM folders WHERE id = ${sql(concurrent.folderId)}) as folderName,
      (SELECT encrypted_json FROM ciphers WHERE id = ${sql(concurrent.cipherId)}) as encryptedJson,
      (SELECT file_name FROM cipher_attachments WHERE id = ${sql(concurrent.attachmentId)}) as attachmentFileName,
      (SELECT attachment_key FROM cipher_attachments WHERE id = ${sql(concurrent.attachmentId)}) as attachmentKey,
      (SELECT encrypted_user_key FROM devices WHERE id = ${sql(concurrent.trustedDeviceId)}) as trustedUserKey,
      (SELECT encrypted_public_key FROM devices WHERE id = ${sql(concurrent.trustedDeviceId)}) as trustedPublicKey
    FROM users WHERE id = ${sql(concurrent.userId)};
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
  const [
    primaryAccount,
    primaryFolder,
    primaryCipher,
    primaryAttachment,
    primaryDevices,
    primaryRefreshTokens,
    primaryAuthRequests,
    audits,
    rollbackState,
    concurrentState,
  ] = rows
  const primaryGenerationCommitted =
    primaryAccount.masterPasswordHash === primaryNext.passwordHash &&
    primaryAccount.userKey === primaryNext.userKey &&
    primaryAccount.publicKey === primary.publicKey &&
    primaryAccount.privateKey === primaryNext.wrappedPrivateKey &&
    primaryAccount.securityStamp !== `${primary.slug}-old-security-stamp` &&
    primaryAccount.revisionDate !== initialRevision
  const primaryVaultGenerationCommitted =
    primaryFolder.encryptedName === primaryNext.folderName &&
    primaryFolder.revisionDate === primaryAccount.revisionDate &&
    primaryCipher.encryptedJson ===
      JSON.stringify(rotationCipherPayload(primary, 'next')) &&
    primaryCipher.revisionDate === primaryAccount.revisionDate &&
    primaryAttachment.fileName === primaryNext.attachmentFileName &&
    primaryAttachment.attachmentKey === primaryNext.attachmentKey &&
    primaryAttachment.revisionDate === primaryAccount.revisionDate
  const primaryAttachmentIdentityPreserved =
    primaryAttachment.objectKey === primary.r2ObjectKey &&
    primaryAttachment.size === r2SentinelBody.byteLength &&
    primaryAttachment.contentType === 'application/octet-stream'
  const concurrentWinner = ['first', 'second'].find((label) => {
    const candidate = generation(concurrent, label)
    return concurrentState.userKey === candidate.userKey
  })
  const concurrentGenerationCoherent = Boolean(
    concurrentWinner &&
    concurrentState.masterPasswordHash ===
      generation(concurrent, concurrentWinner).passwordHash &&
    concurrentState.privateKey ===
      generation(concurrent, concurrentWinner).wrappedPrivateKey &&
    concurrentState.folderName ===
      generation(concurrent, concurrentWinner).folderName &&
    concurrentState.encryptedJson ===
      JSON.stringify(rotationCipherPayload(concurrent, concurrentWinner)) &&
    concurrentState.attachmentFileName ===
      generation(concurrent, concurrentWinner).attachmentFileName &&
    concurrentState.attachmentKey ===
      generation(concurrent, concurrentWinner).attachmentKey &&
    concurrentState.trustedUserKey ===
      generation(concurrent, concurrentWinner).trustedUserKey &&
    concurrentState.trustedPublicKey ===
      generation(concurrent, concurrentWinner).trustedPublicKey,
  )

  return {
    primaryGenerationCommitted,
    primaryVaultGenerationCommitted,
    primaryAttachmentIdentityPreserved,
    primaryTrustedDeviceRotated: primaryDevices.trustedDeviceRotated === 1,
    primaryOldSessionsRevoked:
      primaryDevices.oldDeviceRevoked === 1 &&
      Number(primaryRefreshTokens.revokedRefreshTokenCount) >= 1,
    activePrimaryDeviceCount: Number(primaryDevices.activeDeviceCount ?? 0),
    activePrimaryRefreshTokenCount: Number(
      primaryRefreshTokens.activeRefreshTokenCount ?? 0,
    ),
    primarySupersededAuthRequestCount: Number(
      primaryAuthRequests.supersededCount ?? 0,
    ),
    primaryRotationAuditCount: Number(audits.primaryCount ?? 0),
    rollbackRotationAuditCount: Number(audits.rollbackCount ?? 0),
    concurrentRotationAuditCount: Number(audits.concurrentCount ?? 0),
    auditsRedacted: Number(audits.secretContextCount ?? 0) === 0,
    rollbackGenerationUnchanged: rollbackState.accountUnchanged === 1,
    rollbackVaultUnchanged:
      rollbackState.folderUnchanged === 1 &&
      rollbackState.cipherUnchanged === 1 &&
      rollbackState.attachmentUnchanged === 1,
    rollbackSessionPreserved:
      Number(rollbackState.activeDeviceCount ?? 0) === 2 &&
      Number(rollbackState.activeRefreshTokenCount ?? 0) === 1,
    concurrentGenerationCoherent,
  }
}

function assertTokenProjection(body, target, expected, name) {
  assert(body.Key === expected.userKey, `${name} user key is inconsistent`)
  assert(
    body.PrivateKey === expected.wrappedPrivateKey,
    `${name} private key is inconsistent`,
  )
  assert(
    body.AccountKeys?.publicKeyEncryptionKeyPair?.publicKey ===
      target.publicKey &&
      body.AccountKeys?.publicKeyEncryptionKeyPair?.wrappedPrivateKey ===
        expected.wrappedPrivateKey,
    `${name} account-key projection is inconsistent`,
  )
}

function assertProfileProjection(body, target, expected, name) {
  assert(body.key === expected.userKey, `${name} user key is inconsistent`)
  assert(
    body.privateKey === expected.wrappedPrivateKey,
    `${name} private key is inconsistent`,
  )
  assert(
    body.accountKeys?.publicKeyEncryptionKeyPair?.publicKey ===
      target.publicKey &&
      body.accountKeys?.publicKeyEncryptionKeyPair?.wrappedPrivateKey ===
        expected.wrappedPrivateKey,
    `${name} account-key projection is inconsistent`,
  )
}

function assertCompleteVaultProjection(body, target, label, name) {
  const next = generation(target, label)
  assertProfileProjection(body.profile, target, next, `${name} profile`)
  const folder = body.folders?.find(
    (candidate) => candidate.id === target.folderId,
  )
  const cipher = body.ciphers?.find(
    (candidate) => candidate.id === target.cipherId,
  )
  const attachment = cipher?.attachments?.find(
    (candidate) => candidate.id === target.attachmentId,
  )
  assert(folder?.name === next.folderName, `${name} folder is inconsistent`)
  assert(cipher?.name === next.cipherName, `${name} cipher is inconsistent`)
  assert(
    attachment?.fileName === next.attachmentFileName &&
      attachment?.key === next.attachmentKey,
    `${name} attachment metadata is inconsistent`,
  )
}

function assertBackupProjection(body, target, label) {
  const next = generation(target, label)
  assert(
    body.account?.key === next.userKey &&
      body.account?.publicKey === target.publicKey &&
      body.account?.privateKey === next.wrappedPrivateKey,
    'backup account generation is inconsistent',
  )
  const folder = body.folders?.find(
    (candidate) => candidate.id === target.folderId,
  )
  const cipher = body.ciphers?.find(
    (candidate) => candidate.id === target.cipherId,
  )
  const attachment = body.attachments?.find(
    (candidate) => candidate.id === target.attachmentId,
  )
  assert(folder?.name === next.folderName, 'backup folder is inconsistent')
  assert(cipher?.name === next.cipherName, 'backup cipher is inconsistent')
  assert(
    attachment?.fileName === next.attachmentFileName &&
      attachment?.key === next.attachmentKey,
    'backup attachment metadata is inconsistent',
  )
}

function attachmentPath(target) {
  return `/api/ciphers/${target.cipherId}/attachment/${target.attachmentId}`
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
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
