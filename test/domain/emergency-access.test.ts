import { describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import {
  buildEmergencyAccessEmailHash,
  buildEmergencyAccessInviteTokenHash,
  canStartRecovery,
  classifyEmergencyAccessDelivery,
  createRedactingInviteRecorder,
  emergencyAccessInviteExpiresAt,
  emergencyAccessPolicy,
  generateEmergencyAccessInviteToken,
  isEmergencyAccessRuntimeEnabled,
  parseEmergencyAccessAcceptRequest,
  parseEmergencyAccessConfirmRequest,
  parseEmergencyAccessInviteRequest,
  parseEmergencyAccessUpdateRequest,
  projectEmergencyAccessContact,
  verifyEmergencyAccessInviteToken,
} from '../../src/domain/emergency-access'

const inviteSecret = 'emergency-access-invite-secret-32b'
const grantorEmail = 'grantor@example.test'
const recipientEmail = 'grantee@example.test'
const relationshipId = '11111111-1111-4111-8111-111111111111'
const now = '2026-09-04T12:00:00.000Z'

describe('emergency access invitation domain', () => {
  it('keeps the runtime gate default-off', () => {
    expect(isEmergencyAccessRuntimeEnabled(undefined)).toBe(false)
    expect(isEmergencyAccessRuntimeEnabled('false')).toBe(false)
    expect(isEmergencyAccessRuntimeEnabled('yes')).toBe(false)
    expect(isEmergencyAccessRuntimeEnabled(' TRUE ')).toBe(true)
  })

  it('parses invite bodies and rejects self-invite, wait, and type errors', () => {
    expect(
      parseEmergencyAccessInviteRequest(
        { Email: recipientEmail, Type: 1, WaitTimeDays: 7 },
        { grantorEmailNormalized: grantorEmail },
      ),
    ).toEqual({
      ok: true,
      value: {
        emailNormalized: recipientEmail,
        type: 1,
        waitTimeDays: 7,
      },
    })
    expect(
      parseEmergencyAccessInviteRequest(
        { email: '  GRANTOR@example.test ', type: 0, waitTimeDays: 1 },
        { grantorEmailNormalized: grantorEmail },
      ),
    ).toEqual({ ok: false, code: 'invalid_request' })
    expect(
      parseEmergencyAccessInviteRequest(
        { email: recipientEmail, type: 2, waitTimeDays: 7 },
        { grantorEmailNormalized: grantorEmail },
      ),
    ).toEqual({ ok: false, code: 'invalid_request' })
    expect(
      parseEmergencyAccessInviteRequest(
        { email: recipientEmail, type: 0, waitTimeDays: 0 },
        { grantorEmailNormalized: grantorEmail },
      ),
    ).toEqual({ ok: false, code: 'invalid_request' })
    expect(
      parseEmergencyAccessInviteRequest(
        { email: recipientEmail, type: 0, waitTimeDays: 91 },
        { grantorEmailNormalized: grantorEmail },
      ),
    ).toEqual({ ok: false, code: 'invalid_request' })
  })

  it('parses accept, confirm, and update bodies without treating key material as structured', () => {
    expect(
      parseEmergencyAccessAcceptRequest({ Token: 'invite-token' }),
    ).toEqual({
      ok: true,
      value: { token: 'invite-token' },
    })
    expect(parseEmergencyAccessAcceptRequest({ token: '' })).toEqual({
      ok: false,
      code: 'invalid_request',
    })
    expect(
      parseEmergencyAccessConfirmRequest({ key: 'opaque-wrap-ciphertext' }),
    ).toEqual({
      ok: true,
      value: { keyEncrypted: 'opaque-wrap-ciphertext' },
    })
    expect(
      parseEmergencyAccessUpdateRequest({ Type: 0, WaitTimeDays: 14 }),
    ).toEqual({
      ok: true,
      value: { type: 0, waitTimeDays: 14, keyEncrypted: null },
    })
  })

  it('binds invite tokens to relationship id and recipient email and expires them in five days', async () => {
    const token = generateEmergencyAccessInviteToken((bytes) => {
      bytes.fill(9)
      return bytes
    })
    const hash = await buildEmergencyAccessInviteTokenHash({
      secret: inviteSecret,
      relationshipId,
      emailNormalized: recipientEmail,
      token,
    })
    const otherHash = await buildEmergencyAccessInviteTokenHash({
      secret: inviteSecret,
      relationshipId,
      emailNormalized: 'other@example.test',
      token,
    })

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(hash).toMatch(/^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/u)
    expect(otherHash).not.toBe(hash)
    await expect(
      verifyEmergencyAccessInviteToken({
        secret: inviteSecret,
        relationshipId,
        emailNormalized: recipientEmail,
        token,
        storedHash: hash,
      }),
    ).resolves.toBe(true)
    await expect(
      verifyEmergencyAccessInviteToken({
        secret: inviteSecret,
        relationshipId,
        emailNormalized: recipientEmail,
        token: `${token}x`,
        storedHash: hash,
      }),
    ).resolves.toBe(false)
    expect(emergencyAccessInviteExpiresAt(now)).toBe('2026-09-09T12:00:00.000Z')
    expect(emergencyAccessPolicy.inviteLifetimeDays).toBe(5)
  })

  it('keeps invited and accepted contacts outside recovery and vault access', () => {
    expect(canStartRecovery(0)).toBe(false)
    expect(canStartRecovery(1)).toBe(false)
    expect(canStartRecovery(2)).toBe(true)
    expect(canStartRecovery(3)).toBe(false)
    expect(canStartRecovery(4)).toBe(false)
  })

  it('projects grantor/grantee views without invite tokens or wrapped keys', () => {
    const projected = projectEmergencyAccessContact({
      id: relationshipId,
      grantorUserId: 'grantor-id',
      granteeUserId: null,
      emailNormalized: recipientEmail,
      type: 0,
      status: 0,
      waitTimeDays: 7,
      createdAt: now,
      revisionDate: now,
      keyEncrypted: 'must-not-leak',
      inviteTokenHash: 'hmac-sha256:v1:must-not-leak',
    })

    expect(projected).toEqual({
      Id: relationshipId,
      GrantorId: 'grantor-id',
      GranteeId: null,
      Email: recipientEmail,
      Type: 0,
      Status: 0,
      WaitTimeDays: 7,
      CreationDate: now,
      RevisionDate: now,
      Object: 'emergencyAccess',
    })
    expect(JSON.stringify(projected)).not.toContain('must-not-leak')
  })

  it('redacts invite delivery and treats ambiguous provider results as failures', async () => {
    const token = generateEmergencyAccessInviteToken()
    const emailHash = await buildEmergencyAccessEmailHash(
      inviteSecret,
      recipientEmail,
    )
    const recorder = createRedactingInviteRecorder()
    const outcome = await recorder.deliverInvite(
      { relationshipId, recipientEmailHash: emailHash },
      token,
    )

    expect(outcome).toBe('delivered')
    expect(classifyEmergencyAccessDelivery('delivered')).toBe('accepted')
    expect(classifyEmergencyAccessDelivery('failed')).toBe('failed')
    expect(classifyEmergencyAccessDelivery('ambiguous')).toBe('failed')
    expect(JSON.stringify(recorder.attempts)).toEqual(
      JSON.stringify([
        {
          relationshipId,
          recipientEmailHash: emailHash,
          outcome: 'delivered',
        },
      ]),
    )
    expect(JSON.stringify(recorder.attempts)).not.toContain(token)
    expect(JSON.stringify(recorder.attempts)).not.toContain(recipientEmail)
  })

  it('strips recovery secrets from emergency-access audit context', () => {
    const event = buildAuditEvent({
      name: 'emergency.invite',
      outcome: 'success',
      requestId: 'request-id',
      occurredAt: now,
      actor: { userId: 'grantor-id' },
      target: { type: 'emergency_access', id: relationshipId },
      context: {
        fromStatus: 0,
        toStatus: 0,
        type: 1,
        waitTimeDays: 7,
        token: 'raw-invite-token',
        keyEncrypted: 'opaque-wrap',
        email: recipientEmail,
      },
    })

    expect(event.context).toEqual({
      fromStatus: 0,
      toStatus: 0,
      type: 1,
      waitTimeDays: 7,
    })
    expect(JSON.stringify(event)).not.toContain('raw-invite-token')
    expect(JSON.stringify(event)).not.toContain('opaque-wrap')
    expect(JSON.stringify(event)).not.toContain(recipientEmail)
  })
})
