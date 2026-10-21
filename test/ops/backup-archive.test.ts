import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { it, expect, onTestFinished } from 'vitest'

it.each([0, 65537])(
  'authenticates a %i-byte archive before publishing restored bytes and refuses overwrite',
  (size) => {
    const dir = mkdtempSync(join(tmpdir(), 'hw-archive-'))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    const source = join(dir, 'input'),
      encrypted = join(dir, 'encrypted'),
      restored = join(dir, 'restored')
    const bytes = randomBytes(size)
    writeFileSync(source, bytes)
    const env = {
      ...process.env,
      HONOWARDEN_BACKUP_ARCHIVE_KEY: randomBytes(32).toString('base64url'),
    }
    const run = (mode: string, input: string, output: string) =>
      execFileSync(
        'node',
        ['scripts/honowarden-backup-archive.mjs', mode, input, output],
        { env, stdio: 'pipe' },
      )
    run('encrypt', source, encrypted)
    run('decrypt', encrypted, restored)
    expect(readFileSync(restored)).toEqual(bytes)
    expect(() => run('encrypt', source, encrypted)).toThrow()
    const bad = readFileSync(encrypted)
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1
    writeFileSync(encrypted, bad)
    const rejected = join(dir, 'rejected')
    expect(() => run('decrypt', encrypted, rejected)).toThrow()
    expect(existsSync(rejected)).toBe(false)
    expect(readdirSync(dir).some((name) => name.includes('.partial-'))).toBe(
      false,
    )
  },
)
