import { describe, expect, it } from 'vitest'
import { createAccountMailCodec } from '../src/account-lifecycle-mail-envelope'

const now = '2026-10-06T00:00:00.000Z'
const secret = btoa(String.fromCharCode(7).repeat(32)).replace(/=+$/, '')
const delivery = {
  disposition: 'deliver' as const,
  purpose: 'email_verify' as const,
  recipientEmail: 'Member@example.test',
  token: 's'.repeat(43),
  userId: 'synthetic-user',
  expiresAt: '2026-10-07T00:00:00.000Z',
}

describe('encrypted account lifecycle mail envelope', () => {
  it('round-trips through AES-GCM without storing address, disposition, user ID or code in clear', async () => {
    const codec = createAccountMailCodec({
      activeKeyId: 'key1',
      keysJson: JSON.stringify({ key1: secret }),
    })
    const encrypted = await codec.seal(delivery, Date.parse(now))
    expect(encrypted).toEqual({
      version: 1,
      keyId: 'key1',
      iv: expect.any(String),
      ciphertext: expect.any(String),
    })
    for (const hidden of [
      delivery.recipientEmail,
      delivery.token,
      delivery.userId,
      delivery.purpose,
      delivery.disposition,
    ])
      expect(JSON.stringify(encrypted)).not.toContain(hidden)
    expect(await codec.open(encrypted)).toEqual({
      status: 'decoded',
      delivery,
      queuedAt: now,
    })
  })

  it('pads deliver and suppress to the same envelope size, while fresh IVs change ciphertext', async () => {
    const codec = createAccountMailCodec({
      activeKeyId: 'key1',
      keysJson: JSON.stringify({ key1: secret }),
    })
    const sent = await codec.seal(delivery, Date.parse(now))
    const suppressed = await codec.seal(
      {
        ...delivery,
        disposition: 'suppress',
        userId: 'anonymous-suppressed-account',
      },
      Date.parse(now),
    )
    const repeated = await codec.seal(delivery, Date.parse(now))
    expect(JSON.stringify(sent).length).toBe(JSON.stringify(suppressed).length)
    expect(sent.ciphertext).toHaveLength(2752)
    expect(repeated.iv).not.toBe(sent.iv)
    expect(repeated.ciphertext).not.toBe(sent.ciphertext)
  })

  it('reads queued messages under a previous key after rotation and marks an unavailable key as retryable', async () => {
    const old = createAccountMailCodec({
      activeKeyId: 'key1',
      keysJson: JSON.stringify({ key1: secret }),
    })
    const next = btoa(String.fromCharCode(9).repeat(32)).replace(/=+$/, '')
    const rotated = createAccountMailCodec({
      activeKeyId: 'key2',
      keysJson: JSON.stringify({ key1: secret, key2: next }),
    })
    const retired = createAccountMailCodec({
      activeKeyId: 'key2',
      keysJson: JSON.stringify({ key2: next }),
    })
    const queued = await old.seal(delivery, Date.parse(now))
    expect(await rotated.open(queued)).toMatchObject({ status: 'decoded' })
    expect(await retired.open(queued)).toEqual({ status: 'unknown_key' })
    expect((await rotated.seal(delivery, Date.parse(now))).keyId).toBe('key2')
  })

  it('authenticates ciphertext, IV, and key ID even when the key material is shared by two IDs', async () => {
    const codec = createAccountMailCodec({
      activeKeyId: 'key1',
      keysJson: JSON.stringify({ key1: secret, key2: secret }),
    })
    const sealed = await codec.seal(delivery, Date.parse(now))
    for (const changed of [
      {
        ...sealed,
        ciphertext:
          (sealed.ciphertext[0] === 'A' ? 'B' : 'A') +
          sealed.ciphertext.slice(1),
      },
      {
        ...sealed,
        iv: (sealed.iv[0] === 'A' ? 'B' : 'A') + sealed.iv.slice(1),
      },
      { ...sealed, keyId: 'key2' },
    ])
      expect(await codec.open(changed)).toEqual({ status: 'unreadable' })
  })

  it.each([
    null,
    {},
    [],
    {
      version: 2,
      keyId: 'key1',
      iv: 'a'.repeat(16),
      ciphertext: 'a'.repeat(2752),
    },
    {
      version: 1,
      keyId: 'key1',
      iv: 'a'.repeat(15),
      ciphertext: 'a'.repeat(2752),
    },
    {
      version: 1,
      keyId: 'key1',
      iv: 'a'.repeat(16),
      ciphertext: 'a'.repeat(2753),
    },
  ])('rejects malformed queue envelope %j', async (value) => {
    const codec = createAccountMailCodec({
      activeKeyId: 'key1',
      keysJson: JSON.stringify({ key1: secret }),
    })
    expect(await codec.open(value)).toEqual({ status: 'invalid' })
  })

  it.each([
    { ...delivery, disposition: 'send' },
    { ...delivery, purpose: 'password_reset' },
    { ...delivery, recipientEmail: ' member@example.test' },
    {
      ...delivery,
      recipientEmail: 'member@example.test\r\nBcc: other@example.test',
    },
    { ...delivery, token: 'z'.repeat(43) },
    { ...delivery, userId: '../user' },
    { ...delivery, expiresAt: now },
    { ...delivery, expiresAt: '2026-10-07T00:00:00.001Z' },
    {
      ...delivery,
      purpose: 'email_change',
      expiresAt: '2026-10-06T00:15:00.001Z',
    },
    {
      ...delivery,
      purpose: 'account_delete',
      expiresAt: '2026-10-06T00:15:00.001Z',
    },
    { ...delivery, unexpected: 'field' },
  ])('refuses invalid delivery before encryption %j', async (value) => {
    const codec = createAccountMailCodec({
      activeKeyId: 'key1',
      keysJson: JSON.stringify({ key1: secret }),
    })
    await expect(codec.seal(value, Date.parse(now))).rejects.toThrow(
      /^Account lifecycle mail request is invalid\.$/,
    )
  })

  it.each(['account_delete', 'email_change'] as const)(
    'preserves exact 15 minute expiry for %s',
    async (purpose) => {
      const codec = createAccountMailCodec({
        activeKeyId: 'key1',
        keysJson: JSON.stringify({ key1: secret }),
      })
      const value = {
        ...delivery,
        purpose,
        expiresAt: '2026-10-06T00:15:00.000Z',
      }
      expect(
        await codec.open(await codec.seal(value, Date.parse(now))),
      ).toMatchObject({ status: 'decoded', delivery: value })
    },
  )

  it.each([
    '',
    '{}',
    '[]',
    'not-json',
    JSON.stringify({ key1: 'private-invalid-secret' }),
    JSON.stringify({ key1: 'z'.repeat(43) }),
    JSON.stringify({ key1: secret, key2: secret, key3: secret, key4: secret }),
  ])(
    'fails closed on invalid key ring without including its input',
    (keysJson) => {
      expect(() =>
        createAccountMailCodec({ activeKeyId: 'key1', keysJson }),
      ).toThrow(
        /^Account lifecycle mail encryption configuration is invalid\.$/,
      )
    },
  )
})
