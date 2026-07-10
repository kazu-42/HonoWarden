import { describe, expect, it } from 'vitest'

import {
  markInquiryMessageForwarded,
  persistInquiryInboundMessage,
} from '../../src/repositories/inquiry-repository'
import { FakeD1Database } from '../support/fake-d1'

describe('inquiry repository', () => {
  it('persists thread, message, and receive event metadata without raw body content', async () => {
    const database = new FakeD1Database('0011', [])

    const result = await persistInquiryInboundMessage(database, {
      threadId: 'thread-id',
      messageId: 'message-id',
      eventId: 'event-id',
      mailbox: 'security',
      threadKey: 'thread-key',
      senderHash: 'sender-hash',
      envelopeSenderHash: 'sender-hash',
      envelopeRecipient: 'security@honowarden.com',
      messageIdHash: 'message-id-hash',
      inReplyToHash: null,
      referencesHash: null,
      subjectPreview: 'Security report',
      rawSize: 1234,
      contentType: 'text/plain',
      hasAttachmentHint: false,
      bodyStorageState: 'metadata_only',
      rawBodyStored: false,
      rawObjectKey: null,
      attachmentStorageState: 'none',
      deliveryStatus: 'stored',
      rejectionReason: null,
      forwardAttempted: false,
      forwardedAt: null,
      receivedAt: '2026-07-10T04:00:00.000Z',
      retentionDeadline: '2027-07-10T04:00:00.000Z',
    })

    expect(result).toEqual({ threadId: 'thread-id', messageId: 'message-id' })
    expect(database.inquiryThreadInserts).toEqual([
      expect.objectContaining({
        id: 'thread-id',
        mailbox: 'security',
        threadKey: 'thread-key',
        senderHash: 'sender-hash',
        subjectPreview: 'Security report',
      }),
    ])
    expect(database.inquiryMessageInserts).toEqual([
      expect.objectContaining({
        id: 'message-id',
        threadId: 'thread-id',
        envelopeSenderHash: 'sender-hash',
        envelopeRecipient: 'security@honowarden.com',
        rawSize: 1234,
        bodyStorageState: 'metadata_only',
        rawBodyStored: false,
        rawObjectKey: null,
        deliveryStatus: 'stored',
      }),
    ])
    expect(JSON.stringify(database.inquiryMessageInserts)).not.toContain(
      'raw body',
    )
    expect(database.inquiryEventInserts).toEqual([
      expect.objectContaining({
        id: 'event-id',
        threadId: 'thread-id',
        messageId: 'message-id',
        name: 'inquiry.inbound.received',
        outcome: 'success',
      }),
    ])
  })

  it('marks a stored message as forwarded and appends an audit event', async () => {
    const database = new FakeD1Database('0011', [])

    await markInquiryMessageForwarded(database, {
      threadId: 'thread-id',
      messageId: 'message-id',
      forwardedAt: '2026-07-10T04:05:00.000Z',
    })

    expect(database.inquiryMessageForwardUpdates).toEqual([
      {
        messageId: 'message-id',
        forwardedAt: '2026-07-10T04:05:00.000Z',
      },
    ])
    expect(database.inquiryEventInserts).toEqual([
      expect.objectContaining({
        threadId: 'thread-id',
        messageId: 'message-id',
        name: 'inquiry.inbound.forwarded',
        outcome: 'success',
      }),
    ])
  })
})
