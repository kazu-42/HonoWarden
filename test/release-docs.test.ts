import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const releaseDocs = [
  'index.md',
  'feature-freeze-checklist.md',
  'fresh-deploy-guide.md',
  'upgrade-guide.md',
  'rollback-guide.md',
  'migration-freeze.md',
  'release-gate-preflight.md',
  'backup-restore-drill-evidence.md',
  'staging-deploy-evidence.md',
  'v0.1.0-alpha-release-notes.md',
] as const

const releaseDocsRoot = fileURLToPath(
  new URL('../docs/release', import.meta.url).toString(),
)
const migrationsRoot = fileURLToPath(
  new URL('../migrations', import.meta.url).toString(),
)

describe('release feature-freeze docs', () => {
  it('keeps the required release documents present', () => {
    for (const docPath of releaseDocs) {
      const fullPath = join(releaseDocsRoot, docPath)
      expect(existsSync(fullPath), `${docPath} should exist`).toBe(true)
      expect(readFileSync(fullPath, 'utf8').trim().length).toBeGreaterThan(500)
    }
  })

  it('pins every migration file in the migration freeze document', () => {
    const freezeDoc = readReleaseDoc('migration-freeze.md')
    const migrationFiles = readdirSync(migrationsRoot)
      .filter((entry) => entry.endsWith('.sql'))
      .sort()

    expect(migrationFiles.length).toBeGreaterThan(0)
    for (const migrationFile of migrationFiles) {
      const migrationPath = join(migrationsRoot, migrationFile)
      const migrationRepoPath = `migrations/${basename(migrationPath)}`
      const hash = createHash('sha256')
        .update(readFileSync(migrationPath))
        .digest('hex')

      expect(freezeDoc).toContain(migrationRepoPath)
      expect(freezeDoc).toContain(hash)
    }
  })

  it('keeps release notes explicit about alpha exclusions and gates', () => {
    const releaseNotes = readReleaseDoc('v0.1.0-alpha-release-notes.md')

    expect(releaseNotes).toContain('HonoWarden is pre-alpha')
    expect(releaseNotes).toContain('Web Vault')
    expect(releaseNotes).toContain('public registration')
    expect(releaseNotes).toContain('independent security audit')
    expect(releaseNotes).toContain('fixture_only')
  })
})

function readReleaseDoc(docPath: (typeof releaseDocs)[number]): string {
  return readFileSync(join(releaseDocsRoot, docPath), 'utf8')
}
