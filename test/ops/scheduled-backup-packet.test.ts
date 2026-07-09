import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const packetScript = join(
  repoRoot,
  'scripts/honowarden-scheduled-backup-packet.mjs',
)

type ScheduledBackupPacket = {
  schemaVersion: number
  action: string
  status: string
  schedule: {
    provider: string
    workflowPath: string
    cron: string
  }
  commandPlan: {
    exportCommand: string[]
    evidenceCommand: string[]
    restoreDrillCommand: string[]
  }
  requiredSecrets: string[]
  retention: {
    encryptedArtifactRetentionDays: number
    operatorArchiveRetentionDays: number
  }
  encryption: {
    required: boolean
    passphraseSecret: string
  }
  failureHandling: {
    alertSources: string[]
    retryPolicy: string
    rollbackPolicy: string
  }
  evidencePolicy: {
    safeFields: string[]
    forbiddenFields: string[]
  }
}

describe('scheduled remote backup packet', () => {
  it('emits a reviewed production backup schedule contract without secret values', () => {
    const output = execFileSync(process.execPath, [packetScript, 'plan'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: 'cf_token_should_not_print',
        R2_SECRET_ACCESS_KEY: 'r2_secret_should_not_print',
        HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE:
          'backup_passphrase_should_not_print',
      },
    })
    const packet = JSON.parse(output) as ScheduledBackupPacket

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'scheduled_remote_backup_plan',
      status: 'ready',
      schedule: {
        provider: 'github_actions',
        workflowPath: '.github/workflows/remote-backup.yml',
        cron: '17 19 * * *',
      },
      retention: {
        encryptedArtifactRetentionDays: 7,
        operatorArchiveRetentionDays: 35,
      },
      encryption: {
        required: true,
        passphraseSecret: 'HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE',
      },
    })
    expect(packet.requiredSecrets).toEqual([
      'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE',
    ])
    expect(packet.commandPlan.exportCommand).toEqual([
      'pnpm',
      'backup:export',
      '--',
      '--out',
      '$BACKUP_OUT',
      '--database',
      'honowarden',
      '--bucket',
      'honowarden-vault-objects',
      '--mode',
      'remote',
      '--env',
      'production',
      '--r2-list',
      '--r2-prefix',
      'attachments/',
      '--execute',
    ])
    expect(packet.commandPlan.evidenceCommand).toEqual([
      'pnpm',
      'backup:evidence',
      '--',
      '--from',
      '$BACKUP_OUT',
      '--out',
      '$BACKUP_EVIDENCE_OUT',
    ])
    expect(packet.commandPlan.restoreDrillCommand).toContain(
      '--confirm-fresh-target',
    )
    expect(packet.failureHandling.alertSources).toContain(
      'GitHub Actions failed scheduled workflow notification',
    )
    expect(packet.failureHandling.retryPolicy).toContain('manual rerun')
    expect(packet.failureHandling.rollbackPolicy).toContain('fresh target')
    expect(packet.evidencePolicy.safeFields).toContain('manifestId')
    expect(packet.evidencePolicy.forbiddenFields).toContain('object keys')
    expect(output).not.toContain('cf_token_should_not_print')
    expect(output).not.toContain('r2_secret_should_not_print')
    expect(output).not.toContain('backup_passphrase_should_not_print')
  })

  it('writes the same packet to an optional reviewed evidence path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'honowarden-backup-packet-'))
    const outPath = join(dir, 'scheduled-backup-packet.json')
    const output = execFileSync(process.execPath, [
      packetScript,
      'plan',
      '--out',
      outPath,
    ])

    expect(JSON.parse(readFileSync(outPath, 'utf8'))).toEqual(
      JSON.parse(output.toString()),
    )
  })
})
