import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import { fingerprintCredentialWrapper } from '../../src/domain/account-credentials'
import { purgeRecoverableAccount } from '../../src/account-lifecycle-purge'
import app from '../../src/app'
import { signAccessToken } from '../../src/domain/tokens'
import {
  beginRecoverableAccountDeletion,
  changeAccountEmail,
  finalizeAccountPurge,
  markAccountPurgeReady,
  planAccountDeletion,
  recordAccountPurgeProgress,
  recoverAccountDeletion,
  startAccountPurge,
} from '../../src/repositories/account-lifecycle-repository'

const instances: Miniflare[] = []
const userId = '11111111-1111-4111-8111-111111111111'
const oldRevision = '2026-08-08T00:00:00.000Z'
const nextRevision = '2026-08-08T00:00:01.000Z'

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('account lifecycle on real local D1', () => {
  it('runs the pinned email-token, email-change, and verification routes without exposing raw tokens', async () => {
    const database = await createDatabase()
    await seedUser(database)
    const deliveries: Array<Record<string, unknown>> = []
    const mailer = {
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        deliveries.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        )
        return new Response(null, { status: 202 })
      },
    } as unknown as Fetcher
    const tokenSecret = 'account-lifecycle-test-secret-32-bytes-minimum'
    const accessToken = await signAccessToken('test-token-secret', {
      sub: userId,
      email: 'old@example.test',
      device: 'fixture-device',
      securityStamp: 'old-security-stamp',
      iat: 1,
      exp: 4_102_444_800,
      authMethod: 'password',
    })
    const env = {
      DB: database,
      ACCOUNT_LIFECYCLE_MAILER: mailer,
      HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED: 'true',
      HONOWARDEN_ACCOUNT_LIFECYCLE_TOKEN_SECRET: tokenSecret,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const tokenResponse = await app.request(
      '/api/accounts/email-token',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.10',
        },
        body: JSON.stringify({
          NewEmail: 'Next@Example.Test',
          MasterPasswordHash: 'old-hash',
        }),
      },
      env,
    )
    expect(tokenResponse.status).toBe(200)
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      disposition: 'deliver',
      purpose: 'email_change',
      recipientEmail: 'Next@Example.Test',
      userId,
    })
    const rawEmailToken = String(deliveries[0]?.token)
    expect(rawEmailToken).toHaveLength(43)
    const persistedToken = await database
      .prepare(
        `SELECT token_digest as tokenDigest, delivery_state as deliveryState
        FROM account_lifecycle_tokens WHERE purpose = 'email_change'`,
      )
      .first<Record<string, unknown>>()
    expect(persistedToken).toMatchObject({
      tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      deliveryState: 'accepted',
    })
    expect(JSON.stringify(persistedToken)).not.toContain(rawEmailToken)

    const changeResponse = await app.request(
      '/api/accounts/email',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.10',
        },
        body: JSON.stringify({
          newEmail: 'Next@Example.Test',
          masterPasswordHash: 'old-hash',
          newMasterPasswordHash: 'next-hash',
          token: rawEmailToken,
          key: '2.next-user-key',
        }),
      },
      env,
    )
    expect(changeResponse.status).toBe(200)
    const changed = await database
      .prepare(
        `SELECT email_normalized as emailNormalized,
          master_password_hash as masterPasswordHash,
          user_key as userKey, security_stamp as securityStamp
        FROM users WHERE id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>()
    expect(changed).toMatchObject({
      emailNormalized: 'next@example.test',
      masterPasswordHash: 'next-hash',
      userKey: '2.next-user-key',
      securityStamp: expect.not.stringMatching(/^old-security-stamp$/),
    })

    await database
      .prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?')
      .bind(userId)
      .run()
    const nextAccessToken = await signAccessToken('test-token-secret', {
      sub: userId,
      email: 'next@example.test',
      device: 'fixture-device',
      securityStamp: String(changed?.securityStamp),
      iat: 1,
      exp: 4_102_444_800,
      authMethod: 'password',
    })
    const sendVerification = await app.request(
      '/api/accounts/verify-email',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${nextAccessToken}` },
      },
      env,
    )
    expect(sendVerification.status).toBe(200)
    const verificationDelivery = deliveries[1]
    expect(verificationDelivery).toMatchObject({
      purpose: 'email_verify',
      recipientEmail: 'Next@Example.Test',
    })
    const verifyResponse = await app.request(
      '/api/accounts/verify-email-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          UserId: userId,
          Token: verificationDelivery?.token,
        }),
      },
      env,
    )
    expect(verifyResponse.status).toBe(200)
    await expect(
      database
        .prepare('SELECT email_verified_at FROM users WHERE id = ?')
        .bind(userId)
        .first<{ email_verified_at: string | null }>(),
    ).resolves.toEqual({ email_verified_at: expect.any(String) })
  })

  it('equalizes anonymous deletion requests and enters recoverable state only with the delivered token', async () => {
    const database = await createDatabase()
    await seedUser(database)
    const deliveries: Array<Record<string, unknown>> = []
    const env = {
      DB: database,
      ACCOUNT_LIFECYCLE_MAILER: {
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          deliveries.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          )
          return new Response(null, { status: 202 })
        },
      } as unknown as Fetcher,
      HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED: 'true',
      HONOWARDEN_ACCOUNT_LIFECYCLE_TOKEN_SECRET:
        'account-lifecycle-test-secret-32-bytes-minimum',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const unknown = await app.request(
      '/api/accounts/delete-recover',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Email: 'unknown@example.test' }),
      },
      env,
    )
    const known = await app.request(
      '/api/accounts/delete-recover',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Email: 'old@example.test' }),
      },
      env,
    )
    expect(unknown.status).toBe(200)
    expect(known.status).toBe(200)
    await expect(unknown.text()).resolves.toBe('')
    await expect(known.text()).resolves.toBe('')
    expect(deliveries).toHaveLength(2)
    expect(deliveries[0]).toMatchObject({
      disposition: 'suppress',
      purpose: 'account_delete',
    })
    expect(deliveries[1]).toMatchObject({
      disposition: 'deliver',
      purpose: 'account_delete',
      userId,
    })

    const confirmation = await app.request(
      '/api/accounts/delete-recover-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          UserId: userId,
          Token: deliveries[1]?.token,
        }),
      },
      env,
    )
    expect(confirmation.status).toBe(200)
    const state = await database
      .prepare(
        `SELECT u.disabled_at as disabledAt, d.state, d.recover_until as recoverUntil
        FROM users u JOIN account_deletions d ON d.user_id = u.id
        WHERE u.id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>()
    expect(state).toMatchObject({
      disabledAt: expect.any(String),
      state: 'recoverable',
      recoverUntil: expect.any(String),
    })
  })

  it('commits email identity, wrapper history, token, membership, sessions, and audit together', async () => {
    const database = await createDatabase()
    await seedUser(database)
    const currentWrapperSha256 =
      await fingerprintCredentialWrapper('2.old-user-key')
    await database.batch([
      database
        .prepare(
          `INSERT INTO user_key_rotation_wrapper_history (
            user_id, wrapper_kind, wrapper_sha256, recorded_at
          ) VALUES (?, 'user_key', ?, ?)`,
        )
        .bind(userId, currentWrapperSha256, oldRevision),
      database
        .prepare(
          `INSERT INTO account_lifecycle_tokens (
            id, user_id, purpose, token_digest, target_email_normalized,
            credential_generation, delivery_state, expires_at, created_at,
            updated_at
          ) VALUES (?, ?, 'email_change', ?, ?, ?, 'accepted', ?, ?, ?)`,
        )
        .bind(
          'email-token',
          userId,
          'd'.repeat(64),
          'next@example.test',
          'old-security-stamp',
          '2026-08-08T00:15:00.000Z',
          oldRevision,
          oldRevision,
        ),
      database
        .prepare(
          `INSERT INTO devices (
            id, user_id, identifier, revoked_at, created_at, updated_at
          ) VALUES ('device-1', ?, 'fixture-device', NULL, ?, ?)`,
        )
        .bind(userId, oldRevision, oldRevision),
      database
        .prepare(
          `INSERT INTO refresh_tokens (
            id, user_id, device_id, token_hash, expires_at, revoked_at,
            created_at
          ) VALUES ('refresh-1', ?, 'device-1', 'hash-1', ?, NULL, ?)`,
        )
        .bind(userId, '2026-09-08T00:00:00.000Z', oldRevision),
      database
        .prepare(
          `INSERT INTO auth_requests (
            id, user_id, status, request_approved, encrypted_response_key,
            updated_at
          ) VALUES ('auth-1', ?, 'approved', 1, 'opaque', ?)`,
        )
        .bind(userId, oldRevision),
      database.prepare(
        `INSERT INTO organizations (id, name) VALUES ('org-1', 'Org')`,
      ),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, status, type, updated_at
          ) VALUES ('membership-1', 'org-1', ?, 'old@example.test', 2, 2, ?)`,
        )
        .bind(userId, oldRevision),
    ])

    const result = await changeAccountEmail(database, {
      userId,
      expectedEmailNormalized: 'old@example.test',
      expectedMasterPasswordHash: 'old-hash',
      expectedUserKey: '2.old-user-key',
      expectedSecurityStamp: 'old-security-stamp',
      expectedRevisionDate: oldRevision,
      tokenDigest: 'd'.repeat(64),
      tokenCredentialGeneration: 'old-security-stamp',
      nextEmail: 'Next@Example.Test',
      nextEmailNormalized: 'next@example.test',
      nextMasterPasswordHash: 'next-hash',
      nextUserKey: '2.next-user-key',
      nextSecurityStamp: 'next-security-stamp',
      nextRevisionDate: nextRevision,
      auditEventId: 'email-audit',
      auditEvent: buildAuditEvent({
        name: 'account.email.change',
        outcome: 'success',
        requestId: 'email-request',
        occurredAt: nextRevision,
        actor: { userId, deviceIdentifier: 'fixture-device' },
        target: { type: 'account', id: userId },
      }),
    })

    expect(result).toMatchObject({
      status: 'changed',
      revokedDeviceCount: 1,
      revokedRefreshTokenCount: 1,
      invalidatedAuthRequestCount: 1,
      updatedOrganizationMembershipCount: 1,
    })
    const state = await readLifecycleState(database)
    expect(state.user).toMatchObject({
      email: 'Next@Example.Test',
      emailNormalized: 'next@example.test',
      emailVerifiedAt: nextRevision,
      masterPasswordHash: 'next-hash',
      userKey: '2.next-user-key',
      securityStamp: 'next-security-stamp',
    })
    expect(state.token).toMatchObject({ consumedAt: nextRevision })
    expect(state.membership).toMatchObject({ email: 'Next@Example.Test' })
    expect(state.device).toMatchObject({ revokedAt: nextRevision })
    expect(state.refreshToken).toMatchObject({ revokedAt: nextRevision })
    expect(state.authRequest).toMatchObject({
      status: 'superseded',
      requestApproved: 0,
      encryptedResponseKey: null,
    })
    expect(state.audit).toEqual({ name: 'account.email.change' })
    expect(state.wrapperHistory).toHaveLength(2)
  })

  it('rejects an email change that case-insensitively collides with an organization membership', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await database.batch([
      database
        .prepare(
          `INSERT INTO account_lifecycle_tokens (
            id, user_id, purpose, token_digest, target_email_normalized,
            credential_generation, delivery_state, expires_at, created_at,
            updated_at
          ) VALUES (?, ?, 'email_change', ?, ?, ?, 'accepted', ?, ?, ?)`,
        )
        .bind(
          'collision-token',
          userId,
          'e'.repeat(64),
          'next@example.test',
          'old-security-stamp',
          '2026-08-08T00:15:00.000Z',
          oldRevision,
          oldRevision,
        ),
      database.prepare(
        `INSERT INTO organizations (id, name) VALUES ('org-1', 'Org')`,
      ),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, status, type, updated_at
          ) VALUES ('membership-1', 'org-1', ?, 'old@example.test', 2, 2, ?)`,
        )
        .bind(userId, oldRevision),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, status, type, updated_at
          ) VALUES (
            'invitation-1', 'org-1', NULL, 'Next@Example.Test', 0, 2, ?
          )`,
        )
        .bind(oldRevision),
    ])

    await expect(
      changeAccountEmail(database, {
        userId,
        expectedEmailNormalized: 'old@example.test',
        expectedMasterPasswordHash: 'old-hash',
        expectedUserKey: '2.old-user-key',
        expectedSecurityStamp: 'old-security-stamp',
        expectedRevisionDate: oldRevision,
        tokenDigest: 'e'.repeat(64),
        tokenCredentialGeneration: 'old-security-stamp',
        nextEmail: 'next@example.test',
        nextEmailNormalized: 'next@example.test',
        nextMasterPasswordHash: 'next-hash',
        nextUserKey: '2.next-user-key',
        nextSecurityStamp: 'next-security-stamp',
        nextRevisionDate: nextRevision,
        auditEventId: 'collision-audit',
        auditEvent: buildAuditEvent({
          name: 'account.email.change',
          outcome: 'success',
          requestId: 'collision-request',
          occurredAt: nextRevision,
        }),
      }),
    ).resolves.toEqual({ status: 'conflict' })
    await expect(
      database
        .prepare(
          `SELECT email_normalized as emailNormalized FROM users WHERE id = ?`,
        )
        .bind(userId)
        .first<Record<string, unknown>>(),
    ).resolves.toEqual({ emailNormalized: 'old@example.test' })
  })

  it('enters recoverable deletion while preserving personal and organization ciphertext', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await database.batch([
      database
        .prepare(
          `INSERT INTO ciphers (
            id, user_id, organization_id, encrypted_json
          ) VALUES ('personal-cipher', ?, NULL, 'personal-encrypted')`,
        )
        .bind(userId),
      database.prepare(
        `INSERT INTO organizations (id, name) VALUES ('org-1', 'Org')`,
      ),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, status, type, updated_at
          ) VALUES ('owner-1', 'org-1', ?, 'old@example.test', 2, 0, ?)`,
        )
        .bind(userId, oldRevision),
      database
        .prepare(
          `INSERT INTO users (
            id, email, email_normalized, email_verified_at, kdf_algorithm,
            kdf_iterations, master_password_hash, user_key, security_stamp,
            revision_date, created_at, updated_at
          ) VALUES (
            'other-owner', 'other@example.test', 'other@example.test', ?,
            'pbkdf2-sha256', 600000, 'other-hash', '2.other-key',
            'other-stamp', ?, ?, ?
          )`,
        )
        .bind(oldRevision, oldRevision, oldRevision, oldRevision),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, status, type, updated_at
          ) VALUES (
            'owner-2', 'org-1', 'other-owner', 'other@example.test', 2, 0, ?
          )`,
        )
        .bind(oldRevision),
      database
        .prepare(
          `INSERT INTO ciphers (
            id, user_id, organization_id, encrypted_json
          ) VALUES ('org-cipher', ?, 'org-1', 'organization-encrypted')`,
        )
        .bind(userId),
    ])

    const result = await beginRecoverableAccountDeletion(database, {
      userId,
      expectedMasterPasswordHash: 'old-hash',
      expectedSecurityStamp: 'old-security-stamp',
      expectedRevisionDate: oldRevision,
      tokenDigest: null,
      lifecycleGeneration: 'deletion-generation',
      nextSecurityStamp: 'disabled-security-stamp',
      now: nextRevision,
      recoverUntil: '2026-09-07T00:00:01.000Z',
      auditEventId: 'delete-audit',
      auditEvent: buildAuditEvent({
        name: 'account.deletion.request',
        outcome: 'success',
        requestId: 'delete-request',
        occurredAt: nextRevision,
        actor: { userId },
        target: { type: 'account', id: userId },
      }),
    })

    expect(result).toMatchObject({
      status: 'recoverable',
      lifecycleGeneration: 'deletion-generation',
    })
    const user = await database
      .prepare('SELECT disabled_at as disabledAt FROM users WHERE id = ?')
      .bind(userId)
      .first<Record<string, unknown>>()
    const deletion = await database
      .prepare(
        `SELECT state, lifecycle_generation as lifecycleGeneration
        FROM account_deletions WHERE user_id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>()
    const ciphers = await database
      .prepare(
        'SELECT id, encrypted_json as encryptedJson FROM ciphers ORDER BY id',
      )
      .all<Record<string, unknown>>()
    expect(user).toEqual({ disabledAt: nextRevision })
    expect(deletion).toEqual({
      state: 'recoverable',
      lifecycleGeneration: 'deletion-generation',
    })
    expect(ciphers.results).toEqual([
      { id: 'org-cipher', encryptedJson: 'organization-encrypted' },
      { id: 'personal-cipher', encryptedJson: 'personal-encrypted' },
    ])
  })

  it('does not disable the last confirmed organization owner', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await database.batch([
      database.prepare(
        `INSERT INTO organizations (id, name) VALUES ('org-1', 'Org')`,
      ),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, status, type, updated_at
          ) VALUES ('owner-1', 'org-1', ?, 'old@example.test', 2, 0, ?)`,
        )
        .bind(userId, oldRevision),
    ])

    const result = await beginRecoverableAccountDeletion(database, {
      userId,
      expectedMasterPasswordHash: 'old-hash',
      expectedSecurityStamp: 'old-security-stamp',
      expectedRevisionDate: oldRevision,
      tokenDigest: null,
      lifecycleGeneration: 'blocked-generation',
      nextSecurityStamp: 'disabled-security-stamp',
      now: nextRevision,
      recoverUntil: '2026-09-07T00:00:01.000Z',
      auditEventId: 'blocked-audit',
      auditEvent: buildAuditEvent({
        name: 'account.deletion.request',
        outcome: 'success',
        requestId: 'blocked-request',
        occurredAt: nextRevision,
      }),
    })

    expect(result).toEqual({ status: 'last_owner' })
    await expect(
      database
        .prepare('SELECT disabled_at FROM users WHERE id = ?')
        .bind(userId)
        .first<{ disabled_at: string | null }>(),
    ).resolves.toEqual({ disabled_at: null })
    await expect(
      database
        .prepare('SELECT COUNT(*) as count FROM account_deletions')
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 })
  })

  it('fails every purge gate when ownership changes during the recovery window', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await seedRecoverableDeletion(database, {
      generation: 'ownership-drift-generation',
      recoverUntil: '2026-08-09T00:00:00.000Z',
    })
    await database.batch([
      database.prepare(
        `INSERT INTO organizations (id, name) VALUES ('org-1', 'Org')`,
      ),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, status, type, updated_at
          ) VALUES ('owner-1', 'org-1', ?, 'old@example.test', 2, 0, ?)`,
        )
        .bind(userId, oldRevision),
    ])

    await expect(
      planAccountDeletion(database, {
        userId,
        lifecycleGeneration: 'ownership-drift-generation',
        now: '2026-08-10T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ purgeAllowed: false })
    await expect(
      markAccountPurgeReady(database, {
        userId,
        lifecycleGeneration: 'ownership-drift-generation',
        now: '2026-08-10T00:00:00.000Z',
        expectedPersonalAttachmentCount: 0,
      }),
    ).resolves.toEqual({ status: 'conflict' })

    await database
      .prepare(
        `UPDATE account_deletions
        SET state = 'purge_ready', personal_r2_expected_count = 0
        WHERE user_id = ?`,
      )
      .bind(userId)
      .run()
    await expect(
      startAccountPurge(database, {
        userId,
        lifecycleGeneration: 'ownership-drift-generation',
        now: '2026-08-10T00:00:01.000Z',
      }),
    ).resolves.toEqual({ status: 'conflict' })

    await database
      .prepare(
        `UPDATE account_deletions
        SET state = 'purging_r2', personal_r2_deleted_count = 0
        WHERE user_id = ?`,
      )
      .bind(userId)
      .run()
    await expect(
      finalizeAccountPurge(database, {
        userId,
        lifecycleGeneration: 'ownership-drift-generation',
        tombstoneEmail: 'deleted+blocked@invalid',
        tombstoneMasterPasswordHash: 'blocked-tombstone-hash',
        nextSecurityStamp: 'blocked-tombstone-stamp',
        now: '2026-08-10T00:00:02.000Z',
        auditEventId: 'blocked-purge-audit',
        auditEvent: buildAuditEvent({
          name: 'account.deletion.purge',
          outcome: 'success',
          requestId: 'blocked-purge-request',
          occurredAt: '2026-08-10T00:00:02.000Z',
        }),
      }),
    ).resolves.toEqual({ status: 'conflict' })
  })

  it('recovers only the exact recoverable generation before cutoff', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await seedRecoverableDeletion(database, {
      generation: 'recovery-generation',
      recoverUntil: '2026-09-07T00:00:01.000Z',
    })

    await expect(
      planAccountDeletion(database, {
        userId,
        lifecycleGeneration: 'recovery-generation',
        now: '2026-08-09T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'recoverable',
      recoveryAllowed: true,
      purgeAllowed: false,
    })
    await expect(
      recoverAccountDeletion(database, {
        userId,
        lifecycleGeneration: 'recovery-generation',
        expectedDisabledSecurityStamp: 'disabled-security-stamp',
        now: '2026-08-09T00:00:00.000Z',
        nextSecurityStamp: 'recovered-security-stamp',
        auditEventId: 'recovery-audit',
        auditEvent: buildAuditEvent({
          name: 'account.deletion.recover',
          outcome: 'success',
          requestId: 'recovery-request',
          occurredAt: '2026-08-09T00:00:00.000Z',
          target: { type: 'account', id: userId },
        }),
      }),
    ).resolves.toEqual({ status: 'recovered' })

    const state = await database
      .prepare(
        `SELECT u.disabled_at as disabledAt, u.security_stamp as securityStamp,
          d.state FROM users u JOIN account_deletions d ON d.user_id = u.id
        WHERE u.id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>()
    expect(state).toEqual({
      disabledAt: null,
      securityStamp: 'recovered-security-stamp',
      state: 'recovered',
    })
  })

  it('purges only personal data after cutoff and leaves an opaque organization-safe tombstone', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await seedRecoverableDeletion(database, {
      generation: 'purge-generation',
      recoverUntil: '2026-08-09T00:00:00.000Z',
    })
    await database.batch([
      database
        .prepare(
          `UPDATE users SET equivalent_domains = ?,
            excluded_global_equivalent_domains = ? WHERE id = ?`,
        )
        .bind(
          JSON.stringify([['internal.example', 'private.example']]),
          JSON.stringify([1, 2]),
          userId,
        ),
      database
        .prepare(
          `INSERT INTO totp_challenges (
            id, user_id, challenge_hash, device_identifier, expires_at
          ) VALUES ('challenge-1', ?, 'challenge-hash', 'device-private', ?)`,
        )
        .bind(userId, '2026-08-11T00:00:00.000Z'),
      database.prepare(
        `INSERT INTO organizations (id, name) VALUES ('org-1', 'Org')`,
      ),
      database
        .prepare(
          `INSERT INTO organization_users (
            id, organization_id, user_id, email, org_key, status, type,
            permissions, updated_at
          ) VALUES (
            'member-1', 'org-1', ?, 'old@example.test', 'wrapped-org-key',
            2, 2, 'sensitive-permissions', ?
          )`,
        )
        .bind(userId, oldRevision),
      database
        .prepare(
          `INSERT INTO folders (id, user_id, encrypted_name)
          VALUES ('personal-folder', ?, 'encrypted-folder')`,
        )
        .bind(userId),
      database
        .prepare(
          `INSERT INTO ciphers (
            id, user_id, folder_id, organization_id, encrypted_json
          ) VALUES (
            'personal-cipher', ?, 'personal-folder', NULL, 'personal-encrypted'
          )`,
        )
        .bind(userId),
      database
        .prepare(
          `INSERT INTO ciphers (
            id, user_id, folder_id, organization_id, encrypted_json
          ) VALUES (
            'org-cipher', ?, 'personal-folder', 'org-1', 'organization-encrypted'
          )`,
        )
        .bind(userId),
      database
        .prepare(
          `INSERT INTO cipher_attachments (
            id, user_id, cipher_id, object_key
          ) VALUES ('personal-attachment', ?, 'personal-cipher', 'r2/personal')`,
        )
        .bind(userId),
      database
        .prepare(
          `INSERT INTO cipher_attachments (
            id, user_id, cipher_id, object_key
          ) VALUES ('org-attachment', ?, 'org-cipher', 'r2/organization')`,
        )
        .bind(userId),
    ])

    const plan = await planAccountDeletion(database, {
      userId,
      lifecycleGeneration: 'purge-generation',
      now: '2026-08-10T00:00:00.000Z',
    })
    expect(plan).toMatchObject({
      status: 'recoverable',
      recoveryAllowed: false,
      purgeAllowed: true,
      personalCipherCount: 1,
      organizationCipherCount: 1,
      personalAttachmentCount: 1,
    })
    await expect(
      markAccountPurgeReady(database, {
        userId,
        lifecycleGeneration: 'purge-generation',
        now: '2026-08-10T00:00:00.000Z',
        expectedPersonalAttachmentCount: 1,
      }),
    ).resolves.toEqual({ status: 'purge_ready' })
    const started = await startAccountPurge(database, {
      userId,
      lifecycleGeneration: 'purge-generation',
      now: '2026-08-10T00:00:01.000Z',
    })
    expect(started).toEqual({
      status: 'purging_r2',
      objectKeys: ['r2/personal'],
      deletedCount: 0,
      expectedCount: 1,
    })
    await expect(
      recordAccountPurgeProgress(database, {
        userId,
        lifecycleGeneration: 'purge-generation',
        deletedCount: 1,
        now: '2026-08-10T00:00:02.000Z',
        errorCode: null,
      }),
    ).resolves.toEqual({ status: 'updated' })
    await expect(
      finalizeAccountPurge(database, {
        userId,
        lifecycleGeneration: 'purge-generation',
        tombstoneEmail: 'deleted+opaque@invalid',
        tombstoneMasterPasswordHash: 'opaque-tombstone-hash',
        nextSecurityStamp: 'tombstone-security-stamp',
        now: '2026-08-10T00:00:03.000Z',
        auditEventId: 'purge-audit',
        auditEvent: buildAuditEvent({
          name: 'account.deletion.purge',
          outcome: 'success',
          requestId: 'purge-request',
          occurredAt: '2026-08-10T00:00:03.000Z',
          target: { type: 'account', id: userId },
          context: { personalR2DeletedCount: 1 },
        }),
      }),
    ).resolves.toEqual({ status: 'tombstoned' })

    const tombstone = await database
      .prepare(
        `SELECT email, email_normalized as emailNormalized,
          master_password_hash as masterPasswordHash, user_key as userKey,
          security_stamp as securityStamp,
          equivalent_domains as equivalentDomains,
          excluded_global_equivalent_domains as excludedGlobalEquivalentDomains
        FROM users WHERE id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>()
    const membership = await database
      .prepare(
        `SELECT email, org_key as orgKey, permissions
        FROM organization_users WHERE id = 'member-1'`,
      )
      .first<Record<string, unknown>>()
    const ciphers = await database
      .prepare(
        `SELECT id, folder_id as folderId, encrypted_json as encryptedJson
        FROM ciphers ORDER BY id`,
      )
      .all<Record<string, unknown>>()
    const attachments = await database
      .prepare('SELECT id, object_key as objectKey FROM cipher_attachments')
      .all<Record<string, unknown>>()
    expect(tombstone).toEqual({
      email: 'deleted+opaque@invalid',
      emailNormalized: 'deleted+opaque@invalid',
      masterPasswordHash: 'opaque-tombstone-hash',
      userKey: null,
      securityStamp: 'tombstone-security-stamp',
      equivalentDomains: '[]',
      excludedGlobalEquivalentDomains: '[]',
    })
    expect(membership).toEqual({
      email: 'deleted+opaque@invalid',
      orgKey: null,
      permissions: null,
    })
    expect(ciphers.results).toEqual([
      {
        id: 'org-cipher',
        folderId: null,
        encryptedJson: 'organization-encrypted',
      },
    ])
    expect(attachments.results).toEqual([
      { id: 'org-attachment', objectKey: 'r2/organization' },
    ])
    await expect(
      database
        .prepare(
          'SELECT COUNT(*) as count FROM totp_challenges WHERE user_id = ?',
        )
        .bind(userId)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 })
  })

  it('retains D1 metadata after an R2 failure and safely retries the same object key', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await seedRecoverableDeletion(database, {
      generation: 'retry-generation',
      recoverUntil: '2026-08-09T00:00:00.000Z',
    })
    await database.batch([
      database
        .prepare(
          `INSERT INTO ciphers (
            id, user_id, organization_id, encrypted_json
          ) VALUES ('personal-cipher', ?, NULL, 'personal-encrypted')`,
        )
        .bind(userId),
      database
        .prepare(
          `INSERT INTO cipher_attachments (id, user_id, cipher_id, object_key)
          VALUES ('personal-attachment', ?, 'personal-cipher', 'r2/retry')`,
        )
        .bind(userId),
    ])
    await expect(
      markAccountPurgeReady(database, {
        userId,
        lifecycleGeneration: 'retry-generation',
        now: '2026-08-10T00:00:00.000Z',
        expectedPersonalAttachmentCount: 1,
      }),
    ).resolves.toEqual({ status: 'purge_ready' })
    const deletedKeys: string[][] = []
    let fail = true
    const bucket = {
      delete: async (keys: string[]) => {
        deletedKeys.push(keys)
        if (fail) {
          fail = false
          throw new Error('synthetic R2 failure')
        }
      },
    } as unknown as R2Bucket

    await expect(
      purgeRecoverableAccount(database, bucket, {
        userId,
        lifecycleGeneration: 'retry-generation',
        confirmedLifecycleGeneration: 'retry-generation',
        requestId: 'first-purge-attempt',
        now: '2026-08-10T00:00:01.000Z',
      }),
    ).rejects.toThrow('Account R2 purge failed.')
    await expect(
      database
        .prepare('SELECT object_key as objectKey FROM cipher_attachments')
        .first<Record<string, unknown>>(),
    ).resolves.toEqual({ objectKey: 'r2/retry' })

    await expect(
      purgeRecoverableAccount(database, bucket, {
        userId,
        lifecycleGeneration: 'retry-generation',
        confirmedLifecycleGeneration: 'retry-generation',
        requestId: 'second-purge-attempt',
        now: '2026-08-10T00:00:02.000Z',
      }),
    ).resolves.toEqual({ status: 'tombstoned', deletedObjectCount: 1 })
    expect(deletedKeys).toEqual([['r2/retry'], ['r2/retry']])
  })

  it('rejects stale purge progress instead of moving the durable counter backward', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await seedRecoverableDeletion(database, {
      generation: 'monotonic-generation',
      recoverUntil: '2026-08-09T00:00:00.000Z',
    })
    await database
      .prepare(
        `UPDATE account_deletions SET state = 'purging_r2',
          purge_started_at = ?, personal_r2_expected_count = 2,
          personal_r2_deleted_count = 1 WHERE user_id = ?`,
      )
      .bind('2026-08-10T00:00:00.000Z', userId)
      .run()

    await expect(
      recordAccountPurgeProgress(database, {
        userId,
        lifecycleGeneration: 'monotonic-generation',
        deletedCount: 0,
        now: '2026-08-10T00:00:01.000Z',
        errorCode: null,
      }),
    ).resolves.toEqual({ status: 'unavailable' })
    await expect(
      database
        .prepare(
          `SELECT personal_r2_deleted_count as deletedCount
          FROM account_deletions WHERE user_id = ?`,
        )
        .bind(userId)
        .first<{ deletedCount: number }>(),
    ).resolves.toEqual({ deletedCount: 1 })
  })

  it('bounds each purge invocation to one 1000-object R2 batch', async () => {
    const database = await createDatabase()
    await seedUser(database)
    await seedRecoverableDeletion(database, {
      generation: 'bounded-generation',
      recoverUntil: '2026-08-09T00:00:00.000Z',
    })
    await database
      .prepare(
        `INSERT INTO ciphers (
          id, user_id, organization_id, encrypted_json
        ) VALUES ('bulk-cipher', ?, NULL, 'bulk-encrypted')`,
      )
      .bind(userId)
      .run()
    await database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
          VALUES(0) UNION ALL SELECT value + 1 FROM sequence WHERE value < 1000
        )
        INSERT INTO cipher_attachments (id, user_id, cipher_id, object_key)
        SELECT printf('attachment-%04d', value), ?, 'bulk-cipher',
          printf('r2/bulk/%04d', value)
        FROM sequence`,
      )
      .bind(userId)
      .run()
    await expect(
      markAccountPurgeReady(database, {
        userId,
        lifecycleGeneration: 'bounded-generation',
        now: '2026-08-10T00:00:00.000Z',
        expectedPersonalAttachmentCount: 1_001,
      }),
    ).resolves.toEqual({ status: 'purge_ready' })

    const deletedBatches: string[][] = []
    const bucket = {
      delete: async (keys: string[]) => {
        deletedBatches.push(keys)
      },
    } as unknown as R2Bucket
    await expect(
      purgeRecoverableAccount(database, bucket, {
        userId,
        lifecycleGeneration: 'bounded-generation',
        confirmedLifecycleGeneration: 'bounded-generation',
        requestId: 'bounded-purge-1',
        now: '2026-08-10T00:00:01.000Z',
      }),
    ).resolves.toEqual({
      status: 'purging_r2',
      deletedObjectCount: 1_000,
      remainingObjectCount: 1,
    })
    await expect(
      planAccountDeletion(database, {
        userId,
        lifecycleGeneration: 'bounded-generation',
        now: '2026-08-10T00:00:01.500Z',
      }),
    ).resolves.toMatchObject({
      status: 'purging_r2',
      purgeAllowed: true,
      personalR2DeletedCount: 1_000,
    })
    await expect(
      purgeRecoverableAccount(database, bucket, {
        userId,
        lifecycleGeneration: 'bounded-generation',
        confirmedLifecycleGeneration: 'bounded-generation',
        requestId: 'bounded-purge-2',
        now: '2026-08-10T00:00:02.000Z',
      }),
    ).resolves.toEqual({ status: 'tombstoned', deletedObjectCount: 1_001 })
    expect(deletedBatches.map((batch) => batch.length)).toEqual([1_000, 1])
  })
})

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-21',
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const database = await instance.getD1Database('DB')
  await database.prepare('PRAGMA foreign_keys = ON').run()
  for (const statement of schemaStatements) {
    await database.prepare(statement).run()
  }
  return database
}

async function seedUser(database: D1Database): Promise<void> {
  await database
    .prepare(
      `INSERT INTO users (
        id, email, email_normalized, email_verified_at, kdf_algorithm,
        kdf_iterations, master_password_hash, user_key, security_stamp,
        revision_date, created_at, updated_at
      ) VALUES (?, 'old@example.test', 'old@example.test', ?,
        'pbkdf2-sha256', 600000, 'old-hash', '2.old-user-key',
        'old-security-stamp', ?, ?, ?)`,
    )
    .bind(userId, oldRevision, oldRevision, oldRevision, oldRevision)
    .run()
}

async function seedRecoverableDeletion(
  database: D1Database,
  input: { generation: string; recoverUntil: string },
): Promise<void> {
  await database.batch([
    database
      .prepare(
        `UPDATE users SET disabled_at = ?, security_stamp = ?, revision_date = ?,
          updated_at = ? WHERE id = ?`,
      )
      .bind(
        nextRevision,
        'disabled-security-stamp',
        nextRevision,
        nextRevision,
        userId,
      ),
    database
      .prepare(
        `INSERT INTO account_deletions (
          user_id, lifecycle_generation, state, requested_at, recover_until,
          updated_at
        ) VALUES (?, ?, 'recoverable', ?, ?, ?)`,
      )
      .bind(
        userId,
        input.generation,
        nextRevision,
        input.recoverUntil,
        nextRevision,
      ),
  ])
}

async function readLifecycleState(database: D1Database) {
  const [
    user,
    token,
    membership,
    device,
    refreshToken,
    authRequest,
    audit,
    wrappers,
  ] = await Promise.all([
    database
      .prepare(
        `SELECT email, email_normalized as emailNormalized,
            email_verified_at as emailVerifiedAt,
            master_password_hash as masterPasswordHash, user_key as userKey,
            security_stamp as securityStamp
          FROM users WHERE id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT consumed_at as consumedAt FROM account_lifecycle_tokens
          WHERE id = 'email-token'`,
      )
      .first<Record<string, unknown>>(),
    database
      .prepare(`SELECT email FROM organization_users WHERE id = 'membership-1'`)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT revoked_at as revokedAt FROM devices WHERE id = 'device-1'`,
      )
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT revoked_at as revokedAt FROM refresh_tokens WHERE id = 'refresh-1'`,
      )
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT status, request_approved as requestApproved,
            encrypted_response_key as encryptedResponseKey
          FROM auth_requests WHERE id = 'auth-1'`,
      )
      .first<Record<string, unknown>>(),
    database
      .prepare(`SELECT name FROM audit_events WHERE id = 'email-audit'`)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT wrapper_sha256 FROM user_key_rotation_wrapper_history
          WHERE user_id = ?`,
      )
      .bind(userId)
      .all<Record<string, unknown>>(),
  ])
  return {
    user,
    token,
    membership,
    device,
    refreshToken,
    authRequest,
    audit,
    wrapperHistory: wrappers.results,
  }
}

const schemaStatements = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, email_normalized TEXT NOT NULL UNIQUE,
    email_verified_at TEXT, display_name TEXT, kdf_algorithm TEXT NOT NULL,
    kdf_iterations INTEGER NOT NULL, kdf_memory INTEGER, kdf_parallelism INTEGER,
    master_password_hash TEXT NOT NULL, user_key TEXT, public_key TEXT, private_key TEXT,
    security_stamp TEXT NOT NULL, login_failed_count INTEGER NOT NULL DEFAULT 0,
    login_failed_at TEXT, login_locked_until TEXT,
    revision_date TEXT NOT NULL, disabled_at TEXT, created_at TEXT NOT NULL,
    equivalent_domains TEXT NOT NULL DEFAULT '[]',
    excluded_global_equivalent_domains TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
  `CREATE TABLE organization_users (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT,
    email TEXT NOT NULL, org_key TEXT, status INTEGER NOT NULL, type INTEGER NOT NULL,
    permissions TEXT,
    updated_at TEXT NOT NULL, UNIQUE(organization_id, email),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE devices (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, identifier TEXT NOT NULL,
    revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT,
    created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(device_id) REFERENCES devices(id)
  )`,
  `CREATE TABLE auth_requests (
    id TEXT PRIMARY KEY, user_id TEXT, status TEXT NOT NULL,
    request_approved INTEGER, encrypted_response_key TEXT, updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE user_totp (
    user_id TEXT PRIMARY KEY, encrypted_secret TEXT, enabled INTEGER NOT NULL DEFAULT 0,
    last_accepted_step INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE totp_challenges (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge_hash TEXT NOT NULL,
    device_identifier TEXT NOT NULL, expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE auth_failure_buckets (
    bucket_key TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL, locked_until TEXT, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE audit_events (
    id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, name TEXT NOT NULL,
    outcome TEXT NOT NULL, request_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
    actor_user_id TEXT, actor_device_identifier TEXT, target_type TEXT,
    target_id TEXT, context_json TEXT
  )`,
  `CREATE TABLE user_key_rotation_wrapper_history (
    user_id TEXT NOT NULL, wrapper_kind TEXT NOT NULL, wrapper_sha256 TEXT NOT NULL,
    recorded_at TEXT NOT NULL, PRIMARY KEY(user_id, wrapper_sha256)
  )`,
  `CREATE TABLE account_lifecycle_tokens (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL,
    token_digest TEXT NOT NULL UNIQUE, target_email_normalized TEXT,
    credential_generation TEXT NOT NULL, delivery_state TEXT NOT NULL,
    expires_at TEXT NOT NULL, consumed_at TEXT, superseded_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE UNIQUE INDEX account_lifecycle_active
    ON account_lifecycle_tokens(user_id, purpose)
    WHERE consumed_at IS NULL AND superseded_at IS NULL`,
  `CREATE TABLE account_deletions (
    user_id TEXT PRIMARY KEY, lifecycle_generation TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL, requested_at TEXT NOT NULL, recover_until TEXT NOT NULL,
    purge_started_at TEXT, purge_operation_id TEXT, tombstoned_at TEXT,
    recovered_at TEXT,
    personal_r2_expected_count INTEGER NOT NULL DEFAULT 0,
    personal_r2_deleted_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT, updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE ciphers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, folder_id TEXT, organization_id TEXT,
    encrypted_json TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE folders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, encrypted_name TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE cipher_attachments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, cipher_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE, FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
  )`,
]
