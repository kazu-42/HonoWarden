import {
  allAbsentOrNull,
  hasOnlyAliasedFields,
  isAbsentOrNull,
  isPlainObject,
  parseId,
  parseNullableDateField,
  parseNullableIdField,
  parseNullableIntegerField,
  parseOpaqueString,
  parseOptionalBooleanField,
  parseOptionalOpaqueField,
  parseRequiredBooleanField,
  parseRequiredDateField,
  parseRequiredIdField,
  parseRequiredIntegerField,
  parseRequiredOpaqueField,
  readAliasedValue,
  readOptionalArray,
  readRequiredObject,
  sameStrings,
  serializedLength,
  serializeObject,
} from './user-key-rotation-input'
import { userKeyRotationPolicy } from './user-key-rotation-policy'
import type {
  UserKeyRotationAttachment,
  UserKeyRotationCipher,
  UserKeyRotationCipherMetadata,
} from './user-key-rotation-types'

const cipherFields = [
  'id',
  'encryptedFor',
  'type',
  'folderId',
  'organizationId',
  'name',
  'notes',
  'favorite',
  'login',
  'secureNote',
  'card',
  'identity',
  'sshKey',
  'bankAccount',
  'driversLicense',
  'passport',
  'fields',
  'passwordHistory',
  'attachments',
  'attachments2',
  'lastKnownRevisionDate',
  'archivedDate',
  'reprompt',
  'key',
] as const

const loginFields = [
  'uris',
  'username',
  'password',
  'passwordRevisionDate',
  'totp',
  'autofillOnPageLoad',
  'fido2Credentials',
] as const

const uriFields = ['uri', 'match', 'uriChecksum'] as const
const fieldFields = ['type', 'name', 'value', 'linkedId'] as const
const passwordHistoryFields = ['lastUsedDate', 'password'] as const
const secureNoteFields = ['type'] as const
const attachmentFields = ['fileName', 'key', 'lastKnownRevisionDate'] as const
const fido2CredentialFields = [
  'credentialId',
  'keyType',
  'keyAlgorithm',
  'keyCurve',
  'keyValue',
  'rpId',
  'rpName',
  'counter',
  'userHandle',
  'userName',
  'userDisplayName',
  'discoverable',
  'creationDate',
] as const

export function parseUserKeyRotationCiphers(
  values: readonly unknown[],
): UserKeyRotationCipher[] | null {
  const ciphers: UserKeyRotationCipher[] = []
  const seenCipherIds = new Set<string>()
  const seenAttachmentIds = new Set<string>()
  for (const value of values) {
    const cipher = parseCipher(value)
    if (!cipher || seenCipherIds.has(cipher.id)) {
      return null
    }
    for (const attachment of cipher.attachments) {
      if (seenAttachmentIds.has(attachment.id)) {
        return null
      }
      seenAttachmentIds.add(attachment.id)
    }
    seenCipherIds.add(cipher.id)
    ciphers.push(cipher)
  }
  return ciphers
}

export type StoredUserKeyRotationCipherMetadataStatus =
  'matches' | 'mismatch' | 'invalid'

export function classifyStoredUserKeyRotationCipherMetadata(
  cipher: UserKeyRotationCipher,
  encryptedJson: string,
): StoredUserKeyRotationCipherMetadataStatus {
  if (encryptedJson.length > userKeyRotationPolicy.cipherJsonMaxLength) {
    return 'invalid'
  }

  let value: unknown
  try {
    value = JSON.parse(encryptedJson) as unknown
  } catch {
    return 'invalid'
  }
  if (!isPlainObject(value)) {
    return 'invalid'
  }

  const type = parseRequiredIntegerField(value, 'type')
  const folderId = parseNullableIdField(value, 'folderId')
  const organizationId = readAliasedValue(value, 'organizationId')
  const favoriteValue = readAliasedValue(value, 'favorite')
  const favorite = favoriteValue.present
    ? parseRequiredBooleanField(value, 'favorite')
    : false
  const repromptValue = readAliasedValue(value, 'reprompt')
  const reprompt = repromptValue.present
    ? parseRequiredIntegerField(value, 'reprompt')
    : 0
  const archivedDate = parseNullableDateField(value, 'archivedDate')
  const metadata = buildCipherMetadata(value, cipher.type)
  if (
    type === null ||
    folderId === undefined ||
    !organizationId.valid ||
    (organizationId.present &&
      organizationId.value !== null &&
      organizationId.value !== '') ||
    favorite === null ||
    reprompt === null ||
    archivedDate === undefined ||
    !metadata ||
    !validateCipherStructuredData(value, cipher.type)
  ) {
    return 'invalid'
  }

  const rotatedEncryptedValues = parseCipherEncryptedValues(
    cipher.encryptedJson,
    cipher.type,
  )
  const currentEncryptedValues = buildCipherEncryptedValues(value, cipher.type)
  return rotatedEncryptedValues !== null &&
    currentEncryptedValues !== null &&
    allEncryptedValuesRewrapped(
      currentEncryptedValues,
      rotatedEncryptedValues,
    ) &&
    type === cipher.type &&
    folderId === cipher.folderId &&
    favorite === cipher.favorite &&
    reprompt === cipher.reprompt &&
    archivedDate === cipher.archivedDate &&
    JSON.stringify(metadata) === JSON.stringify(cipher.metadata)
    ? 'matches'
    : 'mismatch'
}

function parseCipherEncryptedValues(
  encryptedJson: string,
  type: 1 | 2,
): (string | null)[] | null {
  let value: unknown
  try {
    value = JSON.parse(encryptedJson) as unknown
  } catch {
    return null
  }
  return isPlainObject(value) ? buildCipherEncryptedValues(value, type) : null
}

function buildCipherEncryptedValues(
  value: Record<string, unknown>,
  type: 1 | 2,
): (string | null)[] | null {
  const name = parseRequiredOpaqueField(
    value,
    'name',
    userKeyRotationPolicy.cipherOpaqueValueMaxLength,
  )
  const values: (string | null)[] = []
  if (
    !name ||
    !appendOptionalEncryptedValues(values, value, ['notes', 'key'])
  ) {
    return null
  }
  values.push(name)

  if (type === 1) {
    const login = readRequiredObject(value, 'login')
    if (
      !login ||
      !appendOptionalEncryptedValues(values, login, [
        'username',
        'password',
        'totp',
      ])
    ) {
      return null
    }

    const uris = readOptionalArray(login, 'uris')
    if (!uris.valid) return null
    for (const uri of uris.value) {
      if (
        !isPlainObject(uri) ||
        !appendOptionalEncryptedValues(values, uri, ['uri', 'uriChecksum'])
      ) {
        return null
      }
    }

    const credentials = readOptionalArray(login, 'fido2Credentials')
    if (!credentials.valid) return null
    for (const credential of credentials.value) {
      if (
        !isPlainObject(credential) ||
        !appendOptionalEncryptedValues(
          values,
          credential,
          fido2CredentialFields.filter((field) => field !== 'creationDate'),
        )
      ) {
        return null
      }
    }
  }

  const fields = readOptionalArray(value, 'fields')
  if (!fields.valid) return null
  for (const field of fields.value) {
    if (
      !isPlainObject(field) ||
      !appendOptionalEncryptedValues(values, field, ['name', 'value'])
    ) {
      return null
    }
  }

  const passwordHistory = readOptionalArray(value, 'passwordHistory')
  if (!passwordHistory.valid) return null
  for (const item of passwordHistory.value) {
    if (
      !isPlainObject(item) ||
      !appendOptionalEncryptedValues(values, item, ['password'])
    ) {
      return null
    }
  }

  return values
}

function appendOptionalEncryptedValues(
  target: (string | null)[],
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  for (const field of fields) {
    const parsed = parseOptionalOpaqueField(
      value,
      field,
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    if (!parsed.valid) return false
    target.push(parsed.value)
  }
  return true
}

function allEncryptedValuesRewrapped(
  current: readonly (string | null)[],
  rotated: readonly (string | null)[],
): boolean {
  return (
    current.length === rotated.length &&
    current.every((value, index) => {
      const nextValue = rotated[index]
      return value === null
        ? nextValue === null
        : typeof nextValue === 'string' && nextValue !== value
    })
  )
}

function parseCipher(value: unknown): UserKeyRotationCipher | null {
  if (
    !isPlainObject(value) ||
    !hasOnlyAliasedFields(value, cipherFields) ||
    serializedLength(value) > userKeyRotationPolicy.cipherJsonMaxLength
  ) {
    return null
  }

  const id = parseRequiredIdField(value, 'id')
  const encryptedFor = parseRequiredIdField(value, 'encryptedFor')
  const type = parseRequiredIntegerField(value, 'type')
  const folderId = parseNullableIdField(value, 'folderId')
  const organizationId = readAliasedValue(value, 'organizationId')
  const favorite = parseRequiredBooleanField(value, 'favorite')
  const lastKnownRevisionDate = parseRequiredDateField(
    value,
    'lastKnownRevisionDate',
  )
  const archivedDate = parseNullableDateField(value, 'archivedDate')
  const name = parseRequiredOpaqueField(
    value,
    'name',
    userKeyRotationPolicy.cipherOpaqueValueMaxLength,
  )
  const notes = parseOptionalOpaqueField(
    value,
    'notes',
    userKeyRotationPolicy.cipherOpaqueValueMaxLength,
  )
  const key = parseOptionalOpaqueField(
    value,
    'key',
    userKeyRotationPolicy.cipherOpaqueValueMaxLength,
  )
  const reprompt = parseRequiredIntegerField(value, 'reprompt')
  if (
    !id ||
    !encryptedFor ||
    (type !== 1 && type !== 2) ||
    folderId === undefined ||
    !organizationId.valid ||
    (organizationId.present &&
      organizationId.value !== null &&
      organizationId.value !== '') ||
    favorite === null ||
    !lastKnownRevisionDate ||
    archivedDate === undefined ||
    !name ||
    !notes.valid ||
    !key.valid ||
    (reprompt !== 0 && reprompt !== 1) ||
    !validateCipherStructuredData(value, type)
  ) {
    return null
  }

  const attachments = parseAttachments(value, lastKnownRevisionDate)
  const metadata = buildCipherMetadata(value, type)
  const encryptedJson = serializeObject(value)
  if (!attachments || !metadata || !encryptedJson) {
    return null
  }

  return {
    id,
    encryptedFor,
    organizationId: null,
    folderId,
    type,
    favorite,
    reprompt,
    archivedDate,
    lastKnownRevisionDate,
    metadata,
    encryptedJson,
    attachments,
  }
}

function buildCipherMetadata(
  value: Record<string, unknown>,
  type: 1 | 2,
): UserKeyRotationCipherMetadata | null {
  const fields = readOptionalArray(value, 'fields')
  const history = readOptionalArray(value, 'passwordHistory')
  if (!fields.valid || !history.valid) {
    return null
  }

  const fieldMetadata = fields.value.map((field) => {
    if (!isPlainObject(field)) {
      return null
    }
    const fieldType = parseNullableIntegerField(field, 'type')
    const linkedId = parseNullableIntegerField(field, 'linkedId')
    return fieldType === undefined || linkedId === undefined
      ? null
      : { type: fieldType, linkedId }
  })
  const passwordHistoryDates = history.value.map((item) =>
    isPlainObject(item)
      ? parseNullableDateField(item, 'lastUsedDate')
      : undefined,
  )
  if (
    fieldMetadata.some((field) => field === null) ||
    passwordHistoryDates.some((date) => date === undefined)
  ) {
    return null
  }

  if (type === 2) {
    const secureNote = readRequiredObject(value, 'secureNote')
    const secureNoteType = secureNote
      ? parseRequiredIntegerField(secureNote, 'type')
      : null
    return secureNoteType === null
      ? null
      : {
          login: null,
          secureNoteType,
          fields: fieldMetadata as UserKeyRotationCipherMetadata['fields'],
          passwordHistoryDates: passwordHistoryDates as (string | null)[],
        }
  }

  const login = readRequiredObject(value, 'login')
  if (!login) {
    return null
  }
  const uris = readOptionalArray(login, 'uris')
  const credentials = readOptionalArray(login, 'fido2Credentials')
  const passwordRevisionDate = parseNullableDateField(
    login,
    'passwordRevisionDate',
  )
  const autofillOnPageLoad = parseOptionalBooleanField(
    login,
    'autofillOnPageLoad',
  )
  if (
    !uris.valid ||
    !credentials.valid ||
    passwordRevisionDate === undefined ||
    !autofillOnPageLoad.valid
  ) {
    return null
  }
  const uriMatches = uris.value.map((uri) =>
    isPlainObject(uri) ? parseNullableIntegerField(uri, 'match') : undefined,
  )
  const fido2CreationDates = credentials.value.map((credential) =>
    isPlainObject(credential)
      ? parseNullableDateField(credential, 'creationDate')
      : undefined,
  )
  if (
    uriMatches.some((match) => match === undefined) ||
    fido2CreationDates.some((date) => date === undefined)
  ) {
    return null
  }

  return {
    login: {
      passwordRevisionDate,
      autofillOnPageLoad: autofillOnPageLoad.value,
      uriMatches: uriMatches as (number | null)[],
      fido2CreationDates: fido2CreationDates as (string | null)[],
    },
    secureNoteType: null,
    fields: fieldMetadata as UserKeyRotationCipherMetadata['fields'],
    passwordHistoryDates: passwordHistoryDates as (string | null)[],
  }
}

function validateCipherStructuredData(
  value: Record<string, unknown>,
  type: 1 | 2,
): boolean {
  if (
    !validateOptionalFields(value) ||
    !validatePasswordHistory(value) ||
    !allAbsentOrNull(value, [
      'card',
      'identity',
      'sshKey',
      'bankAccount',
      'driversLicense',
      'passport',
    ])
  ) {
    return false
  }

  if (type === 1) {
    return (
      isAbsentOrNull(value, 'secureNote') &&
      validateLogin(readRequiredObject(value, 'login'))
    )
  }

  const secureNote = readRequiredObject(value, 'secureNote')
  return (
    isAbsentOrNull(value, 'login') &&
    secureNote !== null &&
    hasOnlyAliasedFields(secureNote, secureNoteFields) &&
    parseRequiredIntegerField(secureNote, 'type') !== null
  )
}

function validateLogin(value: Record<string, unknown> | null): boolean {
  if (!value || !hasOnlyAliasedFields(value, loginFields)) {
    return false
  }

  for (const field of ['username', 'password', 'totp'] as const) {
    if (
      !parseOptionalOpaqueField(
        value,
        field,
        userKeyRotationPolicy.cipherOpaqueValueMaxLength,
      ).valid
    ) {
      return false
    }
  }
  if (
    parseNullableDateField(value, 'passwordRevisionDate') === undefined ||
    !parseOptionalBooleanField(value, 'autofillOnPageLoad').valid
  ) {
    return false
  }

  const uris = readOptionalArray(value, 'uris')
  if (!uris.valid || uris.value.length > userKeyRotationPolicy.cipherUrisMax) {
    return false
  }
  for (const uri of uris.value) {
    if (!validateLoginUri(uri)) {
      return false
    }
  }

  const credentials = readOptionalArray(value, 'fido2Credentials')
  if (
    !credentials.valid ||
    credentials.value.length > userKeyRotationPolicy.fido2CredentialsMax
  ) {
    return false
  }
  return credentials.value.every(validateFido2Credential)
}

function validateLoginUri(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyAliasedFields(value, uriFields)) {
    return false
  }
  const uri = parseOptionalOpaqueField(
    value,
    'uri',
    userKeyRotationPolicy.cipherOpaqueValueMaxLength,
  )
  const checksum = parseOptionalOpaqueField(
    value,
    'uriChecksum',
    userKeyRotationPolicy.cipherOpaqueValueMaxLength,
  )
  const match = parseNullableIntegerField(value, 'match')
  return uri.valid && checksum.valid && match !== undefined
}

function validateFido2Credential(value: unknown): boolean {
  if (
    !isPlainObject(value) ||
    !hasOnlyAliasedFields(value, fido2CredentialFields)
  ) {
    return false
  }
  for (const field of fido2CredentialFields) {
    if (field === 'creationDate') {
      if (parseNullableDateField(value, field) === undefined) {
        return false
      }
    } else if (
      !parseOptionalOpaqueField(
        value,
        field,
        userKeyRotationPolicy.cipherOpaqueValueMaxLength,
      ).valid
    ) {
      return false
    }
  }
  return true
}

function validateOptionalFields(value: Record<string, unknown>): boolean {
  const fields = readOptionalArray(value, 'fields')
  if (
    !fields.valid ||
    fields.value.length > userKeyRotationPolicy.cipherFieldsMax
  ) {
    return false
  }
  return fields.value.every((field) => {
    if (!isPlainObject(field) || !hasOnlyAliasedFields(field, fieldFields)) {
      return false
    }
    const type = parseNullableIntegerField(field, 'type')
    const linkedId = parseNullableIntegerField(field, 'linkedId')
    const name = parseOptionalOpaqueField(
      field,
      'name',
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    const fieldValue = parseOptionalOpaqueField(
      field,
      'value',
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    return (
      type !== undefined &&
      linkedId !== undefined &&
      name.valid &&
      fieldValue.valid
    )
  })
}

function validatePasswordHistory(value: Record<string, unknown>): boolean {
  const history = readOptionalArray(value, 'passwordHistory')
  if (
    !history.valid ||
    history.value.length > userKeyRotationPolicy.cipherPasswordHistoryMax
  ) {
    return false
  }
  return history.value.every((item) => {
    if (
      !isPlainObject(item) ||
      !hasOnlyAliasedFields(item, passwordHistoryFields)
    ) {
      return false
    }
    return (
      parseNullableDateField(item, 'lastUsedDate') !== undefined &&
      parseOptionalOpaqueField(
        item,
        'password',
        userKeyRotationPolicy.cipherOpaqueValueMaxLength,
      ).valid
    )
  })
}

function parseAttachments(
  value: Record<string, unknown>,
  cipherRevisionDate: string,
): UserKeyRotationAttachment[] | null {
  const legacy = readAliasedValue(value, 'attachments')
  const modern = readAliasedValue(value, 'attachments2')
  if (!legacy.valid || !modern.valid || legacy.present !== modern.present) {
    return null
  }
  if (!legacy.present || !modern.present) {
    return []
  }
  if (!isPlainObject(legacy.value) || !isPlainObject(modern.value)) {
    return null
  }

  const legacyIds = Object.keys(legacy.value).sort()
  const modernIds = Object.keys(modern.value).sort()
  if (
    legacyIds.length > userKeyRotationPolicy.attachmentsPerCipherMax ||
    !sameStrings(legacyIds, modernIds)
  ) {
    return null
  }

  const attachments: UserKeyRotationAttachment[] = []
  for (const id of modernIds) {
    const parsedId = parseId(id)
    const legacyFileName = parseOpaqueString(
      legacy.value[id],
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    const attachment = modern.value[id]
    if (
      !parsedId ||
      !legacyFileName ||
      !isPlainObject(attachment) ||
      !hasOnlyAliasedFields(attachment, attachmentFields)
    ) {
      return null
    }

    const fileName = parseRequiredOpaqueField(
      attachment,
      'fileName',
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    const attachmentKey = parseRequiredOpaqueField(
      attachment,
      'key',
      userKeyRotationPolicy.cipherOpaqueValueMaxLength,
    )
    const lastKnownRevisionDate = parseRequiredDateField(
      attachment,
      'lastKnownRevisionDate',
    )
    if (
      !fileName ||
      !attachmentKey ||
      fileName !== legacyFileName ||
      lastKnownRevisionDate !== cipherRevisionDate
    ) {
      return null
    }
    attachments.push({
      id: parsedId,
      fileName,
      attachmentKey,
      lastKnownRevisionDate,
    })
  }
  return attachments
}
