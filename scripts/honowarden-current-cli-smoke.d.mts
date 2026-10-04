export function verifyCurrentCliBinary(path: string): Promise<{
  version: string
  sha256: string
  bytes: number
}>

export function currentCliEnvironment(
  root: { absolute: string },
  caPath: string,
  source?: Record<string, string | undefined>,
): Record<string, string>

export function assertMutationState(
  items: unknown,
  trash: unknown,
  id: string,
  state: string,
  expected: Record<string, string>,
): void

export function assertDecryptedFields(
  item: unknown,
  expected: Record<string, string>,
): void

export function assertR2Snapshot(
  page: unknown,
  key: string,
  bodySha256: string,
): void
