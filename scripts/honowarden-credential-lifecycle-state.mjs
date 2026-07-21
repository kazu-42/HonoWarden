import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

export const credentialLifecycleStateOwnershipMarker =
  '.honowarden-credential-lifecycle-owned'
export const credentialLifecycleStateOwnershipMarkerBody =
  '{"owner":"honowarden-credential-lifecycle"}\n'
export const credentialLifecycleCompletionAttestation =
  '.honowarden-credential-lifecycle-complete.json'

const completionAttestationSchemaVersion = 1
const stateTreeDomain = 'honowarden.credential-lifecycle-state.v1'
const excludedRootEntries = new Set([
  credentialLifecycleStateOwnershipMarker,
  credentialLifecycleCompletionAttestation,
])

export async function writeCredentialLifecycleCompletionAttestation(
  stateRoot,
  generationManifestSha256,
) {
  requireSha256(generationManifestSha256, 'generation manifest')
  const attestation = {
    schemaVersion: completionAttestationSchemaVersion,
    generationManifestSha256,
    stateTreeSha256: await credentialLifecycleStateTreeSha256(stateRoot),
  }
  const path = join(stateRoot, credentialLifecycleCompletionAttestation)
  await writeFile(path, `${JSON.stringify(attestation)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  await chmod(path, 0o600)
  return attestation
}

export async function assertCredentialLifecycleCompletionAttestation(
  stateRoot,
  expectedGenerationManifestSha256,
) {
  requireSha256(
    expectedGenerationManifestSha256,
    'expected generation manifest',
  )
  const path = join(stateRoot, credentialLifecycleCompletionAttestation)
  let attestation
  try {
    const info = await lstat(path)
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      (info.mode & 0o777) !== 0o600 ||
      !isOwnedByCurrentUser(info) ||
      !isCompletionAttestation(parsed)
    ) {
      throw new Error('invalid completion attestation')
    }
    attestation = parsed
  } catch (error) {
    throw new Error('credential lifecycle completion attestation is invalid', {
      cause: error,
    })
  }

  if (
    attestation.generationManifestSha256 !== expectedGenerationManifestSha256
  ) {
    throw new Error('credential lifecycle completion manifest digest mismatch')
  }

  const currentStateTreeSha256 =
    await credentialLifecycleStateTreeSha256(stateRoot)
  if (currentStateTreeSha256 !== attestation.stateTreeSha256) {
    throw new Error('credential lifecycle completion state digest mismatch')
  }

  return attestation
}

export async function credentialLifecycleStateTreeSha256(stateRoot) {
  const files = []
  await collectStateFiles(stateRoot, [], files)
  return sha256(
    JSON.stringify({
      domain: stateTreeDomain,
      files,
    }),
  )
}

async function collectStateFiles(directory, components, files) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))

  for (const entry of entries) {
    if (components.length === 0 && excludedRootEntries.has(entry.name)) {
      continue
    }

    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      throw new Error('credential lifecycle state must not contain symlinks')
    }
    // SQLite rewrites its shared-memory index during reads; durable changes
    // remain represented by the database and WAL files.
    if (info.isFile() && entry.name.endsWith('.sqlite-shm')) {
      continue
    }
    if (info.isDirectory()) {
      await collectStateFiles(path, [...components, entry.name], files)
      continue
    }
    if (!info.isFile()) {
      throw new Error(
        'credential lifecycle state must contain only regular files and directories',
      )
    }

    files.push({
      path: [...components, entry.name].join('/'),
      sha256: await sha256File(path),
    })
  }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

function isCompletionAttestation(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 3 &&
    value.schemaVersion === completionAttestationSchemaVersion &&
    isSha256(value.generationManifestSha256) &&
    isSha256(value.stateTreeSha256)
  )
}

function requireSha256(value, label) {
  if (!isSha256(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`)
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isOwnedByCurrentUser(stats) {
  return typeof process.getuid !== 'function' || stats.uid === process.getuid()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
