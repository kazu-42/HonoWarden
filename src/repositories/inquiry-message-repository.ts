type InquiryMessageDatabase = Pick<D1Database, 'prepare'>

export const inquiryMessageRetentionPolicy = {
  metadataRetentionDays: 365,
} as const

export type InquiryMessageDeliveryStatus = 'stored' | 'rejected'

export type InquiryMessageAttachmentStorageState =
  'not_present' | 'rejected' | 'unknown'

export type PersistInquiryMessageInput = {
  id: string
  mailbox: string
  envelopeSender: string
  envelopeSenderSha256: string
  envelopeRecipient: string
  messageIdSha256: string | null
  subjectSha256: string | null
  headersJson: string
  headerCount: number
  rawSize: number
  bodyMetadataJson: string
  bodyStorageState: 'metadata_only'
  rawStorageState: 'disabled'
  attachmentStorageState: InquiryMessageAttachmentStorageState
  attachmentCount: number | null
  deliveryStatus: InquiryMessageDeliveryStatus
  rejectReason: string | null
  receivedAt: string
  retentionDeleteAfter: string
}

export async function persistInquiryMessage(
  database: InquiryMessageDatabase,
  input: PersistInquiryMessageInput,
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO inquiry_messages (
          id,
          mailbox,
          envelope_sender,
          envelope_sender_sha256,
          envelope_recipient,
          message_id_sha256,
          subject_sha256,
          headers_json,
          header_count,
          raw_size,
          body_metadata_json,
          body_storage_state,
          raw_storage_state,
          attachment_storage_state,
          attachment_count,
          delivery_status,
          reject_reason,
          received_at,
          retention_delete_after
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.mailbox,
      input.envelopeSender,
      input.envelopeSenderSha256,
      input.envelopeRecipient,
      input.messageIdSha256,
      input.subjectSha256,
      input.headersJson,
      input.headerCount,
      input.rawSize,
      input.bodyMetadataJson,
      input.bodyStorageState,
      input.rawStorageState,
      input.attachmentStorageState,
      input.attachmentCount,
      input.deliveryStatus,
      input.rejectReason,
      input.receivedAt,
      input.retentionDeleteAfter,
    )
    .run()
}
