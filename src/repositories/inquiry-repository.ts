import type { InquiryInboundRecord } from '../domain/inquiry'

type InquiryDatabase = Pick<D1Database, 'prepare'>

export type PersistInquiryInboundMessageResult = {
  threadId: string
  messageId: string
}

export type MarkInquiryMessageForwardedInput = {
  threadId: string
  messageId: string
  forwardedAt: string
}

export async function persistInquiryInboundMessage(
  database: InquiryDatabase,
  record: InquiryInboundRecord,
): Promise<PersistInquiryInboundMessageResult> {
  await database
    .prepare(
      `
        INSERT INTO inquiry_threads (
          id,
          mailbox,
          thread_key,
          sender_hash,
          subject_preview,
          status,
          retention_deadline,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          subject_preview = COALESCE(excluded.subject_preview, inquiry_threads.subject_preview),
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      record.threadId,
      record.mailbox,
      record.threadKey,
      record.senderHash,
      record.subjectPreview,
      record.deliveryStatus === 'rejected' ? 'rejected' : 'open',
      record.retentionDeadline,
      record.receivedAt,
      record.receivedAt,
    )
    .run()

  await database
    .prepare(
      `
        INSERT INTO inquiry_messages (
          id,
          thread_id,
          direction,
          envelope_sender_hash,
          envelope_recipient,
          message_id_hash,
          in_reply_to_hash,
          references_hash,
          subject_preview,
          raw_size,
          content_type,
          has_attachment_hint,
          body_storage_state,
          raw_body_stored,
          raw_object_key,
          attachment_storage_state,
          delivery_status,
          rejection_reason,
          forward_attempted,
          forwarded_at,
          received_at,
          retention_deadline,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          delivery_status = CASE
            WHEN inquiry_messages.delivery_status = 'forwarded' THEN 'forwarded'
            WHEN excluded.delivery_status = 'rejected' THEN 'rejected'
            ELSE excluded.delivery_status
          END,
          rejection_reason = COALESCE(excluded.rejection_reason, inquiry_messages.rejection_reason),
          forward_attempted = CASE
            WHEN inquiry_messages.forward_attempted = 1 OR excluded.forward_attempted = 1 THEN 1
            ELSE 0
          END,
          forwarded_at = COALESCE(inquiry_messages.forwarded_at, excluded.forwarded_at)
      `,
    )
    .bind(
      record.messageId,
      record.threadId,
      'inbound',
      record.envelopeSenderHash,
      record.envelopeRecipient,
      record.messageIdHash,
      record.inReplyToHash,
      record.referencesHash,
      record.subjectPreview,
      record.rawSize,
      record.contentType,
      record.hasAttachmentHint ? 1 : 0,
      record.bodyStorageState,
      record.rawBodyStored ? 1 : 0,
      record.rawObjectKey,
      record.attachmentStorageState,
      record.deliveryStatus,
      record.rejectionReason,
      record.forwardAttempted ? 1 : 0,
      record.forwardedAt,
      record.receivedAt,
      record.retentionDeadline,
      record.receivedAt,
    )
    .run()

  await database
    .prepare(
      `
        INSERT INTO inquiry_events (
          id,
          thread_id,
          message_id,
          name,
          outcome,
          occurred_at,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      record.eventId,
      record.threadId,
      record.messageId,
      'inquiry.inbound.received',
      record.deliveryStatus === 'rejected' ? 'failure' : 'success',
      record.receivedAt,
      JSON.stringify({
        mailbox: record.mailbox,
        deliveryStatus: record.deliveryStatus,
        attachmentStorageState: record.attachmentStorageState,
        bodyStorageState: record.bodyStorageState,
      }),
      record.receivedAt,
    )
    .run()

  return {
    threadId: record.threadId,
    messageId: record.messageId,
  }
}

export async function markInquiryMessageForwarded(
  database: InquiryDatabase,
  input: MarkInquiryMessageForwardedInput,
): Promise<void> {
  await database
    .prepare(
      `
        UPDATE inquiry_messages
        SET
          delivery_status = 'forwarded',
          forward_attempted = 1,
          forwarded_at = ?
        WHERE id = ?
      `,
    )
    .bind(input.forwardedAt, input.messageId)
    .run()

  await database
    .prepare(
      `
        INSERT INTO inquiry_events (
          id,
          thread_id,
          message_id,
          name,
          outcome,
          occurred_at,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      crypto.randomUUID(),
      input.threadId,
      input.messageId,
      'inquiry.inbound.forwarded',
      'success',
      input.forwardedAt,
      JSON.stringify({ deliveryStatus: 'forwarded' }),
      input.forwardedAt,
    )
    .run()
}
