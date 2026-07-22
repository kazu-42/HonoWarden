import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error repository verifier intentionally ships as plain ESM.
import * as credentialCloseout from '../../scripts/honowarden-credential-closeout.mjs'

const {
  assertCredentialCloseoutContentSafe,
  buildCredentialCloseoutPacket,
  credentialCloseoutArtifactPaths,
  credentialCloseoutClaimIds,
  credentialCloseoutPacketPath,
  scanCredentialCloseoutArtifacts,
  serializeCredentialCloseoutPacket,
  sha256CredentialCloseoutText,
  verifyCredentialCloseoutPacket,
  writeCredentialCloseoutPacket,
} = credentialCloseout

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const registryPath = join(repoRoot, 'compat/credential-evidence.json')
const packetPath = join(repoRoot, credentialCloseoutPacketPath)
const scriptPath = join(repoRoot, 'scripts/honowarden-credential-closeout.mjs')
const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
  }
})

describe('credential closeout packet', () => {
  it('builds byte-identical canonical output without time or host paths', () => {
    const first = buildCredentialCloseoutPacket({ repoRoot })
    const second = buildCredentialCloseoutPacket({ repoRoot })
    const firstText = serializeCredentialCloseoutPacket(first)
    const secondText = serializeCredentialCloseoutPacket(second)

    expect(first).toEqual(second)
    expect(firstText).toBe(secondText)
    expect(sha256CredentialCloseoutText(firstText)).toBe(
      sha256CredentialCloseoutText(secondText),
    )
    expect(firstText.endsWith('\n')).toBe(true)
    expect(firstText).not.toContain(repoRoot)
    expect(firstText).not.toMatch(/generatedAt|createdAt|updatedAt/)
    expect(firstText).not.toContain('requiredMarkers')
    expect(firstText).not.toContain('assertion')
    expect(firstText).not.toContain('artifactContents')
  })

  it('emits only the closed allowlisted packet shape', () => {
    const packet = buildCredentialCloseoutPacket({ repoRoot }) as Packet

    expect(Object.keys(packet)).toEqual([
      'schemaVersion',
      'status',
      'registry',
      'sourcePins',
      'evidenceLevels',
      'claims',
      'counts',
      'liveEvidenceLevels',
      'limitations',
    ])
    expect(Object.keys(packet.registry)).toEqual([
      'path',
      'sha256',
      'schemaPath',
      'schemaSha256',
    ])
    expect(Object.keys(packet.sourcePins)).toEqual([
      'programBaseCommit',
      'clients',
    ])
    expect(
      packet.sourcePins.clients.every((source) =>
        sameKeys(source, [
          'id',
          'surface',
          'version',
          'sourceRef',
          'assetSha256',
        ]),
      ),
    ).toBe(true)
    expect(
      packet.evidenceLevels.every((level) =>
        sameKeys(level, ['id', 'rank', 'scope']),
      ),
    ).toBe(true)
    expect(
      packet.claims.every((claim) =>
        sameKeys(claim, [
          'id',
          'status',
          'executionLevel',
          'evidenceLevel',
          'sourceGeneration',
          'artifacts',
          'clientSourceIds',
          'limitations',
          'sha256',
        ]),
      ),
    ).toBe(true)
    expect(
      packet.claims.every((claim) =>
        sameKeys(claim.sourceGeneration, ['kind', 'commit']),
      ),
    ).toBe(true)
    expect(
      packet.claims
        .flatMap((claim) => claim.artifacts)
        .every((artifact) =>
          sameKeys(artifact, ['path', 'evidenceLevel', 'sha256']),
        ),
    ).toBe(true)
    expect(Object.keys(packet.counts)).toEqual([
      'evidenceLevels',
      'clientSources',
      'claims',
      'artifacts',
      'artifactBindings',
      'fixtureClaims',
      'localApiClaims',
      'localOfficialClientClaims',
      'stagingClaims',
      'productionClaims',
    ])
  })

  it('pins exact registry, schema, claims, sources, levels, and counts', () => {
    const packet = buildCredentialCloseoutPacket({ repoRoot }) as Packet

    expect(packet).toMatchObject({
      schemaVersion: 1,
      status: 'verified',
      registry: {
        path: 'compat/credential-evidence.json',
        sha256:
          '53192962c66ccd1714d3a9ce6d878d12ed91b31f1d765caef1af4e127e15a169',
        schemaPath: 'compat/credential-evidence.schema.json',
        schemaSha256:
          '1640608cb08c4fdac43d6ac94bfdc4b06e5af6fe10e6c1473a6d459a3f02c32f',
      },
      counts: {
        evidenceLevels: 5,
        clientSources: 2,
        claims: 11,
        artifacts: 8,
        artifactBindings: 20,
        fixtureClaims: 0,
        localApiClaims: 4,
        localOfficialClientClaims: 7,
        stagingClaims: 0,
        productionClaims: 0,
      },
      liveEvidenceLevels: [],
    })
    expect(packet.claims.map((claim) => claim.id)).toEqual(
      credentialCloseoutClaimIds,
    )
    expect([
      ...new Set(
        packet.claims.flatMap((claim) =>
          claim.artifacts.map((artifact) => artifact.path),
        ),
      ),
    ]).toEqual(credentialCloseoutArtifactPaths)
    expect(packet.claims.every((claim) => claim.status === 'verified')).toBe(
      true,
    )
    expect(
      packet.claims.every((claim) => /^[0-9a-f]{64}$/.test(claim.sha256)),
    ).toBe(true)
  })

  it('matches the tracked canonical packet and scans all owned artifacts', () => {
    const report = verifyCredentialCloseoutPacket({ repoRoot })

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      claims: 11,
      artifacts: 8,
      scannedInputs: 11,
      liveEvidenceLevels: [],
    })
    expect(report.bytes).toBe(Buffer.byteLength(readFileSync(packetPath)))
    expect(report.sha256).toBe(
      createHash('sha256').update(readFileSync(packetPath)).digest('hex'),
    )
  })

  it.each([
    ['password field', '{"password":"do-not-print-password"}'],
    [
      'escaped password field',
      '{"pass\\u0077ord":"do-not-print-escaped-password"}',
    ],
    [
      'single-quoted password field',
      "{'password': 'do-not-print-single-quoted-password'}",
    ],
    [
      'nested password assignment',
      'Wrapper: password: do-not-print-nested-password',
    ],
    [
      'colon-adjacent nested password assignment',
      'Wrapper:password=do-not-print-colon-adjacent-password',
    ],
    [
      'colon-adjacent nested password pair',
      'Wrapper:password:do-not-print-colon-adjacent-pair',
    ],
    [
      'NUL-split password assignment',
      'pass\u0000word=do-not-print-nul-password',
    ],
    ['lone carriage return', 'safe metadata\rcontinued metadata'],
    ['unpaired high surrogate', '\ud800'],
    ['unpaired low surrogate', '\udc00'],
    [
      'HTML decimal-entity assignment separator',
      'password&#61;do-not-print-html-decimal-password',
    ],
    [
      'HTML hexadecimal-entity assignment separator',
      'password&#x3d;do-not-print-html-hex-password',
    ],
    [
      'HTML named-entity assignment separator',
      'password&equals;do-not-print-html-named-password',
    ],
    [
      'percent-encoded assignment separator',
      'password%3Ddo-not-print-percent-password',
    ],
    [
      'double-percent-encoded assignment separator',
      'password%253Ddo-not-print-double-percent-password',
    ],
    [
      'Markdown-escaped assignment separator',
      String.raw`password\=do-not-print-markdown-escaped-password`,
    ],
    [
      'pipe-delimited password assignment',
      'metadata=verified|password=do-not-print-pipe-password',
    ],
    [
      'new master password hash',
      '{"newMasterPasswordHash":"do-not-print-next-master-password-hash"}',
    ],
    [
      'versioned password hash',
      '{"passwordHashV2":"do-not-print-versioned-password-hash"}',
    ],
    ['key hash', '{"keyHash":"do-not-print-key-hash"}'],
    ['secret hash', '{"secretHash":"do-not-print-secret-hash"}'],
    ['token signature', '{"tokenSignature":"do-not-print-token-signature"}'],
    [
      'password plaintext',
      '{"passwordPlaintext":"do-not-print-password-plaintext"}',
    ],
    ['password raw', '{"passwordRaw":"do-not-print-password-raw"}'],
    ['password clear', '{"passwordClear":"do-not-print-password-clear"}'],
    ['key material', '{"keyMaterial":"do-not-print-key-material"}'],
    ['secret material', '{"secretMaterial":"do-not-print-secret-material"}'],
    ['seed phrase', '{"seedPhrase":"do-not-print-seed-phrase"}'],
    ['mnemonic', '{"mnemonic":"do-not-print-mnemonic"}'],
    ['recovery code', '{"recoveryCode":"do-not-print-recovery-code"}'],
    ['TOTP seed', '{"totpSeed":"do-not-print-totp-seed"}'],
    ['salt', '{"salt":"do-not-print-salt"}'],
    ['key blob', '{"keyBlob":"do-not-print-key-blob"}'],
    ['token bearer', '{"tokenBearer":"do-not-print-token-bearer"}'],
    [
      'compact password plaintext',
      'passwordplaintext=do-not-print-compact-password-plaintext',
    ],
    ['postfixed password', '{"passwordOld":"do-not-print-old-password"}'],
    [
      'postfixed password confirmation',
      'password_confirmation=do-not-print-password-confirmation',
    ],
    [
      'postfixed access token copy',
      'accessTokenCopy=do-not-print-access-token-copy',
    ],
    [
      'unrecognized password input suffix',
      '{"passwordInput":"do-not-print-password-input"}',
    ],
    [
      'unrecognized access token data suffix',
      '{"accessTokenData":"do-not-print-access-token-data"}',
    ],
    [
      'unrecognized wrapped key data suffix',
      '{"wrappedKeyData":"do-not-print-wrapped-key-data"}',
    ],
    [
      'unrecognized password qualifier assignment',
      'passwordForUser=do-not-print-password-for-user',
    ],
    [
      'parenthesized raw password qualifier',
      'Password (raw): do-not-print-parenthesized-password',
    ],
    [
      'parenthesized environment access token qualifier',
      'Access token (production): do-not-print-production-access-token',
    ],
    [
      'slash-delimited password qualifier',
      'Password/raw: do-not-print-slash-password',
    ],
    [
      'bracketed API key qualifier',
      'API key [production]: do-not-print-production-api-key',
    ],
    [
      'natural-language password qualifier',
      'Password for user: do-not-print-user-password',
    ],
    [
      'natural-language access token qualifier',
      'Access token for production: do-not-print-production-token',
    ],
    [
      'natural-language secret qualifier',
      'Secret used by client: do-not-print-client-secret',
    ],
    [
      'tab-delimited natural-language password qualifier',
      'Password\tfor\tuser = do-not-print-tabbed-password',
    ],
    ['compact key material', 'keymaterial=do-not-print-compact-key-material'],
    ['bracket-wrapped password', '[password=do-not-print-bracket-password]'],
    [
      'bold Markdown password',
      '- **Password**: do-not-print-bold-markdown-password',
    ],
    [
      'spaced bold Markdown password',
      '- ** Password **: do-not-print-spaced-markdown-password',
    ],
    [
      'Markdown table password',
      '| Password | do-not-print-markdown-table-password |',
    ],
    [
      'later Markdown table password field',
      '| Evidence | Password | do-not-print-later-table-password |',
    ],
    [
      'outer-pipe-free Markdown table password',
      'Field | Value\n--- | ---\nPassword | do-not-print-outer-pipe-free-password',
    ],
    [
      'HTML-emphasized password',
      '<strong>Password</strong>: do-not-print-html-password',
    ],
    [
      'heading italic password',
      '### _Password_: do-not-print-heading-password',
    ],
    ['raw access token', 'access_token=do-not-print-access-token'],
    ['camel access token', 'accessToken: do-not-print-camel-access-token'],
    ['compact API key', 'apikey=do-not-print-compact-api-key'],
    ['compact access token', 'accesstoken=do-not-print-compact-access-token'],
    ['compact auth token', 'authtoken=do-not-print-compact-auth-token'],
    [
      'raw refresh token',
      'Set-Cookie: refresh_token=do-not-print-refresh-token; HttpOnly',
    ],
    ['wrapped key', '{"wrappedKey":"do-not-print-wrapped-key"}'],
    ['unwrapped key', '{"unwrapped_key":"do-not-print-unwrapped-key"}'],
    [
      'encrypted item body',
      '{"encryptedItemBody":"do-not-print-encrypted-item"}',
    ],
    ['identity payload', '{"identity":{"email":"person@example.dev"}}'],
    [
      'provider payload',
      '{"providerPayload":{"account":"do-not-print-provider"}}',
    ],
    ['profile payload', '{"profile":{"name":"do-not-print-profile"}}'],
    [
      'secret-like schema field',
      '{"properties":{"password":{"type":"string"}}}',
    ],
    [
      'authorization credential',
      'Authorization: Bearer do-not-print-bearer-token',
    ],
    [
      'GitHub authorization credential',
      'Authorization: token do-not-print-github-token',
    ],
    [
      'digest authorization credential',
      'Authorization: Digest do-not-print-digest-credential',
    ],
    [
      'raw authorization credential',
      'Authorization: do-not-print-raw-credential',
    ],
    [
      'annotated authorization credential',
      'Authorization: Bearer <redacted> do-not-print-trailing-credential',
    ],
    [
      'Markdown-like prefix in raw authorization value',
      'Authorization: **Bearer',
    ],
    [
      'underscore-prefixed CGI authorization value',
      'HTTP_AUTHORIZATION=_Bearer',
    ],
    ['status-word password', 'password=disabled'],
    ['unchanged password', 'password=unchanged'],
    ['none password', 'password=none'],
    ['false password', 'password=false'],
    ['zero password', 'password=0'],
    ['null password', 'password=null'],
    ['none generic secret field', 'secrets=none'],
    [
      'malformed stale credential summary',
      '| Stale password/access/refresh/profile | disabled |',
    ],
    [
      'redacted password with trailing credential',
      'password=<redacted> do-not-print-trailing-password',
    ],
    ['status-word authorization', 'Authorization: Bearer passed'],
    [
      'CGI authorization credential',
      'HTTP_AUTHORIZATION=Bearer do-not-print-cgi-authorization',
    ],
    [
      'redirected CGI authorization credential',
      'REDIRECT_HTTP_AUTHORIZATION=Bearer do-not-print-redirected-authorization',
    ],
    [
      'bold Markdown authorization credential',
      '**Authorization**: Bearer do-not-print-bold-authorization',
    ],
    [
      'HTML-emphasized authorization credential',
      '<strong>Authorization</strong>: Bearer do-not-print-html-authorization',
    ],
    [
      'outer-pipe-free Markdown authorization table',
      'Field | Value\n--- | ---\nAuthorization | Bearer do-not-print-table-authorization',
    ],
    [
      'separator inside bold Markdown password',
      '**Password:** do-not-print-inside-bold-password',
    ],
    [
      'separator inside bold Markdown authorization',
      '**Authorization:** Bearer do-not-print-inside-bold-authorization',
    ],
    [
      'separator inside HTML password',
      '<strong>Password:</strong> do-not-print-inside-html-password',
    ],
    [
      'separator inside HTML authorization',
      '<strong>Authorization:</strong> Bearer do-not-print-inside-html-authorization',
    ],
    [
      'standalone GitHub personal access token',
      'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB',
    ],
    [
      'standalone Slack access token',
      'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx',
    ],
    [
      'JSON-escaped JWT',
      '{"result":"\\u0065yJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkb250LXByaW50In0.c2lnbmF0dXJlLXZhbHVl"}',
    ],
    [
      'JSON-escaped GitHub personal access token',
      '{"result":"g\\u0068p_0123456789abcdefghijklmnopqrstuvwxyzAB"}',
    ],
    [
      'JSON-escaped authorization credential',
      '{"result":"Authorization\\u003a Bearer do-not-print-json-authorization"}',
    ],
    [
      'bare JSON string secret assignment',
      JSON.stringify('password=do-not-print-bare-json-password'),
    ],
    [
      'generic JSON value secret assignment',
      JSON.stringify({
        result: 'password=do-not-print-generic-json-password',
      }),
    ],
    [
      'JSON string secret assignment beyond the decode limit',
      jsonStringifyTimes('password=do-not-print-deep-json-password', 5),
    ],
    [
      'standalone Unicode-escaped GitHub personal access token',
      String.raw`Observed: gh\u0070_0123456789abcdefghijklmnopqrstuvwxyzAB`,
    ],
    [
      'authentication Set-Cookie header',
      'Set-Cookie: connect.sid=s%3Ado-not-print-session.signature; HttpOnly',
    ],
    [
      'authentication Cookie header',
      'Cookie: theme=dark; sessionid=do-not-print-session; Path=/',
    ],
    [
      'Markdown list authentication Cookie header',
      '- Cookie: sessionid=do-not-print-list-session',
    ],
    [
      'Markdown table authentication Cookie header',
      '| Cookie | sessionid=do-not-print-table-session |',
    ],
    [
      'JSON authentication Cookie header',
      '{"Cookie":"sessionid=do-not-print-json-session"}',
    ],
    [
      'JSON authentication Set-Cookie header',
      '{"Set-Cookie":"connect.sid=do-not-print-json-session; HttpOnly"}',
    ],
    [
      'embedded authentication Cookie header',
      'Observed Cookie: sessionid=do-not-print-embedded-session',
    ],
    [
      'qualified embedded authentication Cookie header',
      'Observed headers.Cookie: sessionid=do-not-print-qualified-session',
    ],
    [
      'self-describing NextAuth session Cookie header',
      'Set-Cookie: __Secure-next-auth.session-token=do-not-print-nextauth-session; HttpOnly',
    ],
    [
      'custom authentication Cookie header',
      'Cookie: app-auth-cookie=do-not-print-custom-auth-cookie',
    ],
    [
      'OAuth state Cookie header',
      'Cookie: oauth_state=do-not-print-oauth-state',
    ],
    [
      'JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkb250LXByaW50In0.c2lnbmF0dXJlLXZhbHVl',
    ],
    [
      'vault ciphertext',
      '2.dGhpc2lzMTZieXRlc2l2IQ==|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'type 0 two-part vault ciphertext',
      '0.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'type 1 three-part vault ciphertext',
      '1.dGhpc2lzMTZieXRlc2l2IQ==|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'type 3 single-part vault ciphertext',
      '3.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
    ],
    [
      'type 4 single-part vault ciphertext',
      '4.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
    ],
    [
      'type 5 two-part vault ciphertext',
      '5.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'type 6 two-part vault ciphertext',
      '6.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'type 7 single-part vault ciphertext',
      '7.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
    ],
    [
      'private key',
      '-----BEGIN PRIVATE KEY-----\ndo-not-print-private-key\n-----END PRIVATE KEY-----',
    ],
    [
      'AGE private key block',
      '-----BEGIN AGE SECRET KEY-----\ndo-not-print-age-private-key\n-----END AGE SECRET KEY-----',
    ],
    [
      'AGE secret key',
      'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ',
    ],
    ['personal identity', 'Contact: person@real-company.dev'],
    [
      'JSON-escaped personal identity',
      '{"email":"person\\u0040real-company.dev"}',
    ],
    [
      'HTML decimal-entity personal identity',
      'Contact: person&#64;real-company.dev',
    ],
    [
      'HTML hexadecimal-entity personal identity',
      'Contact: person&#x40;real-company.dev',
    ],
    [
      'HTML named-entity personal identity',
      'Contact: person&commat;real-company.dev',
    ],
    ['percent-encoded personal identity', 'Contact: person%40real-company.dev'],
    [
      'Markdown-escaped personal identity',
      String.raw`Contact: person\@real-company.dev`,
    ],
    [
      'JavaScript code-point escaped personal identity',
      String.raw`Contact: person\u{40}real-company.dev`,
    ],
    [
      'quoted local-part personal identity',
      'Contact: "person"@real-company.dev',
    ],
    [
      'commented local-part personal identity',
      'Contact: person(comment)@real-company.dev',
    ],
    [
      'commented domain personal identity',
      'Contact: person@(comment)real-company.dev',
    ],
    ['dotless-domain personal identity', 'Contact: alice@corp'],
    ['address-literal personal identity', 'Contact: alice@[192.0.2.1]'],
    ['Unicode local identity', 'Contact: ユーザー@real-company.dev'],
    ['Unicode domain identity', 'Contact: person@例え.テスト'],
    ['Unicode reserved-domain identity', 'Contact: 名@example.test'],
    [
      'Unicode prefix on an allowed identity',
      'Contact: ユーザーsecurity@honowarden.com',
    ],
    [
      'Unicode suffix on an allowed identity',
      'Contact: security@honowarden.com例え',
    ],
    [
      'punctuation prefix on an allowed identity',
      'Contact: +security@honowarden.com',
    ],
    [
      'domain suffix on an allowed identity',
      'Contact: security@honowarden.com-evil',
    ],
    [
      'personal identity after an allowed identity',
      'Contacts: support@honowarden.com, person@real-company.dev',
    ],
    [
      'URL userinfo password on an allowed public host identity',
      'https://user:admin@honowarden.com/private',
    ],
    [
      'URL userinfo username on a reserved identity',
      'https://operator@example.test/private',
    ],
    [
      'protocol-relative URL userinfo',
      '//user:do-not-print-protocol-relative@honowarden.com/private',
    ],
    [
      'malformed URL-like userinfo',
      'https://user:do-not-print-malformed@/private',
    ],
  ])('rejects %s without reflecting content', (_name, unsafeContent) => {
    let thrown: unknown
    try {
      assertCredentialCloseoutContentSafe(unsafeContent)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'credential closeout content is unsafe',
    )
    expect((thrown as Error).message).not.toContain(unsafeContent)
  })

  it('finds a trailing secret in a maximum-sized delimiter-heavy line', () => {
    const suffix = '|password=do-not-print-bounded-scan'
    const unsafeContent = `${'field=ok|'.repeat(
      Math.floor((1024 * 1024 - suffix.length) / 9),
    )}${suffix}`

    expect(Buffer.byteLength(unsafeContent)).toBeLessThanOrEqual(1024 * 1024)
    expect(() => assertCredentialCloseoutContentSafe(unsafeContent)).toThrow(
      'credential closeout content is unsafe',
    )
  })

  it.each([
    ['ASCII', 'a'.repeat(1024 * 1024 + 1)],
    ['UTF-8', 'あ'.repeat(Math.floor((1024 * 1024) / 3) + 1)],
  ])(
    'rejects direct scanner %s input over the byte limit without reflection',
    (_name, oversizedContent) => {
      let thrown: unknown
      try {
        assertCredentialCloseoutContentSafe(oversizedContent)
      } catch (error) {
        thrown = error
      }

      expect(Buffer.byteLength(oversizedContent)).toBeGreaterThan(1024 * 1024)
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toBe(
        'credential closeout content is unsafe',
      )
      expect((thrown as Error).message).not.toContain(oversizedContent)
    },
  )

  it('accepts safe direct scanner input at the exact byte limit', () => {
    const maximumSizedContent = 'a'.repeat(1024 * 1024)

    expect(Buffer.byteLength(maximumSizedContent)).toBe(1024 * 1024)
    expect(() =>
      assertCredentialCloseoutContentSafe(maximumSizedContent),
    ).not.toThrow()
  })

  it('scans dense colon boundaries in linear time', () => {
    const safeContent = 'a:'.repeat(500_000)
    const startedAt = performance.now()

    expect(Buffer.byteLength(safeContent)).toBeLessThan(1024 * 1024)
    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('scans maximum-sized empty Markdown cells in linear time', () => {
    const safeContent = '|'.repeat(1024 * 1024)
    const startedAt = performance.now()

    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('scans dense benign JSON strings in linear time', () => {
    const safeContent = `[${'"a",'.repeat(200_000)}"a"]`
    const startedAt = performance.now()

    expect(Buffer.byteLength(safeContent)).toBeLessThan(1024 * 1024)
    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('scans an at-free dotted input in linear time', () => {
    const safeContent = 'safe.'.repeat(16_384)
    const startedAt = performance.now()

    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('scans maximum-sized adjacent at signs in linear time', () => {
    const safeContent = '@'.repeat(1_000_000)
    const startedAt = performance.now()

    expect(Buffer.byteLength(safeContent)).toBeLessThan(1024 * 1024)
    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('scans maximum-sized URL separators in linear time', () => {
    const safeContent = '//host/'.repeat(140_000)
    const startedAt = performance.now()

    expect(Buffer.byteLength(safeContent)).toBeLessThan(1024 * 1024)
    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('classifies a maximum-sized secret field in linear time', () => {
    const unsafeContent = `{"${Array.from(
      { length: 100_000 },
      () => 'password',
    ).join(' ')}":"redacted"}`
    const startedAt = performance.now()

    expect(Buffer.byteLength(unsafeContent)).toBeLessThan(1024 * 1024)
    expect(() => assertCredentialCloseoutContentSafe(unsafeContent)).toThrow(
      'credential closeout content is unsafe',
    )
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('scans a maximum-sized Markdown table in linear time', () => {
    const safeContent = `${'| field | ok '.repeat(70_000)}|`
    const startedAt = performance.now()

    expect(Buffer.byteLength(safeContent)).toBeLessThan(1024 * 1024)
    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it.each([
    ['digest', `sha256: ${'a'.repeat(64)}`],
    ['version', 'client version: 2026.6.1'],
    ['count', 'artifact count: 8'],
    ['enum', 'evidence level: local_official_client'],
    [
      'repository path',
      'path: docs/release/account-password-change-local-evidence.md',
    ],
    ['source ref', `sourceRef: cli-v2026.6.0@${'b'.repeat(40)}`],
    [
      'limitation text',
      'Limitation: no raw passwords, access tokens, wrapped keys, identities, provider payloads, or profiles are included.',
    ],
    ['empty secret count', 'Real secrets: none'],
    [
      'stale credential rejection count',
      '| Stale password/access/refresh/profile | 4 each before restart; 4 each after restart |',
    ],
    ['Markdown empty secret count', '| Real secrets | none |'],
    ['reserved identity', 'Contact: operator@example.test'],
    [
      'JSON-escaped reserved identity',
      '{"contact":"operator\\u0040example.test"}',
    ],
    ['HTML-encoded reserved identity', 'Contact: operator&#64;example.test'],
    [
      'percent-encoded allowed public identity',
      'Contact: security%40honowarden.com',
    ],
    [
      'JavaScript code-point escaped reserved identity',
      String.raw`Contact: operator\u{40}example.test`,
    ],
    ['quoted reserved identity', 'Contact: "operator"@example.test'],
    [
      'commented reserved identity',
      'Contact: operator(example fixture)@example.test',
    ],
    [
      'domain-commented reserved identity',
      'Contact: operator@(example fixture)example.test',
    ],
    [
      'allowed public identities',
      'Contacts: security@honowarden.com, support@honowarden.com.',
    ],
    [
      'allowed public identity after Japanese punctuation',
      '連絡先：security@honowarden.com',
    ],
    ['ordinary URL', 'Documentation: https://honowarden.com/docs'],
    [
      'percent-encoded password policy metadata',
      'password%20policy%3A%20minimum%2016%20characters',
    ],
    [
      'HTML-encoded password policy metadata',
      'password&#32;policy&#58;&#32;minimum&#32;16&#32;characters',
    ],
    [
      'JSON string metadata at the decode limit',
      jsonStringifyTimes('artifact count: 8', 4),
    ],
    [
      'ordinary outer-pipe-free Markdown table',
      'Field | Value\n--- | ---\nDigest | sha256:abc123',
    ],
    ['password policy metadata', 'password policy: minimum 16 characters'],
    ['access token count metadata', 'access token count: 0'],
    [
      'structured password policy metadata',
      'passwordPolicy: minimum 16 characters',
    ],
    ['structured access token count metadata', 'accessTokenCount: 0'],
    ['structured credential proof metadata', 'credentialProof: passed'],
    ['structured key digest metadata', `keyDigest: sha256:${'d'.repeat(64)}`],
    [
      'approved JSON credential metadata',
      JSON.stringify({
        passwordPolicy: 'minimum 16 characters',
        accessTokenCount: 0,
        credentialProof: 'passed',
        keyDigest: `sha256:${'d'.repeat(64)}`,
      }),
    ],
    [
      'non-authentication cookie',
      'Set-Cookie: cookie_consent=accepted; SameSite=Lax',
    ],
    ['redacted authentication cookie', 'Cookie: sessionid=<redacted>'],
    [
      'redacted JSON authentication cookie',
      '{"Cookie":"sessionid=<redacted>"}',
    ],
    [
      'JSON non-authentication cookie',
      '{"Set-Cookie":"cookie_consent=accepted; SameSite=Lax"}',
    ],
    [
      'non-authentication author preference cookie',
      'Set-Cookie: author_preferences=compact; SameSite=Lax',
    ],
    [
      'redacted Markdown list authentication cookie',
      '- Cookie: sessionid=<redacted>',
    ],
    [
      'redacted Markdown table authentication cookie',
      '| Cookie | sessionid=<redacted> |',
    ],
    ['redacted provider-token example', 'GitHub token form: ghp_<redacted>'],
    [
      'credential proof marker',
      'real aggregate source -> backup -> fresh restore -> credential proof: passed',
    ],
    ['colon-delimited package script', 'pnpm account:keys:lifecycle'],
    ['key digest metadata', `key digest: sha256:${'c'.repeat(64)}`],
    ['redacted password assignment', 'password: <redacted>'],
    [
      'redacted parenthesized password assignment',
      'Password (raw): <redacted>',
    ],
    [
      'redacted natural-language password assignment',
      'Password for user: <redacted>',
    ],
    [
      'password policy with natural-language qualifier',
      'Password policy for users: minimum 16 characters',
    ],
    ['redacted bold Markdown password', '- ** Password **: <redacted>'],
    [
      'redacted separator inside bold Markdown password',
      '**Password:** <redacted>',
    ],
    ['redacted access token assignment', 'access_token=[redacted]'],
    [
      'redacted bracketed access token assignment',
      'Access token [production]: [redacted]',
    ],
    [
      'access token count with natural-language qualifier',
      'Access token count for production: 0',
    ],
    [
      'redacted self-describing authentication cookie',
      'Set-Cookie: __Secure-next-auth.session-token=<redacted>; HttpOnly',
    ],
    ['redacted authorization', 'Authorization: <redacted>'],
    ['empty bearer authorization', 'Authorization: Bearer'],
    ['redacted bearer authorization', 'Authorization: Bearer <redacted>'],
    [
      'annotated redacted bearer authorization',
      'Authorization: Bearer <redacted> (rotated)',
    ],
    [
      'redacted arbitrary-scheme authorization',
      'Authorization: token [redacted]',
    ],
    ['redacted CGI authorization', 'HTTP_AUTHORIZATION=Bearer <redacted>'],
    [
      'redacted bold Markdown authorization',
      '**Authorization**: Bearer <redacted>',
    ],
    [
      'redacted separator inside bold Markdown authorization',
      '**Authorization:** Bearer <redacted>',
    ],
    [
      'redacted lowercase separator inside bold Markdown authorization',
      '**authorization:** Bearer <redacted>',
    ],
    [
      'redacted separator inside HTML password',
      '<strong>Password:</strong> <redacted>',
    ],
    [
      'redacted separator inside HTML authorization',
      '<strong>Authorization:</strong> Bearer <redacted>',
    ],
    [
      'redacted HTML-emphasized authorization',
      '<strong>Authorization</strong>: Bearer <redacted>',
    ],
    [
      'redacted outer-pipe-free Markdown authorization table',
      'Field | Value\n--- | ---\nAuthorization | Bearer <redacted>',
    ],
    [
      'empty redirected CGI authorization',
      'REDIRECT_HTTP_AUTHORIZATION=Bearer',
    ],
    [
      'type 0 malformed single-part text',
      '0.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
    ],
    [
      'type 1 malformed two-part text',
      '1.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'type 3 malformed two-part text',
      '3.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=|YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM=',
    ],
    [
      'type 5 malformed single-part text',
      '5.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
    ],
  ])('accepts approved %s metadata', (_name, safeContent) => {
    expect(() => assertCredentialCloseoutContentSafe(safeContent)).not.toThrow()
  })

  it('rejects stale, missing, untracked, extra, symlinked, and non-regular inputs', () => {
    const stale = createFixture()
    appendFileSync(
      join(stale.root, credentialCloseoutArtifactPaths[0]),
      '\ndrift\n',
    )
    expect(() => buildCredentialCloseoutPacket(stale.options)).toThrow()

    const missing = createFixture()
    unlinkSync(join(missing.root, credentialCloseoutArtifactPaths[0]))
    expect(() => buildCredentialCloseoutPacket(missing.options)).toThrow()

    const untracked = createFixture()
    expect(() =>
      buildCredentialCloseoutPacket({
        ...untracked.options,
        trackedPaths: untracked.options.trackedPaths.filter(
          (path) => path !== credentialCloseoutArtifactPaths[0],
        ),
      }),
    ).toThrow()

    const extra = createFixture()
    expect(() =>
      scanCredentialCloseoutArtifacts({
        ...extra.options,
        artifactPaths: [...credentialCloseoutArtifactPaths, 'extra.md'],
      }),
    ).toThrow(/artifact set is not canonical/)

    const escaped = createFixture()
    const outsideRoot = mkdtempSync(
      join(tmpdir(), 'credential-closeout-outside-'),
    )
    temporaryRoots.push(outsideRoot)
    const outsideRegistry = join(outsideRoot, 'registry.json')
    copyFileSync(escaped.options.registryPath, outsideRegistry)
    expect(() =>
      buildCredentialCloseoutPacket({
        ...escaped.options,
        registryPath: outsideRegistry,
      }),
    ).toThrow(/input path is not canonical/)

    const symlinked = createFixture()
    const symlinkPath = join(symlinked.root, credentialCloseoutArtifactPaths[0])
    const symlinkTarget = join(symlinked.root, 'outside.md')
    writeFileSync(symlinkTarget, readFileSync(symlinkPath))
    unlinkSync(symlinkPath)
    symlinkSync(symlinkTarget, symlinkPath)
    expect(() => buildCredentialCloseoutPacket(symlinked.options)).toThrow()

    const nonRegular = createFixture()
    const directoryPath = join(
      nonRegular.root,
      credentialCloseoutArtifactPaths[0],
    )
    unlinkSync(directoryPath)
    mkdirSync(directoryPath)
    expect(() => buildCredentialCloseoutPacket(nonRegular.options)).toThrow()
  })

  it('scans artifact bytes independently of their digest rejection', () => {
    const fixture = createFixture()
    const secret = 'do-not-print-artifact-password'
    appendFileSync(
      join(fixture.root, credentialCloseoutArtifactPaths[0]),
      `\n{"password":"${secret}"}\n`,
    )

    let thrown: unknown
    try {
      scanCredentialCloseoutArtifacts(fixture.options)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'credential closeout content is unsafe',
    )
    expect((thrown as Error).message).not.toContain(secret)
  })

  it('rejects oversized, invalid UTF-8, and source-digest-drift inputs', () => {
    const oversized = createFixture()
    writeFileSync(
      join(oversized.root, credentialCloseoutArtifactPaths[0]),
      Buffer.alloc(1024 * 1024 + 1, 0x61),
    )
    expect(() => scanCredentialCloseoutArtifacts(oversized.options)).toThrow(
      /input exceeds the size limit/,
    )

    const invalidUtf8 = createFixture()
    writeFileSync(
      join(invalidUtf8.root, credentialCloseoutArtifactPaths[0]),
      Buffer.from([0xc3, 0x28]),
    )
    expect(() => scanCredentialCloseoutArtifacts(invalidUtf8.options)).toThrow(
      /input is not UTF-8 text/,
    )

    const sourceDrift = createFixture()
    appendFileSync(sourceDrift.options.registryPath, '\n')
    expect(() => buildCredentialCloseoutPacket(sourceDrift.options)).toThrow(
      /source digest mismatch/,
    )
  })

  it('rejects stale or noncanonical packet bytes and unsafe packet paths', () => {
    const nondeterministic = createFixture({ includePacket: true })
    const packet = buildCredentialCloseoutPacket(
      nondeterministic.options,
    ) as Packet & { generatedAt?: string }
    packet.generatedAt = '2026-07-22T00:00:00Z'
    writeFileSync(
      nondeterministic.packetPath,
      `${JSON.stringify(packet, null, 2)}\n`,
    )
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...nondeterministic.options,
        packetPath: nondeterministic.packetPath,
      }),
    ).toThrow(/packet is stale or noncanonical/)

    const duplicate = createFixture({ includePacket: true })
    const duplicateText = readFileSync(duplicate.packetPath, 'utf8').replace(
      '  "schemaVersion": 1,',
      '  "schemaVersion": 1,\n  "schemaVersion": 1,',
    )
    writeFileSync(duplicate.packetPath, duplicateText)
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...duplicate.options,
        packetPath: duplicate.packetPath,
      }),
    ).toThrow(/packet JSON is invalid/)

    const reformatted = createFixture({ includePacket: true })
    writeFileSync(
      reformatted.packetPath,
      `${JSON.stringify(buildCredentialCloseoutPacket(reformatted.options))}\n`,
    )
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...reformatted.options,
        packetPath: reformatted.packetPath,
      }),
    ).toThrow(/packet is stale or noncanonical/)

    const symlinked = createFixture({ includePacket: true })
    const target = join(symlinked.root, 'outside-packet.json')
    copyFileSync(symlinked.packetPath, target)
    unlinkSync(symlinked.packetPath)
    symlinkSync(target, symlinked.packetPath)
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...symlinked.options,
        packetPath: symlinked.packetPath,
      }),
    ).toThrow(/packet path is unsafe/)

    const byteOrderMarked = createFixture({ includePacket: true })
    writeFileSync(
      byteOrderMarked.packetPath,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        readFileSync(byteOrderMarked.packetPath),
      ]),
    )
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...byteOrderMarked.options,
        packetPath: byteOrderMarked.packetPath,
      }),
    ).toThrow(/packet (?:JSON is invalid|is stale or noncanonical)/)
  })

  it('requires the canonical packet to be tracked', () => {
    const fixture = createFixture({ includePacket: true })
    const original = readFileSync(fixture.packetPath)
    const trackedPaths = fixture.options.trackedPaths.filter(
      (path) => path !== credentialCloseoutPacketPath,
    )

    expect(() =>
      verifyCredentialCloseoutPacket({
        ...fixture.options,
        trackedPaths,
        packetPath: fixture.packetPath,
      }),
    ).toThrow(/packet is not tracked/)
    expect(() =>
      writeCredentialCloseoutPacket({
        ...fixture.options,
        trackedPaths,
      }),
    ).toThrow(/packet is not tracked/)
    expect(readFileSync(fixture.packetPath).equals(original)).toBe(true)
  })

  it('accepts an equivalent CRLF checkout but rejects lone CR bytes', () => {
    const fixture = createFixture({ includePacket: true })
    const canonical = readFileSync(fixture.packetPath, 'utf8')
    writeFileSync(fixture.packetPath, canonical.replaceAll('\n', '\r\n'))

    expect(
      verifyCredentialCloseoutPacket({
        ...fixture.options,
        packetPath: fixture.packetPath,
      }),
    ).toMatchObject({ status: 'passed' })

    writeFileSync(fixture.packetPath, canonical.replace('\n', '\r'))
    expect(() =>
      verifyCredentialCloseoutPacket({
        ...fixture.options,
        packetPath: fixture.packetPath,
      }),
    ).toThrow(/unsupported line endings/)
  })

  it('publishes atomically with stable bytes and rejects a symlink output', () => {
    const fixture = createFixture()
    const first = writeCredentialCloseoutPacket(fixture.options)
    const firstBytes = readFileSync(fixture.packetPath)
    const second = writeCredentialCloseoutPacket(fixture.options)
    const secondBytes = readFileSync(fixture.packetPath)

    expect(first).toEqual(second)
    expect(firstBytes.equals(secondBytes)).toBe(true)
    expect(first.sha256).toBe(
      createHash('sha256').update(firstBytes).digest('hex'),
    )
    expect(statSync(fixture.packetPath).mode & 0o777).toBe(0o644)
    expect(
      readdirSync(dirname(fixture.packetPath)).filter((name) =>
        name.endsWith('.tmp'),
      ),
    ).toEqual([])

    const symlinked = createFixture()
    const target = join(symlinked.root, 'outside-packet.json')
    const sentinel = 'target-must-not-change\n'
    writeFileSync(target, sentinel)
    mkdirSync(dirname(symlinked.packetPath), { recursive: true })
    symlinkSync(target, symlinked.packetPath)

    expect(() => writeCredentialCloseoutPacket(symlinked.options)).toThrow(
      /packet path is unsafe/,
    )
    expect(readFileSync(target, 'utf8')).toBe(sentinel)
  })

  it('rejects oversized generated bytes before replacing the packet', () => {
    const fixture = createFixture({ includePacket: true })
    const original = readFileSync(fixture.packetPath)

    expect(() =>
      writeCredentialCloseoutPacket({
        ...fixture.options,
        packetByteLimit: original.length - 1,
      }),
    ).toThrow(/packet exceeds the size limit/)
    expect(readFileSync(fixture.packetPath).equals(original)).toBe(true)
  })

  it('prints only a bounded verification report from the CLI', async () => {
    const secretValues = [
      'do-not-print-password-env',
      'do-not-print-access-token-env',
      'do-not-print-provider-payload-env',
    ]
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HONOWARDEN_TEST_PASSWORD: secretValues[0],
        HONOWARDEN_TEST_ACCESS_TOKEN: secretValues[1],
        HONOWARDEN_TEST_PROVIDER_PAYLOAD: secretValues[2],
      },
    })
    const report = JSON.parse(result.stdout)

    expect(result.stderr).toBe('')
    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      claims: 11,
      artifacts: 8,
      scannedInputs: 11,
      liveEvidenceLevels: [],
    })
    expect(Object.keys(report)).toEqual([
      'schemaVersion',
      'status',
      'claims',
      'artifacts',
      'scannedInputs',
      'bytes',
      'sha256',
      'liveEvidenceLevels',
      'limitations',
    ])
    for (const secret of secretValues) {
      expect(result.stdout).not.toContain(secret)
    }
  })

  it('prints a fixed non-disclosing CLI failure', async () => {
    const secret = 'do-not-print-unknown-option'
    let rejected: (Error & { stdout?: string; stderr?: string }) | undefined
    try {
      await execFileAsync(process.execPath, [scriptPath, `--${secret}`], {
        cwd: repoRoot,
      })
    } catch (error) {
      rejected = error as Error & { stdout?: string; stderr?: string }
    }

    expect(rejected).toBeDefined()
    expect(rejected?.stdout).toBe('')
    expect(rejected?.stderr).toBe('credential closeout verification failed\n')
    expect(rejected?.stderr).not.toContain(secret)
  })
})

type Packet = {
  schemaVersion: number
  status: string
  registry: Record<string, unknown>
  sourcePins: {
    programBaseCommit: string
    clients: Array<Record<string, unknown>>
  }
  evidenceLevels: Array<{
    id: string
    rank: number
    scope: string
  }>
  claims: Array<{
    id: string
    status: string
    executionLevel: string
    evidenceLevel: string
    sourceGeneration: { kind: string; commit: string }
    artifacts: Array<{
      path: string
      evidenceLevel: string
      sha256: string
    }>
    clientSourceIds: string[]
    limitations: string[]
    sha256: string
  }>
  counts: Record<string, number>
  liveEvidenceLevels: string[]
  limitations: string[]
}

function sameKeys(value: object, expected: string[]) {
  return JSON.stringify(Object.keys(value)) === JSON.stringify(expected)
}

function jsonStringifyTimes(value: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    value = JSON.stringify(value)
  }
  return value
}

function createFixture({ includePacket = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'credential-closeout-'))
  temporaryRoots.push(root)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    claims: Array<{ artifacts: Array<{ path: string }> }>
  }
  const paths = [
    'compat/credential-evidence.json',
    'compat/credential-evidence.schema.json',
    ...new Set(
      registry.claims.flatMap((claim) =>
        claim.artifacts.map((artifact) => artifact.path),
      ),
    ),
  ]
  for (const path of paths) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(repoRoot, path), target)
  }
  const options = {
    repoRoot: root,
    registryPath: join(root, 'compat/credential-evidence.json'),
    schemaPath: join(root, 'compat/credential-evidence.schema.json'),
    trackedPaths: [...paths, credentialCloseoutPacketPath],
  }
  const fixturePacketPath = join(root, credentialCloseoutPacketPath)
  if (includePacket) {
    mkdirSync(dirname(fixturePacketPath), { recursive: true })
    writeFileSync(
      fixturePacketPath,
      serializeCredentialCloseoutPacket(buildCredentialCloseoutPacket(options)),
    )
  }
  return { root, options, packetPath: fixturePacketPath }
}
