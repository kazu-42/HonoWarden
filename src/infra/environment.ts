export const runtimeEnvironments = [
  'development',
  'staging',
  'production',
] as const

export type RuntimeEnvironment = (typeof runtimeEnvironments)[number]

const runtimeEnvironmentSet = new Set<string>(runtimeEnvironments)

export function resolveRuntimeEnvironment(
  value: string | undefined,
): RuntimeEnvironment {
  if (value && runtimeEnvironmentSet.has(value)) {
    return value as RuntimeEnvironment
  }

  return 'development'
}
