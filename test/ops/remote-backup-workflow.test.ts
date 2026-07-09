import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const workflowPath = fileURLToPath(
  new URL(
    '../../.github/workflows/remote-backup.yml',
    import.meta.url,
  ).toString(),
)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())

describe('remote backup workflow', () => {
  it('runs a scheduled encrypted remote backup without destructive restore steps', () => {
    expect(existsSync(workflowPath)).toBe(true)

    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('name: Remote Backup')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain("cron: '17 19 * * *'")
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN')
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID')
    expect(workflow).toContain('R2_ACCESS_KEY_ID')
    expect(workflow).toContain('R2_SECRET_ACCESS_KEY')
    expect(workflow).toContain('HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE')
    expect(workflow).toContain('pnpm backup:export --')
    expect(workflow).toContain('--mode remote')
    expect(workflow).toContain('--env production')
    expect(workflow).toContain('--r2-list')
    expect(workflow).toContain('--r2-prefix attachments/')
    expect(workflow).toContain('--execute')
    expect(workflow).toContain('pnpm backup:evidence --')
    expect(workflow).toContain('openssl enc -aes-256-cbc -pbkdf2')
    expect(workflow).toContain('retention-days: 7')
    expect(workflow).toContain('if-no-files-found: error')
    expect(workflow).not.toContain('--confirm-fresh-target')
    expect(workflow).not.toContain('wrangler d1 execute')
    expect(workflow).not.toContain('git push')
  })

  it('documents scheduled remote backup evidence, retention, and failure handling', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>
    }
    const index = readRepoFile('docs/release/index.md')
    const runbook = readRepoFile('docs/operations/backup-restore.md')
    const evidence = readRepoFile('docs/release/remote-backup-evidence.md')
    const knownLimitations = readRepoFile('docs/security/known-limitations.md')
    const currentState = readRepoFile('docs/current-state.md')

    expect(packageJson.scripts['backup:evidence']).toBe(
      'node scripts/honowarden-backup.mjs evidence',
    )
    expect(packageJson.scripts['backup:schedule:packet']).toBe(
      'node scripts/honowarden-scheduled-backup-packet.mjs plan',
    )
    expect(index).toContain('remote-backup-evidence.md')
    expect(runbook).toContain('.github/workflows/remote-backup.yml')
    expect(runbook).toContain('pnpm backup:schedule:packet')
    expect(runbook).toContain('HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE')
    expect(runbook).toContain('Restore only into a fresh D1/R2 target')
    expect(evidence).toMatch(/^Status:\s*passed\.?\s*$/m)
    expect(evidence).toContain('17 19 * * *')
    expect(evidence).toContain('CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN')
    expect(evidence).toContain(
      'sha256:20de055a2753f125252c8dcd0f46776f0aa99bac7df04c7de8b8d58f7913eb6b',
    )
    expect(evidence).toContain('D1 SQL size: `5993` bytes')
    expect(evidence).toContain('R2 object count: `1`')
    expect(evidence).toContain('Restored D1 table count: `13`')
    expect(evidence).toContain('The specified key does not exist')
    expect(evidence).toContain('includesObjectKeys=false')
    expect(knownLimitations).toMatch(/scheduled GitHub Actions\s+workflow/)
    expect(currentState).toContain('Week 26 Scheduled Remote Backup Evidence')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(`${repoRoot}/${path}`, 'utf8')
}
