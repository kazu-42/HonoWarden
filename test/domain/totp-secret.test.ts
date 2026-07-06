import { describe, expect, it } from 'vitest'

import {
  decryptTotpSecret,
  encryptTotpSecret,
} from '../../src/domain/totp-secret'

describe('totp secret envelope', () => {
  it('encrypts setup secrets without embedding plaintext', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encrypted = await encryptTotpSecret('wrapping-secret', secret)

    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(encrypted).not.toContain(secret)
    await expect(decryptTotpSecret('wrapping-secret', encrypted)).resolves.toBe(
      secret,
    )
  })

  it('fails closed when the wrong wrapping secret is used', async () => {
    const encrypted = await encryptTotpSecret(
      'wrapping-secret',
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    )

    await expect(decryptTotpSecret('wrong-secret', encrypted)).resolves.toBe(
      null,
    )
  })

  it('rejects malformed encrypted values', async () => {
    await expect(
      decryptTotpSecret('wrapping-secret', 'plaintext-secret'),
    ).resolves.toBe(null)
  })
})
