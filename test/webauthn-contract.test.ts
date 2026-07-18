import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import app from '../src/app'
import type { Bindings } from '../src/bindings'
import { buildServerConfig } from '../src/protocol/config'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())

const contractDocuments = [
  'docs/adr/0012-webauthn-passkey-contract.md',
  'docs/specs/webauthn-contract.md',
  'docs/security/webauthn-threat-model.md',
] as const

describe('HON-208 WebAuthn contract boundary', () => {
  it('keeps the ADR, wire contract, and dedicated threat model reviewable', () => {
    for (const path of contractDocuments) {
      expect(existsSync(join(repoRoot, path)), `${path} should exist`).toBe(
        true,
      )
      expect(readRepoFile(path).trim().length).toBeGreaterThan(1_000)
    }

    const adr = readRepoFile(contractDocuments[0])
    expect(adr).toContain('## Status')
    expect(adr).toContain('Accepted')
    expect(adr).toContain('HONOWARDEN_WEBAUTHN_RP_ID')
    expect(adr).toContain('HONOWARDEN_WEBAUTHN_ORIGINS')
    expect(adr).toContain('request-derived')
    expect(adr).toContain('HON-209')
    expect(adr).toContain('source capability')

    const contract = readRepoFile(contractDocuments[1])
    expect(contract).toContain('web-v2026.6.1')
    expect(contract).toContain('39f07436ca60e3f25eac47777671754f288a98f1')
    expect(contract).toContain('v2026.6.1')
    expect(contract).toContain('a09c7edb03ae6d4fdece784f1250c67be73d5fe0')
    expect(contract).toContain('grant_type=webauthn')
    expect(contract).toContain('deviceResponse')
    expect(contract).toContain('passwordless-login')
    expect(contract).toContain('single-winner')
    expect(contract).toContain('5 credentials')
    expect(contract).toContain('HON-214')

    const threatModel = readRepoFile(contractDocuments[2])
    expect(threatModel).toContain('## Assets')
    expect(threatModel).toContain('## Trust Boundaries')
    expect(threatModel).toContain('## Attacker Capabilities')
    expect(threatModel).toContain('## Abuse Paths And Mitigations')
    expect(threatModel).toContain('RP ID confusion')
    expect(threatModel).toMatch(/challenge replay/i)
    expect(threatModel).toMatch(/last recovery path/i)
    expect(threatModel).toContain('raw configuration values')
  })

  it('does not advertise WebAuthn before later implementation children', () => {
    const config = buildServerConfig('https://vault.example.com')

    expect(
      Object.keys(config.featureStates).some((key) =>
        /webauthn|passkey/i.test(key),
      ),
    ).toBe(false)
  })

  it('keeps representative WebAuthn routes absent even when policy inputs are present', async () => {
    const env = {
      HONOWARDEN_WEBAUTHN_ENABLED: 'true',
      HONOWARDEN_WEBAUTHN_ORIGINS: 'https://vault.example.com',
      HONOWARDEN_WEBAUTHN_RP_ID: 'example.com',
    } as Bindings
    const requests = [
      ['GET', '/identity/accounts/webauthn/assertion-options'],
      ['GET', '/api/webauthn'],
      ['POST', '/api/webauthn/attestation-options'],
      ['POST', '/api/webauthn/credential-id/delete'],
    ] as const

    for (const [method, path] of requests) {
      const response = await app.request(
        `https://vault.example.com${path}`,
        { method },
        env,
      )

      expect(response.status, `${method} ${path}`).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'not_found' },
      })
    }
  })

  it('does not add a verifier dependency or WebAuthn persistence early', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      dependencies?: Record<string, string>
    }
    const migrationText = readdirSync(join(repoRoot, 'migrations'))
      .filter((entry) => entry.endsWith('.sql'))
      .map((entry) => readRepoFile(`migrations/${entry}`))
      .join('\n')

    expect(packageJson.dependencies).not.toHaveProperty(
      '@simplewebauthn/server',
    )
    expect(migrationText).not.toMatch(/webauthn|passkey/i)
  })

  it('declares all policy inputs as optional Worker bindings', () => {
    const bindings = readRepoFile('src/bindings.ts')

    for (const name of [
      'HONOWARDEN_WEBAUTHN_ENABLED',
      'HONOWARDEN_WEBAUTHN_RP_ID',
      'HONOWARDEN_WEBAUTHN_ORIGINS',
      'HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST',
    ]) {
      expect(bindings).toMatch(new RegExp(`^\\s*${name}\\?: string$`, 'm'))
    }
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}
