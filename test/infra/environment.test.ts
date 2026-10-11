import { describe, expect, it } from 'vitest'

import { resolveRuntimeEnvironment } from '../../src/infra/environment'

describe('runtime environment policy', () => {
  it('accepts the supported deployment environment names', () => {
    expect(resolveRuntimeEnvironment('development')).toBe('development')
    expect(resolveRuntimeEnvironment('staging')).toBe('staging')
    expect(resolveRuntimeEnvironment('production')).toBe('production')
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ] as const)('rejects a %s environment value', (_name, value) => {
    expect(resolveRuntimeEnvironment(value)).toBeNull()
  })

  it('rejects unknown non-empty environment labels', () => {
    expect(resolveRuntimeEnvironment('prod')).toBeNull()
    expect(resolveRuntimeEnvironment(' development ')).toBeNull()
  })
})
