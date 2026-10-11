import { createAccountMailCodec } from './account-lifecycle-mail-envelope'
import {
  createAccountLifecycleMailReceiver,
  type AccountMailQueue,
} from './account-lifecycle-mail-queue'
import { consumeAccountLifecycleMail } from './account-lifecycle-mail-consumer'
import { createCloudflareEmailSender } from './cloudflare-email-sender'
import { normalizedEmail } from './organization-invitation-mailer'

export type AccountLifecycleMailBindings = {
  ACCOUNT_LIFECYCLE_DELIVERY_QUEUE?: AccountMailQueue
  HONOWARDEN_ACCOUNT_MAIL_ACTIVE_KEY_ID?: string
  HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS?: string
  HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL?: string
  EMAIL?: SendEmail
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
      if (
        !env.ACCOUNT_LIFECYCLE_DELIVERY_QUEUE ||
        !normalizedEmail(env.HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL)
      )
        throw new Error('missing_queue')
      createCloudflareEmailSender(env.EMAIL)
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
    let send
    try {
      envelopeCodec = codec(env)
      send = createCloudflareEmailSender(env.EMAIL)
      if (!normalizedEmail(env.HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL))
        throw new Error('missing_sender')
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
      send,
    })
  },
} satisfies ExportedHandler<AccountLifecycleMailBindings>
