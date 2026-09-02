export const runtimeEnvironments = [
  'development',
  'staging',
  'production',
] as const

export type RuntimeEnvironment = (typeof runtimeEnvironments)[number]

const runtimeEnvironmentSet = new Set<string>(runtimeEnvironments)

export function resolveRuntimeEnvironment(
  value: string | undefined,
): RuntimeEnvironment | null {
  if (value === undefined || value === '') {
    return 'development'
  }

  if (runtimeEnvironmentSet.has(value)) {
    return value as RuntimeEnvironment
  }

  return null
}
