import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL, fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { hasControlCharacter } from './policy.mjs'
import {
  admitProbe,
  remainingBudget,
  projectedResult,
  decodeExternalUtf8,
  requirePayloadPath,
  decodeDesktopPayload,
} from './preflight-policy.mjs'
import { migrationStatements } from './preflight.mjs'

const input = {
  companyCommit: '2deeee0cf159da92babc86e09de44c12eea2aa93',
  platform: 'win32',
  arch: 'x64',
  nodeVersion: '22.22.0',
  expiresAtMs: 301000,
  createdAtMs: 1000,
  freeBytes: 2 ** 30,
  freshHostedGuest: true,
}
test('preauth admission binds exact source/runtime, finite absolute lease and minimum reserve', () => {
  assert.equal(admitProbe(input, 1000), true)
  for (const patch of [
    { companyCommit: 'foreign' },
    { platform: 'darwin' },
    { arch: 'arm64' },
    { nodeVersion: '22.23.3' },
    { expiresAtMs: 301001 },
    { freeBytes: 2 ** 30 - 1 },
    { freshHostedGuest: false },
    { createdAtMs: 1001 },
  ])
    assert.throws(() => admitProbe({ ...input, ...patch }, 1000))
  assert.throws(() => admitProbe(input, 301000))
})
test('all waits consume the same deadline and never reset an expired lease', () => {
  assert.equal(remainingBudget(301000, 300500, 10000), 500)
  assert.throws(() => remainingBudget(301000, 301000, 10000))
})
test('safe result excludes raw exceptions, URLs, credentials and unproved acceptance', () => {
  const result = projectedResult({
    gui: true,
    dpapi: true,
    credentialMarker: true,
    worker: true,
    cleanup: true,
    raw: 'private-value',
  })
  assert.equal(result.authenticated, false)
  assert.equal(result.windows11Acceptance, false)
  assert.equal(JSON.stringify(result).includes('private-value'), false)
})
test('workflow restricts public same-repo trusted PR paths and retains pinned tool integrity', async () => {
  let source
  try {
    source = await readFile(
      new URL('./hosted-windows-native.yml', import.meta.url),
      'utf8',
    )
  } catch {
    source = await readFile(
      new URL(
        '../../.github/workflows/hosted-windows-native.yml',
        import.meta.url,
      ),
      'utf8',
    )
  }
  assert.match(source, /windows-2025/)
  assert.match(source, /github.event.repository.private == false/)
  assert.match(
    source,
    /github.event.pull_request.head.repo.full_name == github.repository/,
  )
  assert.match(source, /task\/windows-hosted-native-preflight-/)
  assert.match(source, /contents: read/)
  assert.match(source, /corepack@0.34.0/)
  assert.match(source, /--frozen-lockfile --ignore-scripts/)
  assert.match(source, /if: always\(\)/)
  assert.doesNotMatch(
    source,
    /upload-artifact|secrets\.|COREPACK_INTEGRITY_KEYS|id-token: write|--no-sandbox/,
  )
})
test('migration parser keeps triggers whole and refuses incomplete trailing SQL', () => {
  assert.deepEqual(
    migrationStatements(
      'CREATE TABLE t(x);\nCREATE TRIGGER a AFTER INSERT ON t\nBEGIN\n UPDATE t SET x=1;\nEND;\n',
    ),
    [
      'CREATE TABLE t(x);',
      'CREATE TRIGGER a AFTER INSERT ON t\nBEGIN\n UPDATE t SET x=1;\nEND;',
    ],
  )
  assert.throws(() => migrationStatements('CREATE TABLE incomplete(x)'))
})
test('source retains marker-only storage, exact PID/window identity and independent cleanup', async () => {
  const ps = await readFile(new URL('./preflight.ps1', import.meta.url), 'utf8')
  const native = await readFile(
    new URL('./preauth-native.cs', import.meta.url),
    'utf8',
  )
  const runtime = await readFile(
    new URL('./preflight.mjs', import.meta.url),
    'utf8',
  )
  assert.match(ps, /finally \{/)
  assert.match(ps, /Cleanup-Owned/)
  assert.match(ps, /TerminateJobObject/)
  assert.match(ps, /RemoveMarker/)
  assert.match(ps, /Get-AuthenticodeSignature/)
  assert.match(ps, /0x8664/)
  assert.match(native, /CredDeleteW/)
  assert.match(native, /return !MarkerExists\(target\)/)
  assert.match(native, /DataProtectionScope.CurrentUser/)
  assert.doesNotMatch(native, /CredEnumerate|CredUIPrompt|LogonUser/)
  assert.doesNotMatch(
    ps,
    /New-SelfSignedCertificate|Import-Certificate|Cert:\\/,
  )
  assert.doesNotMatch(
    runtime,
    /accountFixture|bootstrap|identity\/connect\/token|nativeLogin|ui\.fill\(/,
  )
})
test('cleanup touches a credential marker only after its ownership was journaled', async () => {
  const ps = await readFile(new URL('./preflight.ps1', import.meta.url), 'utf8')
  assert.match(ps, /markerClaimed=\$false/)
  assert.match(ps, /if \(\$state.markerClaimed -eq \$true\)/)
  assert.ok(
    ps.indexOf('::MarkerExists($state.marker)') <
      ps.indexOf('$state.markerClaimed=$true'),
  )
  assert.ok(
    ps.indexOf('$state.markerClaimed=$true') <
      ps.indexOf('::MarkerProbe($state.marker)'),
  )
  assert.match(ps, /jobCreated=\$false/)
})
test('unknown or preexisting journals retain custody until authenticated owned cleanup succeeds', async () => {
  const ps = await readFile(new URL('./preflight.ps1', import.meta.url), 'utf8')
  assert.match(ps, /\$journalAuthenticated=\$false/)
  assert.match(
    ps,
    /\$clean=\(\$journalAuthenticated -or -not \(Test-Path -LiteralPath \$statePath\)\)/,
  )
  assert.match(ps, /if \(\$state -and \$journalAuthenticated\)/)
  assert.match(
    ps,
    /if \(\$clean -and \$journalAuthenticated -and \(Test-Path -LiteralPath \$statePath\)\)/,
  )
  assert.ok(
    ps.indexOf("throw 'preexisting_journal_retained'") < ps.indexOf('$state=@'),
  )
})
test('a valid capability projection cannot bypass failed wait or nonzero native exit', async () => {
  const ps = await readFile(new URL('./preflight.ps1', import.meta.url), 'utf8')
  assert.match(ps, /if \(\$waitCode -ne 0\) \{ throw 'native_wait_failed' \}/)
  assert.match(
    ps,
    /GetExitCodeProcess\(\$processInfo.Process,\[ref\]\$exitCode\)/,
  )
  assert.match(ps, /\$exitCode -ne 0\) \{ throw 'native_exit_failed' \}/)
  assert.ok(
    ps.indexOf('GetExitCodeProcess') < ps.indexOf('$result=Get-Content'),
  )
})

test('external data decoder requires canonical bounded Base64 and valid UTF-8', () => {
  assert.equal(decodeExternalUtf8('Zg==', 1), 'f')
  assert.equal(
    decodeExternalUtf8(Buffer.from('α/β').toString('base64'), 8),
    'α/β',
  )
  for (const value of ['', 'Zg', 'Zh==', 'Zg==\n', 'Zg--', 'wyg=', 42])
    assert.throws(() => decodeExternalUtf8(value, 8))
  assert.throws(() => decodeExternalUtf8('Zm9v', 2))
})

test('decoded member paths reject absolute, traversal, Windows and control-character aliases', () => {
  assert.equal(
    requirePayloadPath('resources/native-client.dll'),
    'resources/native-client.dll',
  )
  for (const value of [
    '',
    '/absolute',
    '../escape',
    'a/../b',
    'a/./b',
    'a//b',
    'C:/drive',
    'a\\b',
    'a\u0000b',
    'a\nb',
    'a'.repeat(2049),
    null,
  ])
    assert.throws(() => requirePayloadPath(value))
})

test('encoded official manifest preserves the exact reviewed member bytes and executable identity', async () => {
  const encoded = JSON.parse(
    await readFile(
      new URL('./desktop-payload-manifest.json', import.meta.url),
      'utf8',
    ),
  )
  const decoded = decodeDesktopPayload(encoded)
  assert.equal(decoded.files.length, 85)
  assert.equal(
    decoded.files.filter(
      (file) =>
        file.sha256 ===
        '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a',
    ).length,
    1,
  )
  assert.equal(
    decoded.executablePath,
    decoded.files.find(
      (file) =>
        file.sha256 ===
        '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a',
    ).path,
  )
  assert.equal(new URL(decoded.assetUrl).hostname, 'github.com')
  assert.match(decoded.appDataVariable, /^[A-Z][A-Z0-9_]*$/)
  assert.throws(() =>
    decodeDesktopPayload({
      ...encoded,
      payloadBase64: Buffer.from('[]').toString('base64'),
    }),
  )
  assert.throws(() =>
    decodeDesktopPayload({ ...encoded, encoding: 'unbounded' }),
  )
})

test('lint-compatible control character predicate preserves both former exact ASCII ranges', () => {
  for (let code = 0; code <= 255; code++) {
    const character = String.fromCodePoint(code)
    assert.equal(hasControlCharacter(character), code <= 31 || code === 127)
    assert.equal(
      hasControlCharacter(character, true),
      code <= 32 || code === 127,
    )
  }
})

test('bootstrap refuses shim overwrites and keeps private-prefix cleanup and exact tool integrity', async () => {
  let source
  try {
    source = await readFile(
      new URL('./hosted-windows-native.yml', import.meta.url),
      'utf8',
    )
  } catch {
    source = await readFile(
      new URL(
        '../../.github/workflows/hosted-windows-native.yml',
        import.meta.url,
      ),
      'utf8',
    )
  }
  assert.match(
    source,
    /--prefix \$bootstrap --no-save --package-lock=false --bin-links=false corepack@0.34.0/,
  )
  assert.match(source, /node \$corepack pnpm --version/)
  assert.match(source, /finally \{/)
  assert.match(source, /bootstrap_cleanup_unproved/)
  assert.doesNotMatch(
    source,
    /npm install --global|--force|corepack enable|COREPACK_INTEGRITY_KEYS/,
  )
  assert.equal(
    (source.match(/GIT_CONFIG_KEY_0: core.autocrlf/g) ?? []).length,
    2,
  )
  assert.equal((source.match(/GIT_CONFIG_VALUE_0: 'false'/g) ?? []).length, 2)
})

test('failure diagnostics expose only fixed phase and allowlisted codes while preserving custody', async () => {
  const ps = await readFile(new URL('./preflight.ps1', import.meta.url), 'utf8')
  assert.match(ps, /phase='source_integrity'/)
  assert.match(ps, /\$allowedFailureCodes -ccontains \$code/)
  assert.match(ps, /else \{ 'unexpected_preauth_failure' \}/)
  assert.doesNotMatch(
    ps,
    /failureCode=\$_.Exception|Write-Error|ScriptStackTrace|InvocationInfo/,
  )
  assert.match(ps, /\$clean -and \$journalAuthenticated/)
})

test('payload admission preserves the JSON root array and the strict reviewed 85-member gate', async () => {
  const ps = await readFile(new URL('./preflight.ps1', import.meta.url), 'utf8')
  assert.equal(/\$files=ConvertFrom-Json -InputObject \$text/.test(ps), true)
  assert.equal(
    /if \(\$files -isnot \[array\] -or \$files.Count -ne 85\) \{ throw 'asset_members' \}/.test(
      ps,
    ),
    true,
  )
  assert.equal(/\$files=@\(\$text \| ConvertFrom-Json\)/.test(ps), false)
})

test(
  'Windows PowerShell 5.1 parses the real controller and admits the exact public manifest before download',
  { skip: process.platform !== 'win32' },
  () => {
    const systemRoot = process.env.SystemRoot
    if (
      typeof systemRoot !== 'string' ||
      !/^[A-Za-z]:\\/.test(systemRoot) ||
      systemRoot.length > 243 ||
      hasControlCharacter(systemRoot)
    )
      throw Error('powershell_system_root_unavailable')
    const root = dirname(fileURLToPath(import.meta.url)).replace(/'/g, "''")
    // Only the two public-data functions are evaluated; controller admission,
    // network, journal, native and cleanup statements remain inert.
    const command = `
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'powershell_version' }
$root='${root}'
$tokens=$null; $parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'preflight.ps1'),[ref]$tokens,[ref]$parseErrors)
if ($null -ne $parseErrors -and $parseErrors.Length -ne 0) { throw 'powershell_parse' }
$names=@('Decode-ExternalUtf8','Read-ExternalPayload')
$functions=@($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -ccontains $_.Name })
if ($functions.Count -ne 2 -or @($functions.Name | Select-Object -Unique).Count -ne 2) { throw 'public_functions' }
$definition=[ScriptBlock]::Create(($functions | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)
. $definition
$legacy=@('[1,2]' | ConvertFrom-Json)
if ($legacy.Count -ne 1 -or $legacy[0] -isnot [array] -or $legacy[0].Count -ne 2) { throw 'legacy_array_control' }
$direct=ConvertFrom-Json -InputObject '[1,2]'
if ($direct -isnot [array] -or $direct.Count -ne 2) { throw 'direct_array_control' }
$single=ConvertFrom-Json -InputObject '[1]'
if ($single -isnot [array] -or $single.Count -ne 1) { throw 'single_array_control' }
$object=ConvertFrom-Json -InputObject '{"x":1}'
if ($object -is [array]) { throw 'object_array_control' }
$payload=Read-ExternalPayload
if ($payload.files -isnot [array] -or $payload.files.Count -ne 85) { throw 'public_manifest_control' }
foreach ($file in $payload.files) { if ($file -is [array] -or $file.path -isnot [string] -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $file.bytes -le 0) { throw 'public_member_control' } }
$executables=@($payload.files | Where-Object { $_.sha256 -eq '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a' })
if ($executables.Count -ne 1) { throw 'public_executable_control' }
[Console]::Out.Write('{"object":"windowsPayloadControl","legacyWrapperCount":1,"directCount":2,"members":85,"parserErrors":0}')
`
    let output
    try {
      output = execFileSync(
        join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(command, 'utf16le').toString('base64'),
        ],
        {
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 4096,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            SystemRoot: systemRoot,
            windir: systemRoot,
            PATH: join(systemRoot, 'System32'),
            PSModulePath: join(
              systemRoot,
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'Modules',
            ),
          },
        },
      )
    } catch {
      // Never forward child errors, output, command text or environment values.
      throw Error('powershell_public_payload_control_failed')
    }
    if (
      output.trim() !==
      '{"object":"windowsPayloadControl","legacyWrapperCount":1,"directCount":2,"members":85,"parserErrors":0}'
    )
      throw Error('powershell_public_payload_projection_failed')
  },
)
