import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleInquiryEmail } from '../src/inquiry-email'
import { FakeD1Database } from './support/fake-d1'

describe('inquiry email worker handler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores metadata-only inbound mail and forwards when configured', async () => {
    const database = new FakeD1Database('0011', [])
    const message = new FakeForwardableEmailMessage({
      from: 'sender@example.net',
      to: 'security@honowarden.com',
      headers: new Headers({
        subject: 'Security report',
        'message-id': '<message-1@example.net>',
        'content-type': 'text/plain',
      }),
      rawSize: 512,
      rawText: 'This raw body must not be read or persisted.',
    })

    await handleInquiryEmail(message as unknown as ForwardableEmailMessage, {
      DB: database as unknown as D1Database,
      INQUIRY_DB: database as unknown as D1Database,
      VAULT_OBJECTS: {} as R2Bucket,
      HONOWARDEN_INQUIRY_FORWARD_TO: 'operator@example.test',
    })

    expect(message.forwardedTo).toEqual(['operator@example.test'])
    expect(message.rejectedReason).toBeNull()
    expect(message.rawReadCount).toBe(0)
    expect(database.inquiryMessageInserts).toHaveLength(1)
    expect(database.inquiryMessageInserts[0]).toMatchObject({
      envelopeRecipient: 'security@honowarden.com',
      rawSize: 512,
      bodyStorageState: 'metadata_only',
      rawBodyStored: false,
      deliveryStatus: 'stored',
      forwardAttempted: false,
    })
    expect(database.inquiryMessageForwardUpdates).toEqual([
      expect.objectContaining({
        messageId: database.inquiryMessageInserts[0]?.id,
      }),
    ])
    expect(database.inquiryEventInserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'inquiry.inbound.received',
          outcome: 'success',
        }),
        expect.objectContaining({
          name: 'inquiry.inbound.forwarded',
          outcome: 'success',
        }),
      ]),
    )
  })

  it('does not forward when metadata storage fails before forwarding', async () => {
    const database = new FakeD1Database('0011', [], {
      inquiryInsertThrows: true,
    })
    const message = new FakeForwardableEmailMessage({
      from: 'sender@example.net',
      to: 'security@honowarden.com',
      headers: new Headers({
        subject: 'Security report',
        'message-id': '<message-storage-fail@example.net>',
      }),
      rawSize: 512,
    })

    await expect(
      handleInquiryEmail(message as unknown as ForwardableEmailMessage, {
        DB: database as unknown as D1Database,
        INQUIRY_DB: database as unknown as D1Database,
        VAULT_OBJECTS: {} as R2Bucket,
        HONOWARDEN_INQUIRY_FORWARD_TO: 'operator@example.test',
      }),
    ).rejects.toThrow('inquiry insert failed')

    expect(message.forwardedTo).toEqual([])
  })

  it('does not retry the email after a post-forward status update failure', async () => {
    const database = new FakeD1Database('0011', [], {
      inquiryForwardUpdateThrows: true,
    })
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const message = new FakeForwardableEmailMessage({
      from: 'sender@example.net',
      to: 'security@honowarden.com',
      headers: new Headers({
        subject: 'Security report',
        'message-id': '<message-forward-update-fail@example.net>',
      }),
      rawSize: 512,
    })

    await expect(
      handleInquiryEmail(message as unknown as ForwardableEmailMessage, {
        DB: database as unknown as D1Database,
        INQUIRY_DB: database as unknown as D1Database,
        VAULT_OBJECTS: {} as R2Bucket,
        HONOWARDEN_INQUIRY_FORWARD_TO: 'operator@example.test',
      }),
    ).resolves.toBeUndefined()

    expect(message.forwardedTo).toEqual(['operator@example.test'])
    expect(database.inquiryMessageInserts).toHaveLength(1)
    expect(database.inquiryMessageForwardUpdates).toEqual([])
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('inquiry.forward_status_update_failed'),
    )
  })

  it('rejects recipients outside the configured mailbox allowlist', async () => {
    const database = new FakeD1Database('0011', [])
    const message = new FakeForwardableEmailMessage({
      from: 'sender@example.net',
      to: 'sales@honowarden.com',
      headers: new Headers({ subject: 'sales' }),
      rawSize: 100,
    })

    await handleInquiryEmail(message as unknown as ForwardableEmailMessage, {
      DB: database as unknown as D1Database,
      INQUIRY_DB: database as unknown as D1Database,
      VAULT_OBJECTS: {} as R2Bucket,
    })

    expect(message.rejectedReason).toBe('Recipient is not accepted.')
    expect(message.forwardedTo).toEqual([])
    expect(database.inquiryMessageInserts).toEqual([])
  })

  it('rejects attachment-like messages while raw attachment storage is disabled', async () => {
    const database = new FakeD1Database('0011', [])
    const message = new FakeForwardableEmailMessage({
      from: 'sender@example.net',
      to: 'hello@honowarden.com',
      headers: new Headers({
        subject: 'attached',
        'content-type': 'multipart/mixed; boundary=abc',
      }),
      rawSize: 100,
    })

    await handleInquiryEmail(message as unknown as ForwardableEmailMessage, {
      DB: database as unknown as D1Database,
      INQUIRY_DB: database as unknown as D1Database,
      VAULT_OBJECTS: {} as R2Bucket,
    })

    expect(message.rejectedReason).toBe('Attachments are not accepted.')
    expect(message.forwardedTo).toEqual([])
    expect(database.inquiryMessageInserts).toHaveLength(1)
    expect(database.inquiryMessageInserts[0]).toMatchObject({
      deliveryStatus: 'rejected',
      attachmentStorageState: 'rejected',
      rejectionReason: 'attachments_disabled',
    })
  })
})

class FakeForwardableEmailMessage {
  readonly canBeForwarded = true
  readonly forwardedTo: string[] = []
  rawReadCount = 0
  rejectedReason: string | null = null

  constructor(
    readonly input: {
      from: string
      to: string
      headers: Headers
      rawSize: number
      rawText?: string
    },
  ) {}

  get raw() {
    const encoder = new TextEncoder()
    const body = encoder.encode(this.input.rawText ?? '')
    this.rawReadCount += 1

    return new ReadableStream({
      start: (controller) => {
        controller.enqueue(body)
        controller.close()
      },
    })
  }

  get from() {
    return this.input.from
  }

  get to() {
    return this.input.to
  }

  get headers() {
    return this.input.headers
  }

  get rawSize() {
    return this.input.rawSize
  }

  setReject(reason: string) {
    this.rejectedReason = reason
  }

  async forward(recipient: string) {
    this.forwardedTo.push(recipient)
    return {}
  }

  async reply() {
    return {}
  }
}
