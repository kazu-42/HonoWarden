import {
  hasOnlyAliasedFields,
  isPlainObject,
  readAliasedValue,
} from './user-key-rotation-input'

export function isUserKeyIdEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isUserKeyId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)
}

export function parseUserKeyIdBody(body: unknown): string | null {
  if (!isPlainObject(body) || !hasOnlyAliasedFields(body, ['userKeyId'])) {
    return null
  }
  const field = readAliasedValue(body, 'userKeyId')
  return field.valid && field.present && isUserKeyId(field.value)
    ? field.value
    : null
}
