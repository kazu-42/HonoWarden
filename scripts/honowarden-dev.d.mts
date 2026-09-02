export const forwardedArgumentStop: string

export type LocalDevCommandOptions = {
  cwd: string
  env: NodeJS.ProcessEnv
  shell: false
}

export type LocalDevRunCommand = (
  executable: string,
  args: string[],
  options: LocalDevCommandOptions,
) => Promise<number>

export type LocalDevOptions = {
  env?: NodeJS.ProcessEnv
  runCommand?: LocalDevRunCommand
}

export function runLocalDev(
  argv: readonly string[],
  options?: LocalDevOptions,
): Promise<void>
