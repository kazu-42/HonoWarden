import { describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  childEnvironment,
  beforeDeadline,
  migrationStatements,
  ownedRunPath,
  parseOptions,
  safeErrorClassification,
  writeSupervisorProof,
} from '../../scripts/honowarden-company-admin-smoke.mjs'

describe('company administration acceptance execution boundary', () => {
  it('does not write an artifact when the child never acquired the fresh run root', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'company-smoke-unowned-'))
    try {
      const root = await realpath(temporary)
      await writeFile(join(root, 'supervisor.json'), 'existing-proof', {
        mode: 0o600,
      })
      await expect(
        writeSupervisorProof(root, undefined, { terminalCode: 'failed' }),
      ).resolves.toEqual({ saved: false, reason: 'run_root_not_owned' })
      expect(await readFile(join(root, 'supervisor.json'), 'utf8')).toBe(
        'existing-proof',
      )
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('uses exclusive proof creation and refuses a symlink or an incorrect ownership nonce', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'company-smoke-proof-'))
    try {
      const parent = await realpath(temporary)
      const root = join(parent, 'owned')
      await mkdir(root, { mode: 0o700 })
      await writeFile(
        join(root, 'ownership.json'),
        JSON.stringify({ uid: process.getuid(), nonce: 'owned-nonce' }),
        { mode: 0o600 },
      )
      await expect(
        writeSupervisorProof(root, 'wrong-nonce', {}),
      ).rejects.toThrow('supervisor_run_ownership_invalid')
      const outside = join(parent, 'sentinel')
      await writeFile(outside, 'unchanged', { mode: 0o600 })
      await symlink(outside, join(root, 'supervisor.json'))
      await expect(
        writeSupervisorProof(root, 'owned-nonce', {}),
      ).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(outside, 'utf8')).toBe('unchanged')
      await rm(join(root, 'supervisor.json'))
      await expect(
        writeSupervisorProof(root, 'owned-nonce', {
          terminalCode: 'completed',
        }),
      ).resolves.toEqual({ saved: true })
      expect(
        JSON.parse(await readFile(join(root, 'supervisor.json'), 'utf8')),
      ).toEqual({ terminalCode: 'completed' })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
  it('classifies navigation and locator failures without exposing URL fragments or input values', () => {
    const network = safeErrorClassification(
      new Error(
        'page.goto: net::ERR_NAME_NOT_RESOLVED at https://local.test/#token=private-canary',
      ),
    )
    expect(network).toEqual({
      kind: 'browser_network',
      operation: 'page.goto',
      network: 'ERR_NAME_NOT_RESOLVED',
    })
    const locator = safeErrorClassification(
      new Error(
        'locator.fill: strict mode violation private-canary@example.test',
      ),
    )
    expect(locator).toEqual({
      kind: 'ambiguous_locator',
      operation: 'locator.fill',
    })
    expect(JSON.stringify([network, locator])).not.toContain('private-canary')
  })
  it('escalates a hung cleanup once and returns only its fixed safe failure code', async () => {
    vi.useFakeTimers()
    try {
      const escalate = vi.fn()
      const pending = beforeDeadline(
        new Promise(() => {}),
        20000,
        'cleanup_deadline_exceeded',
        escalate,
      )
      const rejected = expect(pending).rejects.toThrow(
        'cleanup_deadline_exceeded',
      )
      await vi.advanceTimersByTimeAsync(20000)
      await rejected
      expect(escalate).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels escalation when cleanup completes before its deadline', async () => {
    vi.useFakeTimers()
    try {
      const escalate = vi.fn()
      await expect(
        beforeDeadline(
          Promise.resolve('closed'),
          20000,
          'cleanup_deadline_exceeded',
          escalate,
        ),
      ).resolves.toBe('closed')
      await vi.advanceTimersByTimeAsync(20000)
      expect(escalate).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('refuses execution without both explicit confirmation and an exact source pin', () => {
    expect(() => parseOptions(['run'])).toThrow(
      'execution_confirmation_required',
    )
    expect(() =>
      parseOptions(['run', '--execute', '--confirm', 'company-admin-smoke']),
    ).toThrow('source_pin_required')
    expect(() => parseOptions(['plan', '--execute'])).toThrow(
      'plan_cannot_execute',
    )
    expect(() =>
      parseOptions([
        'run',
        '--execute',
        '--confirm',
        'company-admin-smoke',
        '--source-sha256',
        'a'.repeat(64),
      ]),
    ).not.toThrow()
  })

  it('rejects remote, sibling, nested and traversal run roots', () => {
    for (const path of [
      'https://vault.example.test',
      '/tmp/company-admin',
      'test/.tmp/../escaped',
      'test/.tmp/nested/profile',
      '../HonoWarden-integration-2026-09-06/test/.tmp/reused',
    ]) {
      expect(() => ownedRunPath(path, '/synthetic/repository')).toThrow()
    }
    expect(
      ownedRunPath('test/.tmp/company-admin-fresh', '/synthetic/repository'),
    ).toBe('/synthetic/repository/test/.tmp/company-admin-fresh')
  })

  it('excludes ambient credentials, injected Node options and global TLS bypasses from native children', () => {
    const environment = childEnvironment(
      '/synthetic/run',
      '/synthetic/run/certificate.pem',
      {
        PATH: '/usr/bin:/bin',
        HOME: '/normal-home',
        BW_PASSWORD: 'must-be-excluded',
        BW_SESSION: 'must-be-excluded',
        CLOUDFLARE_API_TOKEN: 'must-be-excluded',
        NODE_OPTIONS: '--require untrusted',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        HTTPS_PROXY: 'https://untrusted.example.test',
      },
    )
    expect(environment.HOME).toBe('/synthetic/run/native/home')
    expect(environment.NODE_EXTRA_CA_CERTS).toBe(
      '/synthetic/run/certificate.pem',
    )
    for (const key of [
      'BW_PASSWORD',
      'BW_SESSION',
      'CLOUDFLARE_API_TOKEN',
      'NODE_OPTIONS',
      'NODE_TLS_REJECT_UNAUTHORIZED',
      'HTTPS_PROXY',
    ])
      expect(environment).not.toHaveProperty(key)
  })

  it('keeps trigger bodies in one D1 statement and rejects truncated migrations', () => {
    const statements = migrationStatements(
      "CREATE TABLE example(id TEXT);\nCREATE TRIGGER guard BEFORE INSERT ON example\nBEGIN\nSELECT RAISE(ABORT, 'synthetic');\nEND;\nINSERT INTO example VALUES ('row');\n",
    )
    expect(statements).toHaveLength(3)
    expect(statements[1]).toContain('SELECT RAISE')
    expect(statements[1]).toContain('END;')
    expect(() =>
      migrationStatements(
        'CREATE TRIGGER guard BEFORE INSERT ON example\nBEGIN\nSELECT 1;',
      ),
    ).toThrow('incomplete_migration')
  })
})
