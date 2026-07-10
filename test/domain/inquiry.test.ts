import { describe, expect, it } from 'vitest'

import {
  buildInquiryInboundRecord,
  defaultInquiryMailboxes,
  parseInquiryMailboxConfig,
} from '../../src/domain/inquiry'

describe('inquiry inbox domain', () => {
  it('keeps the default public contact mailbox allowlist narrow', () => {
    expect(defaultInquiryMailboxes).toEqual([
      'security',
      'support',
      'hello',
      'admin',
      'postmaster',
      'abuse',
    ])
  })

  it('parses configured local parts and domains without accepting wildcards', () => {
    expect(
      parseInquiryMailboxConfig({
        mailboxes: ' Security , support,hello@example.test, invalid local ',
        domains: 'honowarden.com,example.test',
      }),
    ).toEqual({
      mailboxes: ['security', 'support', 'hello'],
      domains: ['honowarden.com', 'example.test'],
    })
  })

  it('builds metadata-only records without storing raw body or raw headers', async () => {
    const record = await buildInquiryInboundRecord({
      envelopeFrom: 'Sender+tag@example.net',
      envelopeTo: 'Security@HonoWarden.com',
      headers: new Headers({
        subject: '  Security report with a very long subject '.repeat(8),
        'message-id': '<message-1@example.net>',
        'in-reply-to': '<root@example.net>',
        references: '<root@example.net> <message-0@example.net>',
        'content-type': 'text/plain; charset=utf-8',
      }),
      rawSize: 1234,
      now: '2026-07-10T04:00:00.000Z',
      retentionDays: 365,
      config: {
        mailboxes: ['security', 'support'],
        domains: ['honowarden.com'],
      },
    })

    expect(record.ok).toBe(true)
    if (!record.ok) {
      return
    }

    expect(record.value.mailbox).toBe('security')
    expect(record.value.envelopeRecipient).toBe('security@honowarden.com')
    expect(record.value.envelopeSenderHash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.value.messageIdHash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.value.inReplyToHash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.value.referencesHash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.value.subjectPreview).not.toBeNull()
    expect(record.value.subjectPreview?.length).toBeLessThanOrEqual(160)
    expect(record.value.rawSize).toBe(1234)
    expect(record.value.bodyStorageState).toBe('metadata_only')
    expect(record.value.rawBodyStored).toBe(false)
    expect(record.value.rawObjectKey).toBeNull()
    expect(record.value.retentionDeadline).toBe('2027-07-10T04:00:00.000Z')
  })

  it('rejects unknown recipients before storage', async () => {
    const record = await buildInquiryInboundRecord({
      envelopeFrom: 'sender@example.net',
      envelopeTo: 'sales@honowarden.com',
      headers: new Headers({ subject: 'hello' }),
      rawSize: 100,
      now: '2026-07-10T04:00:00.000Z',
      retentionDays: 365,
      config: {
        mailboxes: ['security'],
        domains: ['honowarden.com'],
      },
    })

    expect(record).toEqual({
      ok: false,
      reason: 'recipient_not_allowed',
    })
  })

  it('marks attachment-like mail as rejected because raw attachment storage is disabled', async () => {
    const record = await buildInquiryInboundRecord({
      envelopeFrom: 'sender@example.net',
      envelopeTo: 'hello@honowarden.com',
      headers: new Headers({
        subject: 'attached',
        'content-type': 'multipart/mixed; boundary=abc',
      }),
      rawSize: 100,
      now: '2026-07-10T04:00:00.000Z',
      retentionDays: 365,
      config: {
        mailboxes: ['hello'],
        domains: ['honowarden.com'],
      },
    })

    expect(record.ok).toBe(true)
    if (!record.ok) {
      return
    }

    expect(record.value.hasAttachmentHint).toBe(true)
    expect(record.value.attachmentStorageState).toBe('rejected')
    expect(record.value.deliveryStatus).toBe('rejected')
    expect(record.value.rejectionReason).toBe('attachments_disabled')
  })
})
