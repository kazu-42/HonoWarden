import { describe, expect, it } from 'vitest'

import { resolveRuntimeEnvironment } from '../../src/infra/environment'

describe('runtime environment policy', () => {
  it('accepts the supported deployment environment names', () => {
    expect(resolveRuntimeEnvironment('development')).toBe('development')
    expect(resolveRuntimeEnvironment('staging')).toBe('staging')
    expect(resolveRuntimeEnvironment('production')).toBe('production')
  })

  it('uses development only for missing or explicitly empty local values', () => {
    expect(resolveRuntimeEnvironment(undefined)).toBe('development')
    expect(resolveRuntimeEnvironment('')).toBe('development')
  })

  it('rejects unknown non-empty environment labels', () => {
    expect(resolveRuntimeEnvironment('prod')).toBeNull()
    expect(resolveRuntimeEnvironment(' development ')).toBeNull()
  })
})
