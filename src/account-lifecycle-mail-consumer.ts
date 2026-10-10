import type { AccountLifecycleDelivery } from './account-lifecycle-mailer'
import type { AccountMailCodec } from './account-lifecycle-mail-envelope'
import type { OrganizationInvitationSender } from './organization-invitation-mailer'

export type AccountMailMessage = Pick<
  Message<unknown>,
  'body' | 'ack' | 'retry'
>

export async function consumeAccountLifecycleMail(
  messages: readonly AccountMailMessage[],
  options: {
    codec: AccountMailCodec
    senderEmail: string
    send: OrganizationInvitationSender
    now?: () => number
  },
): Promise<void> {
  if (messages.length > 10) {
    report('batch_invalid')
    throw new Error('Account lifecycle mail batch is invalid.')
  }
  const now = options.now ?? Date.now
  for (const message of messages) {
    const result = await options.codec.open(message.body)
    if (result.status === 'invalid') {
      report('message_invalid')
      message.ack()
      continue
    }
    if (result.status !== 'decoded') {
      report('message_unreadable')
      message.retry({ delaySeconds: 60 })
      continue
    }
    const timestamp = now()
    if (
      !Number.isFinite(timestamp) ||
      Date.parse(result.queuedAt) > timestamp + 60_000
    ) {
      report('clock_invalid')
      message.retry({ delaySeconds: 60 })
      continue
    }
    if (result.delivery.disposition === 'suppress') {
      message.ack()
      continue
    }
    if (Date.parse(result.delivery.expiresAt) <= timestamp) {
      report('message_expired')
      message.ack()
      continue
    }
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let accepted: boolean
    try {
      const mail = lifecycleMessage(result.delivery, options.senderEmail)
      const outcome = await Promise.race([
        Promise.resolve().then(() => options.send(mail, controller.signal)),
        new Promise<'timeout'>((resolve) => {
          timeout = setTimeout(() => {
            resolve('timeout')
            controller.abort()
          }, 10_000)
        }),
      ])
      accepted = outcome === 'accepted'
    } catch {
      accepted = false
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
    if (accepted) message.ack()
    else {
      report('delivery_failed')
      message.retry({ delaySeconds: 60 })
    }
  }
}

function lifecycleMessage(delivery: AccountLifecycleDelivery, from: string) {
  const copy = {
    email_verify: {
      subject: 'HonoWarden email verification code',
      instruction:
        'Enter this code in HonoWarden’s email verification form while signed in to your account. It confirms email ownership only.',
    },
    email_change: {
      subject: 'HonoWarden email change confirmation code',
      instruction:
        'Use this code to finish the email address change in the client where you requested it.',
    },
    account_delete: {
      subject: 'HonoWarden account deletion confirmation code',
      instruction:
        'Use this code only to confirm account deletion in the client where you requested it. Deletion removes access to your vault.',
    },
  }[delivery.purpose]
  return {
    from,
    to: delivery.recipientEmail.toLowerCase(),
    subject: copy.subject,
    text: [
      copy.instruction,
      `Confirmation code:\n${delivery.token}`,
      ...(delivery.purpose === 'account_delete'
        ? [`Account reference:\n${delivery.userId}`]
        : []),
      `This code expires at ${delivery.expiresAt}.`,
      'Do not share this code. If you did not request this action, ignore this message.',
    ].join('\n\n'),
  }
}

function report(
  code:
    | 'batch_invalid'
    | 'message_invalid'
    | 'message_unreadable'
    | 'clock_invalid'
    | 'message_expired'
    | 'delivery_failed',
) {
  console.error(JSON.stringify({ event: 'account_mail_consumer', code }))
}
