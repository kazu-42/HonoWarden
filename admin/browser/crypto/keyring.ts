import { AdminError } from '../contracts'
import { decodeBase64, encodeBase64, equalBytes } from './encoding'
import { decryptType2, encryptType2, unwrapRsa, wrapRsa } from './enc-string'
import type { PasswordMaterial } from './kdf'

export type WrappedOrganization = { id: string; key: string }
export type WrappedAccount = {
  userKey: string
  publicKey: string
  privateKey: string
  organizations: WrappedOrganization[]
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export class Keyring {
  private userKey: Uint8Array<ArrayBuffer> | undefined
  private privateKey: Uint8Array<ArrayBuffer> | undefined
  private publicKey: string | undefined
  private organizations = new Map<string, Uint8Array<ArrayBuffer>>()

  async unlock(
    material: PasswordMaterial,
    account: WrappedAccount,
  ): Promise<void> {
    this.clear()
    let userKey: Uint8Array<ArrayBuffer> | undefined
    let privateKey: Uint8Array<ArrayBuffer> | undefined
    try {
      userKey = await decryptType2(material.stretchedKey, account.userKey)
      if (userKey.length !== 64)
        throw new AdminError('crypto', 'account_key_invalid')
      privateKey = await decryptType2(userKey, account.privateKey)
      const challenge = crypto.getRandomValues(new Uint8Array(64))
      const proof = await unwrapRsa(
        privateKey,
        await wrapRsa(account.publicKey, challenge),
      )
      const matches = equalBytes(proof, challenge)
      proof.fill(0)
      challenge.fill(0)
      if (!matches) throw new AdminError('crypto', 'account_key_invalid')
      this.userKey = userKey
      this.privateKey = privateKey
      this.publicKey = account.publicKey
      await this.replaceOrganizations(account.organizations)
    } catch {
      userKey?.fill(0)
      privateKey?.fill(0)
      this.clear()
      throw new AdminError('crypto', 'account_key_invalid')
    } finally {
      material.masterKey.fill(0)
      material.stretchedKey.fill(0)
      material.authenticationHash = ''
    }
  }

  async replaceOrganizations(
    organizations: WrappedOrganization[],
  ): Promise<void> {
    if (!this.privateKey) throw new AdminError('crypto', 'locked')
    const replacement = new Map<string, Uint8Array<ArrayBuffer>>()
    try {
      for (const organization of organizations) {
        if (replacement.has(organization.id))
          throw new AdminError('crypto', 'organization_key_invalid')
        replacement.set(
          organization.id,
          await unwrapRsa(this.privateKey, organization.key),
        )
      }
    } catch {
      for (const key of replacement.values()) key.fill(0)
      for (const key of this.organizations.values()) key.fill(0)
      this.organizations.clear()
      throw new AdminError('crypto', 'organization_key_invalid')
    }
    for (const key of this.organizations.values()) key.fill(0)
    this.organizations = replacement
  }

  async decryptName(orgId: string, encrypted: string): Promise<string> {
    const plaintext = await decryptType2(this.key(orgId), encrypted)
    try {
      return decoder.decode(plaintext)
    } catch {
      throw new AdminError('crypto', 'collection_name_invalid')
    } finally {
      plaintext.fill(0)
    }
  }

  async encryptName(orgId: string, name: string): Promise<string> {
    const plaintext = this.nameBytes(name)
    try {
      return await encryptType2(this.key(orgId), plaintext)
    } finally {
      plaintext.fill(0)
    }
  }

  async wrapMember(orgId: string, publicKey: string): Promise<string> {
    return wrapRsa(publicKey, this.key(orgId), 3)
  }

  async createOrganization(input: {
    name: string
    collectionName: string
    billingEmail?: string
  }): Promise<Record<string, unknown>> {
    if (!this.publicKey) throw new AdminError('crypto', 'locked')
    if (!input.name.trim() || input.name.length > 100)
      throw new AdminError('validation', 'organization_name_invalid')
    const plaintext = this.nameBytes(input.collectionName)
    const key = crypto.getRandomValues(new Uint8Array(64))
    let privateKey: Uint8Array<ArrayBuffer> | undefined
    try {
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
      privateKey = new Uint8Array(
        await crypto.subtle.exportKey('pkcs8', pair.privateKey),
      )
      return {
        name: input.name.trim(),
        billingEmail: input.billingEmail ?? null,
        planType: 0,
        key: await wrapRsa(this.publicKey, key, 3),
        keys: {
          publicKey: encodeBase64(
            new Uint8Array(
              await crypto.subtle.exportKey('spki', pair.publicKey),
            ),
          ),
          encryptedPrivateKey: await encryptType2(key, privateKey),
        },
        collectionName: await encryptType2(key, plaintext),
      }
    } finally {
      privateKey?.fill(0)
      key.fill(0)
      plaintext.fill(0)
    }
  }

  clear(): void {
    this.userKey?.fill(0)
    this.privateKey?.fill(0)
    for (const key of this.organizations.values()) key.fill(0)
    this.organizations.clear()
    this.userKey = undefined
    this.privateKey = undefined
    this.publicKey = undefined
  }

  private key(orgId: string): Uint8Array<ArrayBuffer> {
    const key = this.organizations.get(orgId)
    if (!key) throw new AdminError('crypto', 'organization_key_unavailable')
    return key
  }

  private nameBytes(name: string): Uint8Array<ArrayBuffer> {
    const value = encoder.encode(name)
    if (!name.trim() || value.length > 687) {
      value.fill(0)
      throw new AdminError('validation', 'collection_name_invalid')
    }
    return value
  }
}

export function validatePublicKey(value: string): void {
  decodeBase64(value, 4096)
}
