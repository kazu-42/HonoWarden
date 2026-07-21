export const accountCredentialPolicy = {
  authenticationHashMaxLength: 4096,
  saltMaxLength: 256,
  wrappedUserKeyMaxLength: 16_384,
} as const

export const accountCredentialKdfPolicy = {
  pbkdf2Iterations: { min: 600_000, max: 2_000_000 },
  argon2Iterations: { min: 2, max: 10 },
  argon2Memory: { min: 16, max: 1024 },
  argon2Parallelism: { min: 1, max: 16 },
} as const

export type AccountCredentialKdf = {
  kdfType: 0 | 1
  iterations: number
  memory: number | null
  parallelism: number | null
}

export type MasterPasswordChangeRequest = {
  currentMasterPasswordHash: string
  nextMasterPasswordHash: string
  nextUserKey: string
  credentialMetadata: {
    salt: string
    kdf: AccountCredentialKdf
  } | null
  variant: 'structured' | 'legacy' | 'dual'
}

export type MasterPasswordChangeParseResult =
  ({ ok: true } & MasterPasswordChangeRequest) | { ok: false }

export type KdfChangeRequest = {
  currentMasterPasswordHash: string
  nextMasterPasswordHash: string
  nextUserKey: string
  credentialMetadata: {
    salt: string
    kdf: AccountCredentialKdf
  }
}

export type KdfChangeParseResult =
  ({ ok: true } & KdfChangeRequest) | { ok: false }

export type AccountCredentialGeneration = {
  emailNormalized: string
  kdfAlgorithm: string
  kdfIterations: number
  kdfMemory: number | null
  kdfParallelism: number | null
}

export type SecurityStampRotationRequest = {
  masterPasswordHash: string
}

export type SecurityStampRotationParseResult =
  ({ ok: true } & SecurityStampRotationRequest) | { ok: false }

export function isKdfMutationEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export async function fingerprintCredentialWrapper(
  value: string,
): Promise<string> {
  const fingerprintInput = canonicalCredentialWrapperFingerprintInput(value)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(fingerprintInput),
  )
  return bytesToHex(new Uint8Array(digest))
}

const encStringPartCounts = {
  '0': 2,
  '1': 3,
  '2': 3,
  '3': 1,
  '4': 1,
  '5': 2,
  '6': 2,
  '7': 1,
} as const

function canonicalCredentialWrapperFingerprintInput(value: string): string {
  const canonicalEncString = canonicalizeEncString(value)
  return canonicalEncString === null
    ? `opaque-v1:${value}`
    : `enc-string-v1:${canonicalEncString}`
}

function canonicalizeEncString(value: string): string | null {
  const separator = value.indexOf('.')
  let encryptionType: keyof typeof encStringPartCounts
  let encodedParts: string[]

  if (separator === -1) {
    encodedParts = value.split('|')
    if (encodedParts.length === 2) {
      encryptionType = '0'
    } else if (encodedParts.length === 3) {
      encryptionType = '1'
    } else {
      return null
    }
  } else {
    if (separator === 0 || value.indexOf('.', separator + 1) !== -1) {
      return null
    }
    const rawEncryptionType = value.slice(0, separator)
    if (!Object.hasOwn(encStringPartCounts, rawEncryptionType)) {
      return null
    }
    encryptionType = rawEncryptionType as keyof typeof encStringPartCounts
    encodedParts = value.slice(separator + 1).split('|')
  }

  if (encodedParts.length !== encStringPartCounts[encryptionType]) {
    return null
  }
  const decodedParts = encodedParts.map(decodeEncStringBase64)
  if (decodedParts.some((part) => part === null)) {
    return null
  }

  return [
    encryptionType,
    ...decodedParts.map((part) => `${part!.byteLength}:${bytesToHex(part!)}`),
  ].join(':')
}

// The pinned decoder ignores padding and unused trailing bits.
function decodeEncStringBase64(value: string): Uint8Array | null {
  const unpadded = value.replace(/=+$/, '')
  if (
    unpadded.includes('=') ||
    unpadded.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*$/.test(unpadded)
  ) {
    return null
  }

  const decoded = new Uint8Array(Math.floor((unpadded.length * 6) / 8))
  let accumulator = 0
  let bitCount = 0
  let outputIndex = 0
  for (const character of unpadded) {
    const codePoint = character.codePointAt(0)!
    const sextet = base64Sextet(codePoint)
    accumulator = (accumulator << 6) | sextet
    bitCount += 6
    if (bitCount < 8) continue
    bitCount -= 8
    decoded[outputIndex] = (accumulator >> bitCount) & 0xff
    outputIndex += 1
    accumulator &= (1 << bitCount) - 1
  }
  return decoded
}

function base64Sextet(codePoint: number): number {
  if (codePoint >= 65 && codePoint <= 90) return codePoint - 65
  if (codePoint >= 97 && codePoint <= 122) return codePoint - 71
  if (codePoint >= 48 && codePoint <= 57) return codePoint + 4
  return codePoint === 43 ? 62 : 63
}

function bytesToHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function parseSecurityStampRotationBody(
  body: unknown,
): SecurityStampRotationParseResult {
  return parseCurrentPasswordProofBody(body)
}

export function parseCurrentPasswordProofBody(
  body: unknown,
): SecurityStampRotationParseResult {
  if (
    !isPlainObject(body) ||
    body.otp !== undefined ||
    body.Otp !== undefined ||
    body.OTP !== undefined ||
    body.authRequestAccessCode !== undefined ||
    body.AuthRequestAccessCode !== undefined
  ) {
    return { ok: false }
  }

  const masterPasswordHash = parseAliasedBoundedString(
    body,
    ['masterPasswordHash', 'MasterPasswordHash'],
    accountCredentialPolicy.authenticationHashMaxLength,
  )
  if (!masterPasswordHash) {
    return { ok: false }
  }

  return { ok: true, masterPasswordHash }
}

export function parseMasterPasswordChangeBody(
  body: unknown,
): MasterPasswordChangeParseResult {
  if (!isPlainObject(body) || !hasSupportedPasswordHint(body)) {
    return { ok: false }
  }

  const currentMasterPasswordHash = parseAliasedBoundedString(
    body,
    ['masterPasswordHash', 'MasterPasswordHash'],
    accountCredentialPolicy.authenticationHashMaxLength,
  )
  if (!currentMasterPasswordHash) {
    return { ok: false }
  }

  const authenticationData = readNullableAlternativeValue(body, [
    'authenticationData',
    'AuthenticationData',
  ])
  const unlockData = readNullableAlternativeValue(body, [
    'unlockData',
    'UnlockData',
  ])
  const legacyHash = readNullableAlternativeValue(body, [
    'newMasterPasswordHash',
    'NewMasterPasswordHash',
  ])
  const legacyKey = readNullableAlternativeValue(body, ['key', 'Key'])
  if (
    !authenticationData.valid ||
    !unlockData.valid ||
    !legacyHash.valid ||
    !legacyKey.valid ||
    authenticationData.present !== unlockData.present ||
    legacyHash.present !== legacyKey.present ||
    (!authenticationData.present && !legacyHash.present)
  ) {
    return { ok: false }
  }

  const structured = authenticationData.present
    ? parseStructuredPasswordChange(authenticationData.value, unlockData.value)
    : null
  if (authenticationData.present && !structured) {
    return { ok: false }
  }

  const parsedLegacyHash = legacyHash.present
    ? parseBoundedString(
        legacyHash.value,
        accountCredentialPolicy.authenticationHashMaxLength,
      )
    : null
  const parsedLegacyKey = legacyKey.present
    ? parseBoundedString(
        legacyKey.value,
        accountCredentialPolicy.wrappedUserKeyMaxLength,
      )
    : null
  if (legacyHash.present && (!parsedLegacyHash || !parsedLegacyKey)) {
    return { ok: false }
  }

  if (
    structured &&
    parsedLegacyHash &&
    (structured.nextMasterPasswordHash !== parsedLegacyHash ||
      structured.nextUserKey !== parsedLegacyKey)
  ) {
    return { ok: false }
  }

  return {
    ok: true,
    currentMasterPasswordHash,
    nextMasterPasswordHash:
      structured?.nextMasterPasswordHash ?? parsedLegacyHash!,
    nextUserKey: structured?.nextUserKey ?? parsedLegacyKey!,
    credentialMetadata: structured?.credentialMetadata ?? null,
    variant: structured ? (parsedLegacyHash ? 'dual' : 'structured') : 'legacy',
  }
}

export function parseKdfChangeBody(body: unknown): KdfChangeParseResult {
  const proof = parseCurrentPasswordProofBody(body)
  if (!proof.ok || !isPlainObject(body)) {
    return { ok: false }
  }

  const authenticationData = readAliasedValue(body, [
    'authenticationData',
    'AuthenticationData',
  ])
  const unlockData = readAliasedValue(body, ['unlockData', 'UnlockData'])
  if (
    !authenticationData.present ||
    !authenticationData.valid ||
    !unlockData.present ||
    !unlockData.valid
  ) {
    return { ok: false }
  }

  const structured = parseStructuredPasswordChange(
    authenticationData.value,
    unlockData.value,
  )
  if (
    !structured ||
    !isKdfWithinMutationPolicy(structured.credentialMetadata.kdf)
  ) {
    return { ok: false }
  }

  return {
    ok: true,
    currentMasterPasswordHash: proof.masterPasswordHash,
    nextMasterPasswordHash: structured.nextMasterPasswordHash,
    nextUserKey: structured.nextUserKey,
    credentialMetadata: structured.credentialMetadata,
  }
}

export function matchesPasswordChangeCredentialGeneration(
  request: MasterPasswordChangeRequest,
  generation: AccountCredentialGeneration,
): boolean {
  if (!request.credentialMetadata) {
    return true
  }

  const storedKdf = accountCredentialKdfFromStoredGeneration(generation)
  const { kdf, salt } = request.credentialMetadata
  return (
    storedKdf !== null &&
    salt === generation.emailNormalized &&
    equalKdf(kdf, storedKdf)
  )
}

export function matchesKdfChangeCredentialGeneration(
  request: KdfChangeRequest,
  generation: AccountCredentialGeneration,
): boolean {
  return (
    request.credentialMetadata.salt === generation.emailNormalized &&
    accountCredentialKdfFromStoredGeneration(generation) !== null
  )
}

export function accountCredentialKdfFromStoredGeneration(
  generation: AccountCredentialGeneration,
): AccountCredentialKdf | null {
  const kdfType = accountCredentialKdfTypeForStoredAlgorithm(
    generation.kdfAlgorithm,
  )
  if (kdfType === null) {
    return null
  }
  const kdf: AccountCredentialKdf = {
    kdfType,
    iterations: generation.kdfIterations,
    memory: generation.kdfMemory,
    parallelism: generation.kdfParallelism,
  }

  return isStructurallyValidKdf(kdf) ? kdf : null
}

export function accountCredentialKdfTypeForStoredAlgorithm(
  algorithm: string,
): 0 | 1 | null {
  if (algorithm === 'pbkdf2-sha256') {
    return 0
  }
  if (algorithm === 'argon2id') {
    return 1
  }
  return null
}

export function accountCredentialKdfAlgorithmForType(
  kdfType: AccountCredentialKdf['kdfType'],
): 'pbkdf2-sha256' | 'argon2id' {
  return kdfType === 0 ? 'pbkdf2-sha256' : 'argon2id'
}

export function nextCredentialRevisionDate(
  currentRevisionDate: string,
  candidateRevisionDate: string,
): string {
  const current = Date.parse(currentRevisionDate)
  const candidate = Date.parse(candidateRevisionDate)
  if (!Number.isFinite(current) || !Number.isFinite(candidate)) {
    throw new Error('credential revision dates must be valid')
  }

  return new Date(Math.max(candidate, current + 1)).toISOString()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

type AliasedValue =
  | { present: false; valid: true; value?: never }
  | { present: boolean; valid: false; value?: never }
  | { present: true; valid: true; value: unknown }

function readAliasedValue(
  object: Record<string, unknown>,
  names: readonly string[],
): AliasedValue {
  const values = names
    .map((name) => object[name])
    .filter((value) => value !== undefined)
  if (values.length === 0) {
    return { present: false, valid: true }
  }
  if (values.some((value) => !Object.is(value, values[0]))) {
    return { present: true, valid: false }
  }

  return { present: true, valid: true, value: values[0] }
}

function readNullableAlternativeValue(
  object: Record<string, unknown>,
  names: readonly string[],
): AliasedValue {
  const value = readAliasedValue(object, names)
  return value.present && value.valid && value.value === null
    ? { present: false, valid: true }
    : value
}

function parseAliasedBoundedString(
  object: Record<string, unknown>,
  names: readonly string[],
  maxLength: number,
): string | null {
  const aliased = readAliasedValue(object, names)
  return aliased.present && aliased.valid
    ? parseBoundedString(aliased.value, maxLength)
    : null
}

function parseBoundedString(value: unknown, maxLength: number): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    [...value].some(isControlCharacter)
  ) {
    return null
  }

  return value
}

function hasSupportedPasswordHint(body: Record<string, unknown>): boolean {
  const hint = readAliasedValue(body, [
    'masterPasswordHint',
    'MasterPasswordHint',
  ])
  return (
    hint.valid && (!hint.present || hint.value === null || hint.value === '')
  )
}

function parseStructuredPasswordChange(
  authenticationValue: unknown,
  unlockValue: unknown,
): {
  nextMasterPasswordHash: string
  nextUserKey: string
  credentialMetadata: { salt: string; kdf: AccountCredentialKdf }
} | null {
  if (!isPlainObject(authenticationValue) || !isPlainObject(unlockValue)) {
    return null
  }

  const authenticationKdf = parseAliasedKdf(authenticationValue)
  const unlockKdf = parseAliasedKdf(unlockValue)
  const authenticationSalt = parseAliasedBoundedString(
    authenticationValue,
    ['salt', 'Salt'],
    accountCredentialPolicy.saltMaxLength,
  )
  const unlockSalt = parseAliasedBoundedString(
    unlockValue,
    ['salt', 'Salt'],
    accountCredentialPolicy.saltMaxLength,
  )
  const nextMasterPasswordHash = parseAliasedBoundedString(
    authenticationValue,
    ['masterPasswordAuthenticationHash', 'MasterPasswordAuthenticationHash'],
    accountCredentialPolicy.authenticationHashMaxLength,
  )
  const nextUserKey = parseAliasedBoundedString(
    unlockValue,
    ['masterKeyWrappedUserKey', 'MasterKeyWrappedUserKey'],
    accountCredentialPolicy.wrappedUserKeyMaxLength,
  )

  if (
    !authenticationKdf ||
    !unlockKdf ||
    !equalKdf(authenticationKdf, unlockKdf) ||
    !authenticationSalt ||
    authenticationSalt !== unlockSalt ||
    !nextMasterPasswordHash ||
    !nextUserKey
  ) {
    return null
  }

  return {
    nextMasterPasswordHash,
    nextUserKey,
    credentialMetadata: {
      salt: authenticationSalt,
      kdf: authenticationKdf,
    },
  }
}

function parseAliasedKdf(
  object: Record<string, unknown>,
): AccountCredentialKdf | null {
  const value = readAliasedValue(object, ['kdf', 'Kdf'])
  return value.present && value.valid ? parseKdf(value.value) : null
}

function parseKdf(value: unknown): AccountCredentialKdf | null {
  if (!isPlainObject(value)) {
    return null
  }

  const kdfType = parseAliasedInteger(value, ['kdfType', 'KdfType'])
  const iterations = parseAliasedInteger(value, ['iterations', 'Iterations'])
  const memory = parseNullableAliasedInteger(value, ['memory', 'Memory'])
  const parallelism = parseNullableAliasedInteger(value, [
    'parallelism',
    'Parallelism',
  ])
  if (kdfType !== 0 && kdfType !== 1) {
    return null
  }
  if (
    iterations === null ||
    memory === undefined ||
    parallelism === undefined
  ) {
    return null
  }

  const kdf: AccountCredentialKdf = {
    kdfType,
    iterations,
    memory,
    parallelism,
  }
  return isStructurallyValidKdf(kdf) ? kdf : null
}

function parseAliasedInteger(
  object: Record<string, unknown>,
  names: readonly string[],
): number | null {
  const value = readAliasedValue(object, names)
  return value.present && value.valid && Number.isSafeInteger(value.value)
    ? (value.value as number)
    : null
}

function parseNullableAliasedInteger(
  object: Record<string, unknown>,
  names: readonly string[],
): number | null | undefined {
  const value = readAliasedValue(object, names)
  if (!value.valid) {
    return undefined
  }
  if (!value.present || value.value === null) {
    return null
  }
  return Number.isSafeInteger(value.value) ? (value.value as number) : undefined
}

function equalKdf(left: AccountCredentialKdf, right: AccountCredentialKdf) {
  return (
    left.kdfType === right.kdfType &&
    left.iterations === right.iterations &&
    left.memory === right.memory &&
    left.parallelism === right.parallelism
  )
}

function isStructurallyValidKdf(kdf: AccountCredentialKdf): boolean {
  if (!Number.isSafeInteger(kdf.iterations) || kdf.iterations < 1) {
    return false
  }

  if (kdf.kdfType === 0) {
    return kdf.memory === null && kdf.parallelism === null
  }

  return (
    kdf.memory !== null &&
    Number.isSafeInteger(kdf.memory) &&
    kdf.memory >= 1 &&
    kdf.parallelism !== null &&
    Number.isSafeInteger(kdf.parallelism) &&
    kdf.parallelism >= 1
  )
}

function isKdfWithinMutationPolicy(kdf: AccountCredentialKdf): boolean {
  if (kdf.kdfType === 0) {
    return insideRange(
      kdf.iterations,
      accountCredentialKdfPolicy.pbkdf2Iterations,
    )
  }

  return (
    kdf.memory !== null &&
    kdf.parallelism !== null &&
    insideRange(kdf.iterations, accountCredentialKdfPolicy.argon2Iterations) &&
    insideRange(kdf.memory, accountCredentialKdfPolicy.argon2Memory) &&
    insideRange(kdf.parallelism, accountCredentialKdfPolicy.argon2Parallelism)
  )
}

function insideRange(
  value: number,
  range: { min: number; max: number },
): boolean {
  return value >= range.min && value <= range.max
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127
}
