import { readBoundedJsonBody } from './infra/bounded-json'
import {
  parseAccountMailDelivery,
  type AccountMailCodec,
  type AccountMailEnvelope,
} from './account-lifecycle-mail-envelope'

export type AccountMailQueue = Pick<Queue<AccountMailEnvelope>, 'send'>

export function createAccountLifecycleMailReceiver(options: {
  codec: AccountMailCodec
  queue: AccountMailQueue
  now?: () => number
}): { fetch(request: Request): Promise<Response> } {
  const { codec, queue, now = Date.now } = options
  return {
    async fetch(request) {
      if (
        request.url !== 'https://account-lifecycle-mailer.internal/deliver' ||
        request.method !== 'POST'
      )
        return response(404)
      if (
        !/^application\/json(?:;|$)/i.test(
          request.headers.get('content-type') ?? '',
        )
      )
        return response(400)
      const body = await readBoundedJsonBody(request, 4096)
      const delivery = body.ok ? parseAccountMailDelivery(body.value) : null
      if (!delivery) return response(400)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        // Deliberately identical for deliver and suppress. Provider work never
        // participates in the caller's response or enqueue completion.
        const envelope = await codec.seal(delivery, now())
        await Promise.race([
          queue.send(envelope, { contentType: 'json' }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('enqueue_timeout')),
              5000,
            )
          }),
        ])
        return response(202)
      } catch {
        console.error(JSON.stringify({ event: 'account_mail_enqueue_failed' }))
        return response(503)
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    },
  }
}

function response(status: 202 | 400 | 404 | 503): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}
