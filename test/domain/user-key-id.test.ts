import { describe, expect, it } from 'vitest'

import { parseUserKeyIdBody } from '../../src/domain/user-key-id'

const id = '0123456789abcdef0123456789abcdef'

describe('user-key ID input', () => {
  it('accepts a canonical 16-byte lowercase hex ID and the Pascal alias', () => {
    expect(parseUserKeyIdBody({ userKeyId: id })).toBe(id)
    expect(parseUserKeyIdBody({ UserKeyId: id })).toBe(id)
    expect(parseUserKeyIdBody({ userKeyId: id, UserKeyId: id })).toBe(id)
  })

  it.each([
    null,
    [],
    {},
    { userKeyId: null },
    { userKeyId: 123 },
    { userKeyId: '' },
    { userKeyId: id.toUpperCase() },
    { userKeyId: `${id} ` },
    { userKeyId: id.slice(1) },
    { userKeyId: 'g'.repeat(32) },
    { userKeyId: id, extra: true },
    { userKeyId: id, UserKeyId: 'f'.repeat(32) },
  ])('rejects malformed or ambiguous input %#', (body) => {
    expect(parseUserKeyIdBody(body)).toBeNull()
  })
})
