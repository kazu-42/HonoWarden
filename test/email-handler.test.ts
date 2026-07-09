import { describe, expect, it, vi } from 'vitest'

import { handleInboundInquiryEmail } from '../src/email/inquiry-handler'
import { FakeD1Database } from './support/fake-d1'

describe('inbound inquiry email handler', () => {
  it('stores metadata-only inbound inquiry rows without raw bodies or plaintext subjects', async () => {
    const database = new FakeD1Database('0009', ['inquiry_messages'])
    const message = buildEmailMessage({
      from: 'Sender@Example.test',
      to: 'security@honowarden.com',
      headers: new Headers({
        'content-type': 'text/plain; charset=utf-8',
        date: 'Thu, 09 Jul 2026 20:00:00 +0000',
        'message-id': '<hon-24@example.test>',
        subject: 'HON-24 smoke',
      }),
      rawSize: 0,
    })

    await handleInboundInquiryEmail(
      message,
      {
        DB: database as unknown as D1Database,
        VAULT_OBJECTS: {} as unknown as R2Bucket,
      },
      {
        id: 'inquiry-message-1',
        now: new Date('2026-07-09T20:00:00.000Z'),
      },
    )

    expect(message.setReject).not.toHaveBeenCalled()
    expect(database.inquiryMessageInserts).toHaveLength(1)
    expect(database.inquiryMessageInserts[0]).toMatchObject({
      id: 'inquiry-message-1',
      mailbox: 'security',
      envelopeSender: 'Sender@Example.test',
      envelopeSenderSha256: await sha256Hex('Sender@Example.test'),
      envelopeRecipient: 'security@honowarden.com',
      messageIdSha256: await sha256Hex('<hon-24@example.test>'),
      subjectSha256: await sha256Hex('HON-24 smoke'),
      headerCount: 4,
      rawSize: 0,
      bodyStorageState: 'metadata_only',
      rawStorageState: 'disabled',
      attachmentStorageState: 'not_present',
      attachmentCount: 0,
      deliveryStatus: 'stored',
      rejectReason: null,
      receivedAt: '2026-07-09T20:00:00.000Z',
      retentionDeleteAfter: '2027-07-09T20:00:00.000Z',
    })

    const headers = JSON.parse(database.inquiryMessageInserts[0]!.headersJson)
    expect(headers).toMatchObject({
      schemaVersion: 1,
      hasSubject: true,
      hasMessageId: true,
      contentType: 'text/plain; charset=utf-8',
    })
    expect(database.inquiryMessageInserts[0]!.headersJson).not.toContain(
      'HON-24 smoke',
    )

    const bodyMetadata = JSON.parse(
      database.inquiryMessageInserts[0]!.bodyMetadataJson,
    )
    expect(bodyMetadata).toMatchObject({
      parser: 'not_run',
      bodyStorageState: 'metadata_only',
      rawStorageState: 'disabled',
    })
  })

  it('records and rejects unsupported recipients without storing message bodies', async () => {
    const database = new FakeD1Database('0009', ['inquiry_messages'])
    const message = buildEmailMessage({
      to: 'sales@honowarden.com',
      headers: new Headers({
        'content-type': 'text/plain',
        subject: 'Not an allowed mailbox',
      }),
      rawSize: 12,
    })

    await handleInboundInquiryEmail(
      message,
      {
        DB: database as unknown as D1Database,
        VAULT_OBJECTS: {} as unknown as R2Bucket,
      },
      {
        id: 'inquiry-message-2',
        now: new Date('2026-07-09T20:05:00.000Z'),
      },
    )

    expect(message.setReject).toHaveBeenCalledWith(
      'Unsupported inquiry recipient',
    )
    expect(database.inquiryMessageInserts[0]).toMatchObject({
      mailbox: 'unsupported',
      envelopeRecipient: 'sales@honowarden.com',
      deliveryStatus: 'rejected',
      rejectReason: 'Unsupported inquiry recipient',
      rawStorageState: 'disabled',
    })
    expect(database.inquiryMessageInserts[0]!.headersJson).not.toContain(
      'Not an allowed mailbox',
    )
  })

  it('accepts configured smoke-test mailboxes without expanding the default set', async () => {
    const database = new FakeD1Database('0009', ['inquiry_messages'])
    const message = buildEmailMessage({
      to: 'inquiry-smoke@honowarden.com',
      headers: new Headers({
        'content-type': 'text/plain',
        subject: 'Smoke mailbox',
      }),
      rawSize: 0,
    })

    await handleInboundInquiryEmail(
      message,
      {
        DB: database as unknown as D1Database,
        VAULT_OBJECTS: {} as unknown as R2Bucket,
        HONOWARDEN_INQUIRY_MAILBOXES:
          'security,support,hello,admin,postmaster,abuse,inquiry-smoke',
      },
      {
        id: 'inquiry-message-smoke',
        now: new Date('2026-07-09T20:07:00.000Z'),
      },
    )

    expect(message.setReject).not.toHaveBeenCalled()
    expect(database.inquiryMessageInserts[0]).toMatchObject({
      id: 'inquiry-message-smoke',
      mailbox: 'inquiry-smoke',
      envelopeRecipient: 'inquiry-smoke@honowarden.com',
      deliveryStatus: 'stored',
      rawStorageState: 'disabled',
      bodyStorageState: 'metadata_only',
    })
  })

  it('rejects likely attachment-bearing messages until R2 retention controls exist', async () => {
    const database = new FakeD1Database('0009', ['inquiry_messages'])
    const message = buildEmailMessage({
      to: 'support@honowarden.com',
      headers: new Headers({
        'content-type': 'multipart/mixed; boundary=abc',
        subject: 'has file',
      }),
      rawSize: 1024,
    })

    await handleInboundInquiryEmail(
      message,
      {
        DB: database as unknown as D1Database,
        VAULT_OBJECTS: {} as unknown as R2Bucket,
      },
      {
        id: 'inquiry-message-3',
        now: new Date('2026-07-09T20:10:00.000Z'),
      },
    )

    expect(message.setReject).toHaveBeenCalledWith(
      'Inquiry attachments are not accepted yet',
    )
    expect(database.inquiryMessageInserts[0]).toMatchObject({
      mailbox: 'support',
      attachmentStorageState: 'rejected',
      attachmentCount: null,
      deliveryStatus: 'rejected',
      rejectReason: 'Inquiry attachments are not accepted yet',
    })
  })

  it('fails loudly and logs secret-safe metadata when D1 persistence fails', async () => {
    const database = new FakeD1Database('0009', ['inquiry_messages'], {
      inquiryMessageInsertThrows: true,
    })
    const message = buildEmailMessage({
      from: 'private-sender@example.test',
      to: 'hello@honowarden.com',
      headers: new Headers({
        subject: 'private subject',
      }),
      rawSize: 42,
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await handleInboundInquiryEmail(
      message,
      {
        DB: database as unknown as D1Database,
        VAULT_OBJECTS: {} as unknown as R2Bucket,
      },
      {
        id: 'inquiry-message-4',
        now: new Date('2026-07-09T20:15:00.000Z'),
      },
    )

    expect(message.setReject).toHaveBeenCalledWith(
      'Temporary inquiry storage failure',
    )
    expect(consoleError).toHaveBeenCalledTimes(1)
    const logLine = String(consoleError.mock.calls[0]![0])
    expect(logLine).toContain('inquiry_storage_failed')
    expect(logLine).toContain('"mailbox":"hello"')
    expect(logLine).not.toContain('private-sender@example.test')
    expect(logLine).not.toContain('private subject')

    consoleError.mockRestore()
  })
})

function buildEmailMessage(
  overrides: Partial<Pick<ForwardableEmailMessage, 'from' | 'to' | 'headers'>> &
    Pick<ForwardableEmailMessage, 'rawSize'>,
): Pick<
  ForwardableEmailMessage,
  'from' | 'to' | 'headers' | 'rawSize' | 'setReject'
> & {
  setReject: ReturnType<typeof vi.fn<(reason: string) => void>>
} {
  return {
    from: overrides.from ?? 'sender@example.test',
    to: overrides.to ?? 'security@honowarden.com',
    headers: overrides.headers ?? new Headers(),
    rawSize: overrides.rawSize,
    setReject: vi.fn<(reason: string) => void>(),
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
