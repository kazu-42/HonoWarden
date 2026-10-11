export function parseArguments(argv: string[]): {
  target: string
  command: string
  execute: boolean
  profile?: string
  'initial-setup-window'?: boolean
}
export function expectedAccountSha256(target: string): string | undefined
export function readCredentialsFile(file: string): {
  token: string
  accountId: string
}
export function childEnvironment(
  parent: Record<string, string | undefined>,
  outputPath: string,
  credentials: { token: string; accountId: string },
): Record<string, string>
export function validateSecretsFile(
  file: string,
  kind: string,
  target: string,
): {
  names: string[]
  secrets: Record<string, string>
}
export function activeVersion(status: unknown): string
export function readModuleProof(
  account: string,
  token: string,
  worker: string,
  version: string,
  fetcher: typeof fetch,
): Promise<{ sha256: string; bytes: number }>
export function release(
  argv: string[],
  deps?: {
    cwd?: string
    env?: Record<string, string | undefined>
    runner?: (
      command: string,
      args: string[],
      options: { cwd: string; env: Record<string, string>; timeout?: number },
    ) => Promise<{ stdout: string; code: number }>
    fetch?: (...args: Parameters<typeof fetch>) => Promise<Response> | Response
    runId?: string
    expectedAccountSha256?: string
  },
): Promise<unknown>
