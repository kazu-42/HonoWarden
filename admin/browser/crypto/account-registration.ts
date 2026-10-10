import { derivePasswordMaterial } from './kdf'
import { encryptType2 } from './enc-string'
import { encodeBase64 } from './encoding'

export type WrappedAccountRegistration = {
  masterPasswordHash: string
  userKey: string
  publicKey: string
  privateKey: string
}

// Called only inside the dedicated crypto Worker. Plaintext key material never
// enters the UI/session controller or a registration HTTP request.
export async function createWrappedAccount(
  email: string,
  password: string,
): Promise<WrappedAccountRegistration> {
  const material = await derivePasswordMaterial(email, password, {
    type: 0,
    iterations: 600000,
    memory: null,
    parallelism: null,
  })
  const userKey = crypto.getRandomValues(new Uint8Array(64))
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
      masterPasswordHash: material.authenticationHash,
      userKey: await encryptType2(material.stretchedKey, userKey),
      publicKey: encodeBase64(
        new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
      ),
      privateKey: await encryptType2(userKey, privateKey),
    }
  } finally {
    material.masterKey.fill(0)
    material.stretchedKey.fill(0)
    material.authenticationHash = ''
    userKey.fill(0)
    privateKey?.fill(0)
  }
}
