import { describe, expect, it } from 'vitest'
import { Keyring } from '../admin/browser/crypto/keyring'
import { derivePasswordMaterial } from '../admin/browser/crypto/kdf'
import {
  decryptType2,
  encryptType2,
  unwrapRsa,
} from '../admin/browser/crypto/enc-string'
import { decodeBase64, encodeBase64 } from '../admin/browser/crypto/encoding'

async function fixture() {
  const material = await derivePasswordMaterial(
    'person@example.test',
    'Public vector password',
    { type: 0, iterations: 5000, memory: null, parallelism: null },
  )
  const userKey = crypto.getRandomValues(new Uint8Array(64))
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
  const privateKey = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey),
  )
  const publicKey = encodeBase64(
    new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
  )
  const ring = new Keyring()
  await ring.unlock(material, {
    userKey: await encryptType2(material.stretchedKey, userKey),
    privateKey: await encryptType2(userKey, privateKey),
    publicKey,
    organizations: [],
  })
  return { ring, privateKey, userKey, publicKey }
}

describe('browser encrypted provisioning', () => {
  it('creates envelopes that an independent owner private key can decrypt and validates org pair/name', async () => {
    const { ring, privateKey } = await fixture()
    const payload = await ring.createOrganization({
      name: 'Public Org',
      collectionName: '公開コレクション',
    })
    const orgKey = await unwrapRsa(privateKey, payload.key as string)
    const keys = payload.keys as {
      publicKey: string
      encryptedPrivateKey: string
    }
    const orgPrivate = await decryptType2(orgKey, keys.encryptedPrivateKey)
    const importedPublic = await crypto.subtle.importKey(
      'spki',
      decodeBase64(keys.publicKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    )
    const importedPrivate = await crypto.subtle.importKey(
      'pkcs8',
      orgPrivate,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    )
    const challenge = new TextEncoder().encode(
      'Public pair validation challenge',
    )
    const encrypted = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      importedPublic,
      challenge,
    )
    expect(
      new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'RSA-OAEP' },
          importedPrivate,
          encrypted,
        ),
      ),
    ).toEqual(challenge)
    expect(
      new TextDecoder().decode(
        await decryptType2(orgKey, payload.collectionName as string),
      ),
    ).toBe('公開コレクション')
    await ring.replaceOrganizations([{ id: 'org', key: payload.key as string }])
    expect(
      await ring.decryptName('org', payload.collectionName as string),
    ).toBe('公開コレクション')
    const longest = await ring.encryptName('org', '界'.repeat(229))
    expect(longest.length).toBe(992)
    await expect(
      ring.encryptName('org', '界'.repeat(229) + 'x'),
    ).rejects.toMatchObject({ code: 'collection_name_invalid' })
    await expect(
      ring.replaceOrganizations([{ id: 'org', key: '3.invalid' }]),
    ).rejects.toMatchObject({ kind: 'crypto' })
    await expect(
      ring.decryptName('org', payload.collectionName as string),
    ).rejects.toMatchObject({ code: 'organization_key_unavailable' })
    await ring.replaceOrganizations([{ id: 'org', key: payload.key as string }])
    ring.clear()
    await expect(
      ring.decryptName('org', payload.collectionName as string),
    ).rejects.toMatchObject({ code: 'organization_key_unavailable' })
  })

  it('rejects a public/private mismatch before allowing org operations', async () => {
    const { privateKey, userKey, publicKey } = await fixture()
    const other = await fixture()
    const material = await derivePasswordMaterial(
      'person@example.test',
      'Public vector password',
      { type: 0, iterations: 5000, memory: null, parallelism: null },
    )
    const ring = new Keyring()
    await expect(
      ring.unlock(material, {
        userKey: await encryptType2(material.stretchedKey, userKey),
        privateKey: await encryptType2(userKey, privateKey),
        publicKey: other.publicKey,
        organizations: [],
      }),
    ).rejects.toMatchObject({ code: 'account_key_invalid' })
    expect(publicKey).not.toBe(other.publicKey)
    await expect(
      ring.createOrganization({
        name: 'Public Org',
        collectionName: 'Public Name',
      }),
    ).rejects.toMatchObject({ code: 'locked' })
    expect(material.masterKey.every((byte) => byte === 0)).toBe(true)
    expect(material.stretchedKey.every((byte) => byte === 0)).toBe(true)
    other.ring.clear()
  })
})
