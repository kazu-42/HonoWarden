import { AdminError } from './errors'
import type { CryptoCommand } from './crypto-client'
import { derivePasswordMaterial, type PasswordMaterial } from './crypto/kdf'
import { Keyring } from './crypto/keyring'

const keyring = new Keyring()
let material: PasswordMaterial | undefined
let queue = Promise.resolve()
const scope = self as DedicatedWorkerGlobalScope
scope.addEventListener(
  'message',
  (event: MessageEvent<{ id: number; command: CryptoCommand }>) => {
    queue = queue.then(async () => {
      const { id, command } = event.data
      try {
        let value: unknown
        switch (command.action) {
          case 'derive':
            material?.masterKey.fill(0)
            material?.stretchedKey.fill(0)
            material = await derivePasswordMaterial(
              command.email,
              command.password,
              command.settings,
            )
            command.password = ''
            value = material.authenticationHash
            break
          case 'unlock':
            if (!material) throw new AdminError('crypto', 'locked')
            await keyring.unlock(material, command.account)
            material = undefined
            value = null
            break
          case 'organizations':
            value = await keyring.replaceOrganizations(command.organizations)
            break
          case 'decryptName':
            value = await keyring.decryptName(
              command.organizationId,
              command.encrypted,
            )
            break
          case 'encryptName':
            value = await keyring.encryptName(
              command.organizationId,
              command.name,
            )
            break
          case 'wrapMember':
            value = await keyring.wrapMember(
              command.organizationId,
              command.publicKey,
            )
            break
          case 'createOrganization':
            value = await keyring.createOrganization(command.input)
            break
        }
        scope.postMessage({ id, ok: true, value })
      } catch (error) {
        if (command.action === 'derive') command.password = ''
        scope.postMessage({
          id,
          ok: false,
          code: error instanceof AdminError ? error.code : 'crypto_unavailable',
        })
      }
    })
  },
)
