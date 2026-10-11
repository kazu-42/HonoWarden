import { cp, mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(
  new URL('../..', import.meta.url).toString(),
)
const require = createRequire(import.meta.url)

// Copy only the release verifier's inputs. No shared archive or dependency
// bytes are changed, and no symlink points back into the working repository.
export async function createReleaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'honowarden-release-fixture-'))
  for (const path of [
    'scripts',
    'docs',
    '.workflow',
    'compat',
    'migrations',
    'ops',
    'package.json',
    'pnpm-lock.yaml',
    'wrangler.jsonc',
  ]) {
    await cp(join(repositoryRoot, path), join(root, path), { recursive: true })
  }
  await mkdir(join(root, 'node_modules'))
  await cp(
    dirname(require.resolve('jsonc-parser/package.json')),
    join(root, 'node_modules/jsonc-parser'),
    { recursive: true, dereference: true },
  )
  return realpath(root)
}
