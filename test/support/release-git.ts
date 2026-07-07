import { execFile } from 'node:child_process'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function writePreTagGit(fakeBin: string) {
  const realGit = (await execFileAsync('sh', ['-lc', 'command -v git'])).stdout
    .trim()
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")

  await writeFile(
    join(fakeBin, 'git'),
    `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')

const args = process.argv.slice(2)
const command = args.join('\\u0000')
const realGit = '${realGit}'
const headSha = process.env.HONOWARDEN_TEST_HEAD_SHA

if (command === 'rev-parse\\u0000HEAD') {
  process.stdout.write(headSha + '\\n')
  process.exit(0)
}

if (command === 'rev-parse\\u0000-q\\u0000--verify\\u0000refs/tags/v0.1.0-alpha') {
  process.exit(1)
}

if (args[0] === 'ls-remote' && args[1] === '--tags' && args[3] === 'v0.1.0-alpha') {
  process.exit(0)
}

const result = spawnSync(realGit, args, {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
})

if (result.stdout) {
  process.stdout.write(result.stdout)
}
if (result.stderr) {
  process.stderr.write(result.stderr)
}
process.exit(result.status ?? 1)
`,
  )
  await chmod(join(fakeBin, 'git'), 0o755)
}
