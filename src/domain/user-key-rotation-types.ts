import type {
  AccountCredentialGeneration,
  AccountCredentialKdf,
} from './account-credentials'

export type UserKeyRotationFolder = {
  id: string
  name: string
}

export type UserKeyRotationAttachment = {
  id: string
  fileName: string
  attachmentKey: string
  lastKnownRevisionDate: string
}

export type UserKeyRotationCipherMetadata = {
  login: {
    passwordRevisionDate: string | null
    autofillOnPageLoad: boolean | null
    uriMatches: (number | null)[]
    fido2CreationDates: (string | null)[]
  } | null
  secureNoteType: number | null
  fields: {
    type: number | null
    linkedId: number | null
  }[]
  passwordHistoryDates: (string | null)[]
}

export type UserKeyRotationCipher = {
  id: string
  encryptedFor: string
  organizationId: null
  folderId: string | null
  type: 1 | 2
  favorite: boolean
  reprompt: 0 | 1
  archivedDate: string | null
  lastKnownRevisionDate: string
  metadata: UserKeyRotationCipherMetadata
  encryptedJson: string
  attachments: UserKeyRotationAttachment[]
}

export type UserKeyRotationTrustedDevice = {
  id: string
  encryptedPublicKey: string
  encryptedUserKey: string
}

export type UserKeyRotationRequest = {
  oldMasterKeyAuthenticationHash: string
  nextMasterKeyAuthenticationHash: string
  nextUserKey: string
  credentialMetadata: {
    salt: string
    kdf: AccountCredentialKdf
  }
  accountKeys: {
    publicKey: string
    wrappedPrivateKey: string
  }
  folders: UserKeyRotationFolder[]
  ciphers: UserKeyRotationCipher[]
  trustedDevices: UserKeyRotationTrustedDevice[]
}

export type UserKeyRotationParseResult =
  ({ ok: true } & UserKeyRotationRequest) | { ok: false }

export type UserKeyRotationCredentialGeneration =
  AccountCredentialGeneration & {
    userKey: string | null
    publicKey: string | null
    privateKey: string | null
  }
