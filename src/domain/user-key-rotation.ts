import {
  accountCredentialKdfFromStoredGeneration,
  type AccountCredentialKdf,
} from './account-credentials'
import { classifyAccountKeyState } from './account-keys'
import { parseUserKeyRotationCiphers } from './user-key-rotation-cipher'
import {
  constantTimeEqual,
  equalKdf,
  hasOnlyAliasedFields,
  isAbsentNullOrEmpty,
  isAbsentOrNull,
  isEmailSalt,
  isKdfWithinPolicy,
  isPlainObject,
  isRequiredEmptyArray,
  parseNullableIntegerField,
  parseOpaqueString,
  parseOptionalOpaqueField,
  parseRequiredIdField,
  parseRequiredIntegerField,
  parseRequiredOpaqueField,
  readRequiredArray,
  readRequiredObject,
  serializedLength,
} from './user-key-rotation-input'
import { userKeyRotationPolicy } from './user-key-rotation-policy'
import type {
  UserKeyRotationCipher,
  UserKeyRotationCredentialGeneration,
  UserKeyRotationFolder,
  UserKeyRotationParseResult,
  UserKeyRotationRequest,
  UserKeyRotationTrustedDevice,
} from './user-key-rotation-types'

export { userKeyRotationPolicy } from './user-key-rotation-policy'
export type {
  UserKeyRotationAttachment,
  UserKeyRotationCipher,
  UserKeyRotationCipherMetadata,
  UserKeyRotationCredentialGeneration,
  UserKeyRotationFolder,
  UserKeyRotationParseResult,
  UserKeyRotationRequest,
  UserKeyRotationTrustedDevice,
} from './user-key-rotation-types'

const rootFields = [
  'oldMasterKeyAuthenticationHash',
  'accountUnlockData',
  'accountKeys',
  'accountData',
] as const

const unlockFields = [
  'masterPasswordUnlockData',
  'emergencyAccessUnlockData',
  'organizationAccountRecoveryUnlockData',
  'passkeyUnlockData',
  'deviceKeyUnlockData',
  'v2UpgradeToken',
] as const

const masterPasswordFields = [
  'kdfType',
  'kdfIterations',
  'kdfMemory',
  'kdfParallelism',
  'email',
  'masterKeyAuthenticationHash',
  'masterKeyEncryptedUserKey',
  'masterPasswordHint',
  'masterPasswordSalt',
] as const

const accountKeyFields = [
  'userKeyEncryptedAccountPrivateKey',
  'accountPublicKey',
  'publicKeyEncryptionKeyPair',
  'signatureKeyPair',
  'securityState',
] as const

const publicKeyPairFields = [
  'wrappedPrivateKey',
  'publicKey',
  'signedPublicKey',
] as const

const accountDataFields = ['ciphers', 'folders', 'sends'] as const
const folderFields = ['id', 'name'] as const
const trustedDeviceFields = [
  'deviceId',
  'encryptedPublicKey',
  'encryptedUserKey',
] as const

export function parseUserKeyRotationBody(
  body: unknown,
): UserKeyRotationParseResult {
  if (
    !isPlainObject(body) ||
    !hasOnlyAliasedFields(body, rootFields) ||
    serializedLength(body) > userKeyRotationPolicy.requestJsonMaxLength
  ) {
    return { ok: false }
  }

  const oldMasterKeyAuthenticationHash = parseRequiredOpaqueField(
    body,
    'oldMasterKeyAuthenticationHash',
    userKeyRotationPolicy.authenticationHashMaxLength,
  )
  const unlockData = readRequiredObject(body, 'accountUnlockData')
  const accountKeys = readRequiredObject(body, 'accountKeys')
  const accountData = readRequiredObject(body, 'accountData')
  if (
    !oldMasterKeyAuthenticationHash ||
    !unlockData ||
    !accountKeys ||
    !accountData
  ) {
    return { ok: false }
  }

  const parsedUnlockData = parseUnlockData(unlockData)
  const parsedAccountKeys = parseAccountKeys(accountKeys)
  const parsedAccountData = parseAccountData(accountData)
  if (!parsedUnlockData || !parsedAccountKeys || !parsedAccountData) {
    return { ok: false }
  }

  return {
    ok: true,
    oldMasterKeyAuthenticationHash,
    ...parsedUnlockData.masterPassword,
    accountKeys: parsedAccountKeys,
    folders: parsedAccountData.folders,
    ciphers: parsedAccountData.ciphers,
    trustedDevices: parsedUnlockData.trustedDevices,
  }
}

export function matchesUserKeyRotationCredentialGeneration(
  request: UserKeyRotationRequest,
  generation: UserKeyRotationCredentialGeneration,
): boolean {
  const storedKdf = accountCredentialKdfFromStoredGeneration(generation)
  const accountKeyState = classifyAccountKeyState(generation)
  const currentUserKey = parseOpaqueString(
    generation.userKey,
    userKeyRotationPolicy.wrappedUserKeyMaxLength,
  )
  if (!storedKdf || accountKeyState.status !== 'complete' || !currentUserKey) {
    return false
  }

  return (
    request.credentialMetadata.salt === generation.emailNormalized &&
    equalKdf(request.credentialMetadata.kdf, storedKdf) &&
    constantTimeEqual(
      request.accountKeys.publicKey,
      accountKeyState.keyPair.publicKey,
    ) &&
    !constantTimeEqual(request.nextUserKey, currentUserKey) &&
    !constantTimeEqual(
      request.accountKeys.wrappedPrivateKey,
      accountKeyState.keyPair.wrappedPrivateKey,
    )
  )
}

function parseUnlockData(value: Record<string, unknown>): {
  masterPassword: Pick<
    UserKeyRotationRequest,
    'nextMasterKeyAuthenticationHash' | 'nextUserKey' | 'credentialMetadata'
  >
  trustedDevices: UserKeyRotationTrustedDevice[]
} | null {
  if (
    !hasOnlyAliasedFields(value, unlockFields) ||
    !isRequiredEmptyArray(value, 'emergencyAccessUnlockData') ||
    !isRequiredEmptyArray(value, 'organizationAccountRecoveryUnlockData') ||
    !isRequiredEmptyArray(value, 'passkeyUnlockData') ||
    !isAbsentOrNull(value, 'v2UpgradeToken')
  ) {
    return null
  }

  const masterPassword = readRequiredObject(value, 'masterPasswordUnlockData')
  const devices = readRequiredArray(value, 'deviceKeyUnlockData')
  if (
    !masterPassword ||
    !devices ||
    devices.length > userKeyRotationPolicy.trustedDevicesMax
  ) {
    return null
  }

  const parsedMasterPassword = parseMasterPasswordData(masterPassword)
  const trustedDevices = parseTrustedDevices(devices)
  return parsedMasterPassword && trustedDevices
    ? { masterPassword: parsedMasterPassword, trustedDevices }
    : null
}

function parseMasterPasswordData(
  value: Record<string, unknown>,
): Pick<
  UserKeyRotationRequest,
  'nextMasterKeyAuthenticationHash' | 'nextUserKey' | 'credentialMetadata'
> | null {
  if (!hasOnlyAliasedFields(value, masterPasswordFields)) {
    return null
  }

  const kdfType = parseRequiredIntegerField(value, 'kdfType')
  const iterations = parseRequiredIntegerField(value, 'kdfIterations')
  const memory = parseNullableIntegerField(value, 'kdfMemory')
  const parallelism = parseNullableIntegerField(value, 'kdfParallelism')
  const email = parseRequiredOpaqueField(
    value,
    'email',
    userKeyRotationPolicy.emailMaxLength,
  )
  const nextMasterKeyAuthenticationHash = parseRequiredOpaqueField(
    value,
    'masterKeyAuthenticationHash',
    userKeyRotationPolicy.authenticationHashMaxLength,
  )
  const nextUserKey = parseRequiredOpaqueField(
    value,
    'masterKeyEncryptedUserKey',
    userKeyRotationPolicy.wrappedUserKeyMaxLength,
  )
  const salt = parseOptionalOpaqueField(
    value,
    'masterPasswordSalt',
    userKeyRotationPolicy.emailMaxLength,
  )
  if (
    (kdfType !== 0 && kdfType !== 1) ||
    iterations === null ||
    memory === undefined ||
    parallelism === undefined ||
    !email ||
    !isEmailSalt(email) ||
    !nextMasterKeyAuthenticationHash ||
    !nextUserKey ||
    !salt.valid ||
    (salt.value !== null && salt.value !== email) ||
    !isAbsentNullOrEmpty(value, 'masterPasswordHint')
  ) {
    return null
  }

  const kdf: AccountCredentialKdf = {
    kdfType,
    iterations,
    memory,
    parallelism,
  }
  if (!isKdfWithinPolicy(kdf)) {
    return null
  }

  return {
    nextMasterKeyAuthenticationHash,
    nextUserKey,
    credentialMetadata: {
      salt: salt.value ?? email,
      kdf,
    },
  }
}

function parseAccountKeys(value: Record<string, unknown>): {
  publicKey: string
  wrappedPrivateKey: string
} | null {
  if (!hasOnlyAliasedFields(value, accountKeyFields)) {
    return null
  }

  const legacyPrivateKey = parseRequiredOpaqueField(
    value,
    'userKeyEncryptedAccountPrivateKey',
    userKeyRotationPolicy.wrappedPrivateKeyMaxLength,
  )
  const legacyPublicKey = parseRequiredOpaqueField(
    value,
    'accountPublicKey',
    userKeyRotationPolicy.publicKeyMaxLength,
  )
  const pair = readRequiredObject(value, 'publicKeyEncryptionKeyPair')
  if (
    !legacyPrivateKey ||
    !legacyPublicKey ||
    !pair ||
    !isAbsentOrNull(value, 'signatureKeyPair') ||
    !isAbsentOrNull(value, 'securityState') ||
    !hasOnlyAliasedFields(pair, publicKeyPairFields) ||
    !isAbsentOrNull(pair, 'signedPublicKey')
  ) {
    return null
  }

  const wrappedPrivateKey = parseRequiredOpaqueField(
    pair,
    'wrappedPrivateKey',
    userKeyRotationPolicy.wrappedPrivateKeyMaxLength,
  )
  const publicKey = parseRequiredOpaqueField(
    pair,
    'publicKey',
    userKeyRotationPolicy.publicKeyMaxLength,
  )
  if (
    !wrappedPrivateKey ||
    !publicKey ||
    !constantTimeEqual(wrappedPrivateKey, legacyPrivateKey) ||
    !constantTimeEqual(publicKey, legacyPublicKey)
  ) {
    return null
  }

  return { publicKey, wrappedPrivateKey }
}

function parseAccountData(value: Record<string, unknown>): {
  folders: UserKeyRotationFolder[]
  ciphers: UserKeyRotationCipher[]
} | null {
  if (
    !hasOnlyAliasedFields(value, accountDataFields) ||
    !isRequiredEmptyArray(value, 'sends')
  ) {
    return null
  }

  const rawFolders = readRequiredArray(value, 'folders')
  const rawCiphers = readRequiredArray(value, 'ciphers')
  if (
    !rawFolders ||
    rawFolders.length > userKeyRotationPolicy.foldersMax ||
    !rawCiphers ||
    rawCiphers.length > userKeyRotationPolicy.ciphersMax
  ) {
    return null
  }

  const folders = parseFolders(rawFolders)
  const ciphers = parseUserKeyRotationCiphers(rawCiphers)
  if (!folders || !ciphers) {
    return null
  }

  const folderIds = new Set(folders.map((folder) => folder.id))
  if (
    ciphers.some(
      (cipher) => cipher.folderId !== null && !folderIds.has(cipher.folderId),
    )
  ) {
    return null
  }

  return { folders, ciphers }
}

function parseFolders(
  values: readonly unknown[],
): UserKeyRotationFolder[] | null {
  const folders: UserKeyRotationFolder[] = []
  const seenIds = new Set<string>()
  for (const value of values) {
    if (!isPlainObject(value) || !hasOnlyAliasedFields(value, folderFields)) {
      return null
    }
    const id = parseRequiredIdField(value, 'id')
    const name = parseRequiredOpaqueField(
      value,
      'name',
      userKeyRotationPolicy.folderNameMaxLength,
    )
    if (!id || !name || seenIds.has(id)) {
      return null
    }
    seenIds.add(id)
    folders.push({ id, name })
  }
  return folders
}

function parseTrustedDevices(
  values: readonly unknown[],
): UserKeyRotationTrustedDevice[] | null {
  const devices: UserKeyRotationTrustedDevice[] = []
  const seenIds = new Set<string>()
  for (const value of values) {
    if (
      !isPlainObject(value) ||
      !hasOnlyAliasedFields(value, trustedDeviceFields)
    ) {
      return null
    }
    const id = parseRequiredIdField(value, 'deviceId')
    const encryptedPublicKey = parseRequiredOpaqueField(
      value,
      'encryptedPublicKey',
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    const encryptedUserKey = parseRequiredOpaqueField(
      value,
      'encryptedUserKey',
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    if (!id || !encryptedPublicKey || !encryptedUserKey || seenIds.has(id)) {
      return null
    }
    seenIds.add(id)
    devices.push({ id, encryptedPublicKey, encryptedUserKey })
  }
  return devices
}
