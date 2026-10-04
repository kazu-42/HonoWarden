import { createCipheriv, createHmac, pbkdf2Sync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { derivePasswordMaterial } from '../admin/browser/crypto/kdf'
import { decodeBase64, encodeBase64 } from '../admin/browser/crypto/encoding'
import {
  decryptType2,
  encryptType2,
  unwrapRsa,
  wrapRsa,
} from '../admin/browser/crypto/enc-string'

describe('browser crypto wire primitives', () => {
  it.each([
    {
      email: 'owner@example.invalid',
      password: 'HonoWarden public KDF vector 2026!',
      settings: {
        type: 0 as const,
        iterations: 600000,
        memory: null,
        parallelism: null,
      },
      master:
        'a331e8c24cf93444724b6bdb8f188bef000cbea64952513082a7d63077024b5d',
      hash: 'Y/O+HoV6qF+/+o5NjoRlGLbe6u55LHX3zHuYsA3fBgA=',
    },
    {
      email: 'owner@example.invalid',
      password: 'HonoWarden public KDF vector 2026!',
      settings: { type: 1 as const, iterations: 3, memory: 64, parallelism: 4 },
      master:
        '2563a43e547de91033e8090f6a13f4fb9168f31244e5cf900398a7e3030a4c9a',
      hash: '5ZrGAniIo/rpkupuYAzvs6c+2iKbjW6xR4mK9yjGzcg=',
    },
    {
      email: 'unicode@example.invalid',
      password: '公開テスト専用 password 2026!',
      settings: { type: 1 as const, iterations: 2, memory: 16, parallelism: 1 },
      master:
        '8cc5fad0e40ccfc885d0c55a56913c03bed126ea3c726f862b0ede99429aaac8',
      hash: 'LkDnggTdnY4Wj3arbGUeBr9VPGaUQtGJD1OqT/ayhS8=',
    },
  ])(
    'matches public pinned-SDK and independent primitive vectors $email/$settings.type',
    async ({ email, password, settings, master, hash }) => {
      const result = await derivePasswordMaterial(email, password, settings)
      expect(Buffer.from(result.masterKey).toString('hex')).toBe(master)
      expect(result.authenticationHash).toBe(hash)
    },
  )

  it('matches independent PBKDF2, one-iteration authentication and expand-only HKDF vectors', async () => {
    const password = ' Public vector 日本語 '
    const email = ' PERSON@EXAMPLE.TEST '
    const result = await derivePasswordMaterial(email, password, {
      type: 0,
      iterations: 5000,
      memory: null,
      parallelism: null,
    })
    const master = pbkdf2Sync(
      password,
      'person@example.test',
      5000,
      32,
      'sha256',
    )
    expect(Buffer.from(result.masterKey)).toEqual(master)
    expect(result.authenticationHash).toBe(
      pbkdf2Sync(master, password, 1, 32, 'sha256').toString('base64'),
    )
    expect(Buffer.from(result.stretchedKey)).toEqual(
      Buffer.concat([
        createHmac('sha256', master).update(Buffer.from('enc\x01')).digest(),
        createHmac('sha256', master).update(Buffer.from('mac\x01')).digest(),
      ]),
    )
    const changed = await derivePasswordMaterial(email, password.trim(), {
      type: 0,
      iterations: 5000,
      memory: null,
      parallelism: null,
    })
    expect(changed.authenticationHash).not.toBe(result.authenticationHash)
  })

  it('authenticates Type 2 before decrypting and rejects every changed component', async () => {
    const key = Uint8Array.from({ length: 64 }, (_, i) => i)
    const iv = Uint8Array.from({ length: 16 }, (_, i) => i + 32)
    const plaintext = new TextEncoder().encode('Public vector 日本語')
    const encrypted = await encryptType2(key, plaintext, iv)
    const independent = createCipheriv('aes-256-cbc', key.subarray(0, 32), iv)
    const ciphertext = Buffer.concat([
      independent.update(plaintext),
      independent.final(),
    ])
    const mac = createHmac('sha256', key.subarray(32))
      .update(Buffer.concat([iv, ciphertext]))
      .digest('base64')
    expect(encrypted).toBe(
      `2.${Buffer.from(iv).toString('base64')}|${ciphertext.toString('base64')}|${mac}`,
    )
    expect(await decryptType2(key, encrypted)).toEqual(plaintext)
    const parts = encrypted.slice(2).split('|')
    for (let i = 0; i < 3; i++) {
      const changed = [...parts]
      const bytes = decodeBase64(changed[i]!)
      bytes[0] = bytes[0]! ^ 1
      changed[i] = encodeBase64(bytes)
      await expect(
        decryptType2(key, `2.${changed.join('|')}`),
      ).rejects.toMatchObject({ code: 'encrypted_value_invalid' })
    }
    await expect(
      decryptType2(new Uint8Array(64), encrypted),
    ).rejects.toMatchObject({ code: 'encrypted_value_invalid' })
    await expect(decryptType2(key, encrypted + '|extra')).rejects.toMatchObject(
      { code: 'encrypted_value_invalid' },
    )
    expect(() => decodeBase64('YQ')).toThrow()
    expect(() => decodeBase64('YR==')).toThrow()
  })

  it('binds RSA envelope type to OAEP hash and rejects relabeled ciphertext', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    )
    const publicKey = encodeBase64(
      new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
    )
    const privateKey = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey),
    )
    const orgKey = Uint8Array.from({ length: 64 }, (_, i) => i)
    for (const type of [3, 4] as const) {
      const encrypted = await wrapRsa(publicKey, orgKey, type)
      expect(await unwrapRsa(privateKey, encrypted)).toEqual(orgKey)
      const relabeled = `${type === 3 ? 4 : 3}.${encrypted.slice(2)}`
      await expect(unwrapRsa(privateKey, relabeled)).rejects.toMatchObject({
        code: 'encrypted_value_invalid',
      })
    }
  })
})
