import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  childEnvironment,
  expectedAccountSha256,
  readCredentialsFile,
  parseArguments,
} from '../../scripts/honowarden-release.mjs'

describe('InterX explicit release boundary', () => {
  it('allows global credentials only for the explicitly authorized InterX target', () => {
    const file = join(
      mkdtempSync(join(tmpdir(), 'interx-auth-')),
      'credentials.env',
    )
    writeFileSync(
      file,
      `CLOUDFLARE_ACCOUNT_ID=${'a'.repeat(32)}\nCLOUDFLARE_API_KEY=synthetic-key\nCLOUDFLARE_EMAIL=operator@example.test\n`,
      { mode: 0o600 },
    )
    expect(() => readCredentialsFile(file)).toThrow()
    expect(() => readCredentialsFile(file, 'staging')).toThrow()
    const credentials = readCredentialsFile(file, 'interx')
    const env = childEnvironment(
      { PATH: '/bin', CLOUDFLARE_API_TOKEN: 'ambient-token' },
      '/tmp/output',
      credentials,
    )
    expect(env.CLOUDFLARE_API_KEY).toBe('synthetic-key')
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined()
    expect(env.CLOUDFLARE_EMAIL).toBe('operator@example.test')
  })
  it('keeps a distinct InterX account pin', () => {
    expect(expectedAccountSha256('interx')).toBe(
      '3f641d358e0972f1644ced98730b4d808da031fb3d51285364a77af74f8865b5',
    )
    expect(expectedAccountSha256('interx')).not.toBe(
      expectedAccountSha256('production'),
    )
  })
  it('requires production-strength module proof and target confirmation for InterX', () => {
    const args = [
      'first-deploy',
      '--target',
      'interx',
      '--commit',
      'a'.repeat(40),
      '--credentials-file',
      '/synthetic.env',
      '--execute',
      '--confirm',
      'interx',
    ]
    expect(() => parseArguments(args)).toThrow(
      'expected_module_sha256_required',
    )
    expect(() =>
      parseArguments([...args, '--expect-module-sha256', 'b'.repeat(64)]),
    ).toThrow('expected_admin_manifest_required')
    expect(() =>
      parseArguments([
        ...args,
        '--expect-module-sha256',
        'b'.repeat(64),
        '--expect-admin-manifest',
        '/synthetic/staging.jsonl',
        '--profile',
        'deploy/profiles/interx-company-launch.json',
      ]),
    ).not.toThrow()
    expect(() =>
      parseArguments(
        args
          .map((x) => (x === 'interx' ? 'production' : x))
          .slice(0, -1)
          .concat('interx'),
      ),
    ).toThrow('target_confirmation_required')
  })
})
