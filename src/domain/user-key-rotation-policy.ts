import { accountCredentialPolicy } from './account-credentials'
import { accountKeyPolicy } from './account-keys'

export const userKeyRotationPolicy = {
  authenticationHashMaxLength: 300,
  wrappedUserKeyMaxLength: accountCredentialPolicy.wrappedUserKeyMaxLength,
  publicKeyMaxLength: accountKeyPolicy.publicKeyMaxLength,
  wrappedPrivateKeyMaxLength: accountKeyPolicy.wrappedPrivateKeyMaxLength,
  emailMaxLength: 256,
  idMaxLength: 36,
  folderNameMaxLength: 1_000,
  cipherOpaqueValueMaxLength: 16_384,
  cipherJsonMaxLength: 500_000,
  requestJsonMaxLength: 2_000_000,
  foldersMax: 1_000,
  ciphersMax: 1_000,
  trustedDevicesMax: 100,
  attachmentsPerCipherMax: 100,
  cipherFieldsMax: 100,
  cipherUrisMax: 100,
  cipherPasswordHistoryMax: 100,
  fido2CredentialsMax: 100,
} as const
