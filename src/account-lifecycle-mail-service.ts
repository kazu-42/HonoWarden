import { createAccountMailCodec } from './account-lifecycle-mail-envelope'
import {
  createAccountLifecycleMailReceiver,
  type AccountMailQueue,
} from './account-lifecycle-mail-queue'
import { consumeAccountLifecycleMail } from './account-lifecycle-mail-consumer'
import { createResendInvitationSender } from './organization-invitation-resend'

export type AccountLifecycleMailBindings = {
  ACCOUNT_LIFECYCLE_DELIVERY_QUEUE?: AccountMailQueue
  HONOWARDEN_ACCOUNT_MAIL_ACTIVE_KEY_ID?: string
  HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS?: string
  HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL?: string
  HONOWARDEN_ACCOUNT_MAIL_RESEND_API_KEY?: string
}

function codec(env: AccountLifecycleMailBindings) {
  return createAccountMailCodec({
    activeKeyId: env.HONOWARDEN_ACCOUNT_MAIL_ACTIVE_KEY_ID ?? '',
    keysJson: env.HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS ?? '',
  })
}

// Deploy as a private, service-binding-only Worker. HTTP input does not send mail;
// only the queue consumer has a provider dependency. Neither handler has a DB.
export default {
  fetch(
    request: Request,
    env: AccountLifecycleMailBindings,
  ): Promise<Response> | Response {
    try {
      if (!env.ACCOUNT_LIFECYCLE_DELIVERY_QUEUE)
        throw new Error('missing_queue')
      return createAccountLifecycleMailReceiver({
        codec: codec(env),
        queue: env.ACCOUNT_LIFECYCLE_DELIVERY_QUEUE,
      }).fetch(request)
    } catch {
      console.error(
        JSON.stringify({ event: 'account_mail_configuration_failed' }),
      )
      return new Response(null, {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      })
    }
  },
  async queue(
    batch: MessageBatch<unknown>,
    env: AccountLifecycleMailBindings,
  ): Promise<void> {
    let envelopeCodec
    try {
      envelopeCodec = codec(env)
    } catch {
      console.error(
        JSON.stringify({ event: 'account_mail_configuration_failed' }),
      )
      throw new Error(
        'Account lifecycle mail consumer configuration is invalid.',
      )
    }
    await consumeAccountLifecycleMail(batch.messages, {
      codec: envelopeCodec,
      senderEmail: env.HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL ?? '',
      // Reuse the reviewed bounded plain-text transport, with a separate key.
      send: (message, signal) =>
        createResendInvitationSender({
          apiKey: env.HONOWARDEN_ACCOUNT_MAIL_RESEND_API_KEY ?? '',
        })(message, signal),
    })
  },
} satisfies ExportedHandler<AccountLifecycleMailBindings>
