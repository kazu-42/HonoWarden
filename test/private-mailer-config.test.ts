import { readFileSync } from 'node:fs'
import { parse } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'

type Scope = Record<string, unknown> & {
  name: string
  main?: string
  vars: Record<string, string>
  send_email: Array<{ name: string; allowed_sender_addresses: string[] }>
  queues?: {
    producers: Array<{ binding: string; queue: string }>
    consumers: Array<{
      queue: string
      max_batch_size: number
      max_retries: number
      retry_delay: number
      dead_letter_queue: string
    }>
  }
}
type Config = Scope & { env: { staging: Scope; production: Scope } }
const invitation = parse(
  readFileSync('wrangler.invitation-mailer.jsonc', 'utf8'),
) as Config
const account = parse(
  readFileSync('wrangler.account-mailer.jsonc', 'utf8'),
) as Config

describe.each([
  [
    invitation,
    'src/organization-invitation-service.ts',
    'HONOWARDEN_INVITATION_SENDER_EMAIL',
  ],
  [
    account,
    'src/account-lifecycle-mail-service.ts',
    'HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL',
  ],
] as const)('%s private mailer configuration', (config, main, senderVar) => {
  it('is private and has only its email binding in every scope', () => {
    for (const scope of [config, config.env.staging, config.env.production]) {
      const effective = { ...config, ...scope }
      expect(effective.main).toBe(main)
      expect(scope.workers_dev).toBe(false)
      expect(scope.preview_urls).toBe(false)
      expect(scope.routes ?? []).toEqual([])
      expect(scope.observability).toMatchObject({ enabled: true })
      expect(scope.send_email).toEqual([
        { name: 'EMAIL', allowed_sender_addresses: [scope.vars[senderVar]] },
      ])
      for (const forbidden of [
        'assets',
        'd1_databases',
        'r2_buckets',
        'kv_namespaces',
        'durable_objects',
        'triggers',
        'services',
      ]) {
        expect(scope).not.toHaveProperty(forbidden)
      }
      expect(JSON.stringify(scope)).not.toContain(
        'HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS',
      )
      expect(JSON.stringify(scope)).not.toContain('RESEND_API_KEY')
    }
  })
})

it('pins invitation workers to the chosen domains and origins', () => {
  expect(invitation.env.staging.name).toBe(
    'honowarden-invitation-mailer-staging',
  )
  expect(invitation.env.production.name).toBe('honowarden-invitation-mailer')
  expect(invitation.env.staging.vars).toEqual({
    HONOWARDEN_INVITATION_SENDER_EMAIL: 'no-reply-staging@mail.honowarden.com',
    HONOWARDEN_INVITATION_ADMIN_ORIGIN: 'https://vault-staging.honowarden.com',
  })
  expect(invitation.env.production.vars).toEqual({
    HONOWARDEN_INVITATION_SENDER_EMAIL: 'no-reply@mail.honowarden.com',
    HONOWARDEN_INVITATION_ADMIN_ORIGIN: 'https://vault.honowarden.com',
  })
})

it('pins account workers to the chosen queues, senders and bounded retries', () => {
  for (const [scope, suffix, sender] of [
    [account.env.staging, '-staging', 'no-reply-staging@mail.honowarden.com'],
    [account.env.production, '', 'no-reply@mail.honowarden.com'],
  ] as const) {
    expect(scope.name).toBe(`honowarden-account-mailer${suffix}`)
    expect(scope.vars).toEqual({
      HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL: sender,
      HONOWARDEN_ACCOUNT_MAIL_ACTIVE_KEY_ID: 'account-mail-1',
    })
    expect(scope.queues?.producers).toEqual([
      {
        binding: 'ACCOUNT_LIFECYCLE_DELIVERY_QUEUE',
        queue: `honowarden-account-mail${suffix}`,
      },
    ])
    expect(scope.queues?.consumers).toEqual([
      expect.objectContaining({
        queue: `honowarden-account-mail${suffix}`,
        max_batch_size: 10,
        max_retries: 3,
        retry_delay: 60,
        dead_letter_queue: `honowarden-account-mail${suffix}-dlq`,
      }),
    ])
  }
})
