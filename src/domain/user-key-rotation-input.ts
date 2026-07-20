import {
  accountCredentialKdfPolicy,
  type AccountCredentialKdf,
} from './account-credentials'
import { userKeyRotationPolicy } from './user-key-rotation-policy'

export type AliasedValue =
  | { present: false; valid: true; value?: never }
  | { present: boolean; valid: false; value?: never }
  | { present: true; valid: true; value: unknown }

export function readAliasedValue(
  object: Record<string, unknown>,
  name: string,
): AliasedValue {
  const names = [name, pascalCase(name)]
  const values = names
    .filter((candidate) => Object.hasOwn(object, candidate))
    .map((candidate) => object[candidate])
    .filter((candidate) => candidate !== undefined)
  if (values.length === 0) {
    return { present: false, valid: true }
  }
  if (values.some((candidate) => !deepEqual(candidate, values[0]))) {
    return { present: true, valid: false }
  }
  return { present: true, valid: true, value: values[0] }
}

export function hasOnlyAliasedFields(
  object: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const allowed = new Set(fields.flatMap((field) => [field, pascalCase(field)]))
  return Object.keys(object).every((field) => allowed.has(field))
}

export function readRequiredObject(
  object: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const value = readAliasedValue(object, name)
  return value.present && value.valid && isPlainObject(value.value)
    ? value.value
    : null
}

export function readRequiredArray(
  object: Record<string, unknown>,
  name: string,
): unknown[] | null {
  const value = readAliasedValue(object, name)
  return value.present && value.valid && Array.isArray(value.value)
    ? value.value
    : null
}

export function readOptionalArray(
  object: Record<string, unknown>,
  name: string,
): { valid: boolean; value: unknown[] } {
  const value = readAliasedValue(object, name)
  if (!value.valid) {
    return { valid: false, value: [] }
  }
  if (!value.present || value.value === null) {
    return { valid: true, value: [] }
  }
  return Array.isArray(value.value)
    ? { valid: true, value: value.value }
    : { valid: false, value: [] }
}

export function isRequiredEmptyArray(
  object: Record<string, unknown>,
  name: string,
): boolean {
  const value = readRequiredArray(object, name)
  return value !== null && value.length === 0
}

export function parseRequiredOpaqueField(
  object: Record<string, unknown>,
  name: string,
  maxLength: number,
): string | null {
  const value = readAliasedValue(object, name)
  return value.present && value.valid
    ? parseOpaqueString(value.value, maxLength)
    : null
}

export function parseOptionalOpaqueField(
  object: Record<string, unknown>,
  name: string,
  maxLength: number,
): { valid: boolean; value: string | null } {
  const value = readAliasedValue(object, name)
  if (!value.valid) {
    return { valid: false, value: null }
  }
  if (!value.present || value.value === null) {
    return { valid: true, value: null }
  }
  const parsed = parseOpaqueString(value.value, maxLength)
  return { valid: parsed !== null, value: parsed }
}

export function parseRequiredIdField(
  object: Record<string, unknown>,
  name: string,
): string | null {
  const value = readAliasedValue(object, name)
  return value.present && value.valid ? parseId(value.value) : null
}

export function parseNullableIdField(
  object: Record<string, unknown>,
  name: string,
): string | null | undefined {
  const value = readAliasedValue(object, name)
  if (!value.valid) {
    return undefined
  }
  if (!value.present || value.value === null || value.value === '') {
    return null
  }
  return parseId(value.value) ?? undefined
}

export function parseRequiredIntegerField(
  object: Record<string, unknown>,
  name: string,
): number | null {
  const value = readAliasedValue(object, name)
  return value.present && value.valid && Number.isSafeInteger(value.value)
    ? (value.value as number)
    : null
}

export function parseNullableIntegerField(
  object: Record<string, unknown>,
  name: string,
): number | null | undefined {
  const value = readAliasedValue(object, name)
  if (!value.valid) {
    return undefined
  }
  if (!value.present || value.value === null) {
    return null
  }
  return Number.isSafeInteger(value.value) ? (value.value as number) : undefined
}

export function parseRequiredBooleanField(
  object: Record<string, unknown>,
  name: string,
): boolean | null {
  const value = readAliasedValue(object, name)
  return value.present && value.valid && typeof value.value === 'boolean'
    ? value.value
    : null
}

export function parseOptionalBooleanField(
  object: Record<string, unknown>,
  name: string,
): { valid: boolean; value: boolean | null } {
  const value = readAliasedValue(object, name)
  if (!value.valid) {
    return { valid: false, value: null }
  }
  if (!value.present || value.value === null) {
    return { valid: true, value: null }
  }
  return typeof value.value === 'boolean'
    ? { valid: true, value: value.value }
    : { valid: false, value: null }
}

export function parseRequiredDateField(
  object: Record<string, unknown>,
  name: string,
): string | null {
  const value = readAliasedValue(object, name)
  return value.present && value.valid ? parseIsoDate(value.value) : null
}

export function parseNullableDateField(
  object: Record<string, unknown>,
  name: string,
): string | null | undefined {
  const value = readAliasedValue(object, name)
  if (!value.valid) {
    return undefined
  }
  if (!value.present || value.value === null) {
    return null
  }
  return parseIsoDate(value.value) ?? undefined
}

export function isAbsentOrNull(
  object: Record<string, unknown>,
  name: string,
): boolean {
  const value = readAliasedValue(object, name)
  return value.valid && (!value.present || value.value === null)
}

export function isAbsentNullOrEmpty(
  object: Record<string, unknown>,
  name: string,
): boolean {
  const value = readAliasedValue(object, name)
  return (
    value.valid &&
    (!value.present || value.value === null || value.value === '')
  )
}

export function allAbsentOrNull(
  object: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => isAbsentOrNull(object, field))
}

export function parseOpaqueString(
  value: unknown,
  maxLength: number,
): string | null {
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

export function parseId(value: unknown): string | null {
  const parsed = parseOpaqueString(value, userKeyRotationPolicy.idMaxLength)
  return parsed &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      parsed,
    )
    ? parsed
    : null
}

export function isEmailSalt(value: string): boolean {
  return (
    value === value.toLowerCase() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  )
}

export function isKdfWithinPolicy(kdf: AccountCredentialKdf): boolean {
  if (kdf.kdfType === 0) {
    return (
      kdf.memory === null &&
      kdf.parallelism === null &&
      insideRange(kdf.iterations, accountCredentialKdfPolicy.pbkdf2Iterations)
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

export function equalKdf(
  left: AccountCredentialKdf,
  right: AccountCredentialKdf,
) {
  return (
    left.kdfType === right.kdfType &&
    left.iterations === right.iterations &&
    left.memory === right.memory &&
    left.parallelism === right.parallelism
  )
}

export function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < maxLength; index += 1) {
    difference |= charCodeAt(left, index) ^ charCodeAt(right, index)
  }
  return difference === 0
}

export function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export function serializeObject(value: Record<string, unknown>): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 32) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === value
    ? value
    : null
}

function insideRange(
  value: number,
  range: { min: number; max: number },
): boolean {
  return Number.isSafeInteger(value) && value >= range.min && value <= range.max
}

function charCodeAt(value: string, index: number): number {
  return index < value.length ? value.charCodeAt(index) : 0
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    )
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false
  }
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    sameStrings(leftKeys, rightKeys) &&
    leftKeys.every((key) => deepEqual(left[key], right[key]))
  )
}

function pascalCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127
}
