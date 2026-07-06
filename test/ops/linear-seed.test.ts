import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const seedScript = join(repoRoot, 'scripts/honowarden-linear-seed.mjs')
const seedFile = join(repoRoot, 'ops/linear/honowarden.seed.json')

describe('Linear tracking seed', () => {
  it('validates the HonoWarden tracking seed', async () => {
    const result = await execFileAsync('node', [seedScript, seedFile])
    const output = JSON.parse(result.stdout) as {
      workspaceSlug: string
      counts: {
        labels: number
        projects: number
        issues: number
        views: number
      }
    }

    expect(output.workspaceSlug).toBe('honowarden')
    expect(output.counts.labels).toBeGreaterThanOrEqual(10)
    expect(output.counts.projects).toBe(3)
    expect(output.counts.issues).toBeGreaterThanOrEqual(12)
    expect(output.counts.views).toBeGreaterThanOrEqual(5)
  })

  it('fails when an issue references an unknown label', async () => {
    const workDir = await fixtureDir('linear-seed')
    const invalidSeedFile = join(workDir, 'seed.json')
    const seed = JSON.parse(await readFile(seedFile, 'utf8')) as {
      issues: Array<{ labels: string[] }>
    }
    seed.issues[0]?.labels.push('missing:label')
    await writeFile(invalidSeedFile, JSON.stringify(seed, null, 2))

    await expect(
      execFileAsync('node', [seedScript, invalidSeedFile]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('missing:label'),
    })
  })
})

async function fixtureDir(label: string): Promise<string> {
  const root = fileURLToPath(new URL('../.tmp/', import.meta.url).toString())
  const dir = join(root, `${label}-${crypto.randomUUID()}`)
  await mkdir(dir, { recursive: true })

  return dir
}
