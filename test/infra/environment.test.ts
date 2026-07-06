import { describe, expect, it } from 'vitest'

import { resolveRuntimeEnvironment } from '../../src/infra/environment'

describe('runtime environment policy', () => {
  it('accepts the supported deployment environment names', () => {
    expect(resolveRuntimeEnvironment('development')).toBe('development')
    expect(resolveRuntimeEnvironment('staging')).toBe('staging')
    expect(resolveRuntimeEnvironment('production')).toBe('production')
  })

  it('falls back to development for missing or unknown environment values', () => {
    expect(resolveRuntimeEnvironment(undefined)).toBe('development')
    expect(resolveRuntimeEnvironment('')).toBe('development')
    expect(resolveRuntimeEnvironment('prod')).toBe('development')
  })
})
