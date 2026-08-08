import type { AccountLifecycleTokenPurpose } from './domain/account-lifecycle'

export type AccountLifecycleDelivery = {
  disposition: 'deliver' | 'suppress'
  purpose: AccountLifecycleTokenPurpose
  recipientEmail: string
  token: string
  userId: string
  expiresAt: string
}

export async function deliverAccountLifecycleToken(
  mailer: Fetcher,
  delivery: AccountLifecycleDelivery,
): Promise<void> {
  assertBoundedDelivery(delivery)

  let response: Response
  try {
    response = await mailer.fetch(
      'https://account-lifecycle-mailer.internal/deliver',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delivery),
      },
    )
  } catch {
    throw new Error('Account lifecycle token delivery failed.')
  }

  if (response.status !== 202) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Account lifecycle token delivery failed.')
  }
  await response.body?.cancel().catch(() => undefined)
}

function assertBoundedDelivery(delivery: AccountLifecycleDelivery): void {
  const valid =
    delivery.recipientEmail.length > 0 &&
    delivery.recipientEmail.length <= 256 &&
    delivery.token.length === 43 &&
    delivery.userId.length > 0 &&
    delivery.userId.length <= 128 &&
    delivery.expiresAt.length <= 32
  if (!valid) {
    throw new Error('Account lifecycle token delivery is invalid.')
  }
}
