import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL, fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { EventEmitter } from 'node:events'
import { createWindowsHelper, attachOwnedPage } from './windows.mjs'
import { hasControlCharacter } from './policy.mjs'
import {
  admitProbe,
  remainingBudget,
  projectedResult,
  nativeFailureCode,
  decodeExternalUtf8,
  requirePayloadPath,
  decodeDesktopPayload,
  publicControlFailureCode,
  publicExecFailureMetadata,
} from './preflight-policy.mjs'
import { migrationStatements } from './preflight.mjs'
import {
  PUBLIC_PHASES,
  PUBLIC_SUCCESS,
  decodePublicControlStream,
  decodePublicControlError,
  publicControlPhase,
} from './public-control-phases.mjs'

test('native helper failures expose only fixed phases and retain child exit evidence', async () => {
  for (const [code, expected] of [
    ['windows_helper_listener', 'windows_helper_listener'],
    ['private-value', 'windows_helper_failed'],
  ]) {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = () => {}
    child.stdin = new EventEmitter()
    child.stdin.end = () => {
      child.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ object: 'windowsHelperFailure', code })),
      )
      child.emit('close', 1)
    }
    const helper = createWindowsHelper('/public', { spawner: () => child })
    await assert.rejects(helper('ProcessProof', {}), { code: expected })
    assert.equal(nativeFailureCode({ code: expected }), expected)
  }
  await assert.rejects(
    attachOwnedPage({ child: { exitCode: 0 }, timeoutMs: 100 }),
    { code: 'desktop_process_exited' },
  )
})

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
test('native diagnostics use only closed phases and own data error codes', () => {
  assert.equal(nativeFailureCode(new Error('private-token')), 'other')
  assert.equal(nativeFailureCode(new Error('r2_probe')), 'r2_probe')
  assert.equal(
    nativeFailureCode({ code: 'ERR_RUNTIME_FAILURE' }),
    'ERR_RUNTIME_FAILURE',
  )
  assert.equal(
    nativeFailureCode(Object.create({ code: 'ERR_RUNTIME_FAILURE' })),
    'other',
  )
  assert.equal(
    nativeFailureCode({
      get code() {
        throw Error('private')
      },
    }),
    'other',
  )
  const result = projectedResult({
    nodePhase: 'worker_start',
    nodeFailure: 'ERR_RUNTIME_FAILURE',
  })
  assert.equal(result.nodePhase, 'worker_start')
  assert.equal(result.nodeFailure, 'ERR_RUNTIME_FAILURE')
  assert.equal(result.authenticated, false)
  assert.equal(
    projectedResult({ nodePhase: 'private', nodeFailure: 'private' })
      .nodeFailure,
    'other',
  )
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
  assert.match(source, /node --test "\$env:PACKET\/preflight\.node-check\.mjs"/)
  assert.equal(
    fileURLToPath(import.meta.url).endsWith('preflight.node-check.mjs'),
    true,
  )
  await assert.rejects(
    readFile(new URL('./preflight.test.mjs', import.meta.url)),
    { code: 'ENOENT' },
  )
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

test('public parser failure frames bind exact finite phase/code pairs', () => {
  const generic = 'powershell_public_payload_control_failed'
  const frame = {
    object: 'windowsPayloadControlFailure',
    phase: 'parser',
    code: 'powershell_parse',
  }
  assert.equal(
    publicControlFailureCode(JSON.stringify(frame)),
    generic + '_parser_powershell_parse',
  )
  assert.equal(
    publicControlFailureCode(
      JSON.stringify({ ...frame, code: 'unexpected_public_control_failure' }),
    ),
    generic + '_parser_unexpected_public_control_failure',
  )
  assert.equal(
    publicControlFailureCode(
      JSON.stringify({ ...frame, phase: 'manifest', code: 'asset_members' }),
    ),
    generic + '_manifest_asset_members',
  )
})

test('public parser failure frames reject arbitrary fields, labels and raw string leaks', () => {
  const generic = 'powershell_public_payload_control_failed'
  const frame = {
    object: 'windowsPayloadControlFailure',
    phase: 'parser',
    code: 'powershell_parse',
  }
  for (const value of [
    false,
    undefined,
    {},
    JSON.stringify({ ...frame, raw: 'private-test-marker' }),
    JSON.stringify({ ...frame, phase: 'arbitrary' }),
    JSON.stringify({ ...frame, code: 'private-test-marker' }),
    JSON.stringify({ ...frame, code: 'public_member_control' }),
    JSON.stringify({
      phase: frame.phase,
      object: frame.object,
      code: frame.code,
    }),
    '{"object":"windowsPayloadControlFailure","phase":"parser","phase":"members","code":"powershell_parse"}',
    JSON.stringify(frame) + '\n',
    'private-test-marker' + JSON.stringify(frame),
    'x'.repeat(4097),
    Buffer.from([255]),
  ]) {
    const result = publicControlFailureCode(value)
    assert.equal(result, generic)
    assert.equal(result.includes('private-test-marker'), false)
  }
})

test('public exec failure metadata uses closed code/status buckets and only output counts', () => {
  const stdout =
    '{"object":"windowsPayloadControlFailure","phase":"parser","code":"powershell_parse"}'
  for (const code of [
    'ETIMEDOUT',
    'ENOENT',
    'EACCES',
    'ENOBUFS',
    'E2BIG',
    'OTHER',
  ])
    assert.deepEqual(
      publicExecFailureMetadata({ code, status: 1, stdout, stderr: 'x' }),
      {
        object: 'windowsPublicControlExecFailure',
        code,
        statusBucket: 'nonzero',
        stdoutType: 'string',
        stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
        stdoutFrameValid: true,
        stderrBytes: 1,
      },
    )
  assert.equal(publicExecFailureMetadata({ status: 0 }).statusBucket, 'zero')
  assert.equal(publicExecFailureMetadata({ status: null }).statusBucket, 'null')
  assert.equal(
    publicExecFailureMetadata({ status: -1 }).statusBucket,
    'nonzero',
  )
  assert.equal(publicExecFailureMetadata({ status: NaN }).statusBucket, 'other')
  assert.equal(
    publicExecFailureMetadata({ stdout: Buffer.from([255]) }).stdoutBytes,
    1,
  )
  assert.equal(
    publicExecFailureMetadata({ stdout: Buffer.from(stdout) }).stdoutFrameValid,
    false,
  )
})

test('public exec failure metadata rejects unknown fields and never returns raw strings', () => {
  const marker = 'private-test-marker'
  const result = publicExecFailureMetadata({
    code: marker,
    status: marker,
    stdout: marker,
    stderr: marker,
    message: marker,
    cmd: marker,
    stack: marker,
    cause: { message: marker },
  })
  assert.deepEqual(result, {
    object: 'windowsPublicControlExecFailure',
    code: 'OTHER',
    statusBucket: 'other',
    stdoutType: 'string',
    stdoutBytes: marker.length,
    stdoutFrameValid: false,
    stderrBytes: marker.length,
  })
  assert.equal(JSON.stringify(result).includes(marker), false)
  for (const value of [false, undefined, marker, { stdout: {}, stderr: false }])
    assert.equal(
      JSON.stringify(publicExecFailureMetadata(value)).includes(marker),
      false,
    )
})

test('cold public control accepts only the full ordered prefix and exact original success', () => {
  const prefix = PUBLIC_PHASES.join('\n') + '\n'
  assert.equal(decodePublicControlStream(prefix + PUBLIC_SUCCESS).success, true)
  for (const value of [
    PUBLIC_SUCCESS,
    prefix,
    'ENTRY\n' + PUBLIC_SUCCESS,
    prefix + PUBLIC_SUCCESS + '\n',
  ])
    assert.equal(decodePublicControlStream(value).success, false)
  for (let i = 0; i <= PUBLIC_PHASES.length; i++) {
    const value = i ? PUBLIC_PHASES.slice(0, i).join('\n') + '\n' : ''
    const decoded = decodePublicControlStream(value)
    assert.equal(decoded.prefixValid, true)
    assert.equal(decoded.phase, i ? PUBLIC_PHASES[i - 1] : 'NONE')
    assert.equal(decoded.success, false)
  }
})
test('cold public prefix rejects skipped repeated reordered truncated and secret frames', () => {
  for (const value of [
    'VERSION_OK\n',
    'ENTRY\nENTRY\n',
    'ENTRY\nPARSER_BEGIN\n',
    'ENT',
    'ENTRY\r\n',
    'ENTRY\nprivate-secret-marker',
    'x'.repeat(4097),
    Buffer.from('ENTRY\n'),
    null,
    {},
    1,
  ]) {
    const result = decodePublicControlStream(value)
    assert.equal(result.prefixValid, false)
    assert.equal(result.success, false)
    assert.equal(result.phase, 'NONE')
    assert.equal(
      JSON.stringify(result).includes('private-secret-marker'),
      false,
    )
  }
})
test('cold public terminal failure keeps fixed legacy code and never admits success', () => {
  const prefix = PUBLIC_PHASES.slice(0, 4).join('\n') + '\n'
  const terminal =
    '{"object":"windowsPayloadControlFailure","phase":"parser","code":"powershell_parse"}'
  const result = decodePublicControlStream(prefix + terminal)
  assert.equal(result.prefixValid, true)
  assert.equal(result.success, false)
  assert.equal(
    result.failureCode,
    'powershell_public_payload_control_failed_parser_powershell_parse',
  )
  for (const value of [
    prefix + terminal + '\n',
    terminal,
    prefix + terminal.replace('parser', 'manifest'),
    prefix + terminal.replace('powershell_parse', 'unknown'),
  ])
    assert.equal(decodePublicControlStream(value).prefixValid, false)
})
test('cold public failure phase is closed own-data-only and cannot admit errored success', () => {
  const prefix = PUBLIC_PHASES.slice(0, 3).join('\n') + '\n'
  assert.deepEqual(publicControlPhase({ stdout: prefix }), {
    object: 'windowsPublicControlPhase',
    phase: 'PARSER_BEGIN',
    prefixValid: true,
  })
  let getterRead = false
  const getter = Object.defineProperty({}, 'stdout', {
    get() {
      getterRead = true
      throw Error('private-secret-marker')
    },
  })
  for (const error of [
    getter,
    Object.create({ stdout: prefix }),
    { stdout: Buffer.from(prefix) },
    null,
  ])
    assert.deepEqual(publicControlPhase(error), {
      object: 'windowsPublicControlPhase',
      phase: 'NONE',
      prefixValid: false,
    })
  assert.equal(getterRead, false)
  assert.deepEqual(
    Object.keys(
      publicControlPhase({
        stdout: PUBLIC_PHASES.join('\n') + '\n' + PUBLIC_SUCCESS,
      }),
    ),
    ['object', 'phase', 'prefixValid'],
  )
})

test('cold public encoded command emits literal ordered flushed markers around the original controls', async () => {
  const source = await readFile(
    new URL('./preflight.node-check.mjs', import.meta.url),
    'utf8',
  )
  const start = source.lastIndexOf('    const command = `')
  const command = source.slice(
    start + '    const command = `'.length,
    source.indexOf('\n`', start),
  )
  const markers = [
    ...command.matchAll(
      /\[Console\]::Out\.Write\('([A-Z_]+)'\+\[char\]10\); \[Console\]::Out\.Flush\(\)/g,
    ),
  ].map((match) => match[1])
  assert.deepEqual(markers, PUBLIC_PHASES)
  assert.equal(
    Buffer.from(
      Buffer.from(command, 'utf16le').toString('base64'),
      'base64',
    ).toString('utf16le'),
    command,
  )
  for (const statement of [
    '$functions=@($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -ccontains $_.Name })',
    "if ($functions.Count -ne 2 -or [String]::Equals($functions[0].Name,$functions[1].Name,[StringComparison]::Ordinal)) { throw 'public_functions' }",
    '$definition=[ScriptBlock]::Create(($functions | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)',
    '. $definition',
    '$payload=Read-ExternalPayload',
    "if ($payload.files -isnot [array] -or $payload.files.Count -ne 85) { throw 'public_manifest_control' }",
  ])
    assert.equal(command.includes(statement), true)
  assert.equal(command.includes('Get-Content'), false)
  assert.equal(command.includes('Import-Module'), false)
  assert.equal(
    command.includes("[Console]::Out.Write('" + PUBLIC_SUCCESS + "')"),
    true,
  )
})
test('cold public host retains exact child bounds and accepts only normal full-prefix completion', async () => {
  const source = await readFile(
    new URL('./preflight.node-check.mjs', import.meta.url),
    'utf8',
  )
  const host = source.slice(source.lastIndexOf('    let output\n'))
  assert.match(host, /timeout: 45000,[\s\S]*maxBuffer: 4096/)
  assert.match(
    host,
    /'-NoLogo',[\s\S]*'-NoProfile',[\s\S]*'-NonInteractive',[\s\S]*'-EncodedCommand'/,
  )
  assert.match(host, /Buffer\.from\(command, 'utf16le'\)\.toString\('base64'\)/)
  assert.match(host, /failureMetadata = publicExecFailureMetadata\(error\)/)
  assert.match(
    host,
    /if \(failureCode\) \{[\s\S]*throw Error\(failureCode \+ ' ' \+ JSON\.stringify\(failureMetadata\)\)/,
  )
  assert.match(host, /if \(!decodePublicControlStream\(output\)\.success\)/)
  const erroredSuccess = {
    stdout: PUBLIC_PHASES.join('\n') + '\n' + PUBLIC_SUCCESS,
    code: 'ETIMEDOUT',
    status: null,
  }
  assert.equal(
    decodePublicControlError(erroredSuccess).failureCode,
    'powershell_public_payload_control_failed',
  )
  assert.equal(
    Object.hasOwn(publicControlPhase(erroredSuccess), 'success'),
    false,
  )
})

test('fixed approved public function pair has identical finite uniqueness semantics', () => {
  const approved = ['Decode-ExternalUtf8', 'Read-ExternalPayload']
  const select = (names) => names.filter((name) => approved.includes(name))
  const previous = (names) => {
    const functions = select(names)
    return functions.length === 2 && new Set(functions).size === 2
  }
  const candidate = (names) => {
    const functions = select(names)
    // Count short-circuit precedes both indexed name reads.
    return functions.length === 2 && functions[0] !== functions[1]
  }
  const controls = [
    [[], false],
    [[approved[0]], false],
    [[approved[1]], false],
    [[approved[0], approved[0]], false],
    [[approved[1], approved[1]], false],
    [[...approved], true],
    [[approved[1], approved[0]], true],
    [[approved[0], approved[1], approved[0]], false],
    [['decode-externalutf8', approved[1]], false],
    [[approved[0], 'read-externalpayload'], false],
    [['Decode-ExternalUtf8 ', approved[1]], false],
  ]
  for (const [names, admitted] of controls) {
    assert.equal(previous(names), admitted)
    assert.equal(candidate(names), admitted)
  }
  const domain = [
    ...approved,
    'decode-externalutf8',
    'read-externalpayload',
    'other',
  ]
  const sequences = [[]]
  for (let length = 1; length <= 3; length++) {
    for (const prefix of sequences.filter(
      (value) => value.length === length - 1,
    ))
      for (const name of domain) sequences.push([...prefix, name])
  }
  for (const names of sequences) assert.equal(candidate(names), previous(names))
})
test('fixed public pair source uses ordinal comparison only after the exact count guard', async () => {
  const source = await readFile(
    new URL('./preflight.node-check.mjs', import.meta.url),
    'utf8',
  )
  const start = source.lastIndexOf('    const command = `')
  const command = source.slice(start, source.indexOf('\n`', start))
  assert.equal(
    command.includes(
      "if ($functions.Count -ne 2 -or [String]::Equals($functions[0].Name,$functions[1].Name,[StringComparison]::Ordinal)) { throw 'public_functions' }",
    ),
    true,
  )
  assert.equal(command.includes('Select-Object -Unique'), false)
  assert.equal(
    command.includes("$names=@('Decode-ExternalUtf8','Read-ExternalPayload')"),
    true,
  )
  assert.equal(command.includes('$names -ccontains $_.Name'), true)
  assert.match(
    command,
    /FUNCTION_UNIQUE_BEGIN'[\s\S]*\$functions.Count -ne 2 -or \[String\]::Equals[\s\S]*FUNCTION_UNIQUE_RETURNED'/,
  )
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
$controlPhase='version'
try {
[Console]::Out.Write('ENTRY'+[char]10); [Console]::Out.Flush()
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'powershell_version' }
[Console]::Out.Write('VERSION_OK'+[char]10); [Console]::Out.Flush()
$root='${root}'
$tokens=$null; $parseErrors=$null
$controlPhase='parser'
[Console]::Out.Write('PARSER_BEGIN'+[char]10); [Console]::Out.Flush()
$ast=[System.Management.Automation.Language.Parser]::ParseFile(([IO.Path]::Combine($root,'preflight.ps1')),[ref]$tokens,[ref]$parseErrors)
[Console]::Out.Write('PARSER_RETURNED'+[char]10); [Console]::Out.Flush()
if ($null -ne $parseErrors -and $parseErrors.Length -ne 0) { throw 'powershell_parse' }
$controlPhase='functions'
$names=@('Decode-ExternalUtf8','Read-ExternalPayload')
[Console]::Out.Write('FUNCTION_SELECTION_BEGIN'+[char]10); [Console]::Out.Flush()
$functions=@($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -ccontains $_.Name })
[Console]::Out.Write('FUNCTION_SELECTION_RETURNED'+[char]10); [Console]::Out.Flush()
[Console]::Out.Write('FUNCTION_UNIQUE_BEGIN'+[char]10); [Console]::Out.Flush()
if ($functions.Count -ne 2 -or [String]::Equals($functions[0].Name,$functions[1].Name,[StringComparison]::Ordinal)) { throw 'public_functions' }
[Console]::Out.Write('FUNCTION_UNIQUE_RETURNED'+[char]10); [Console]::Out.Flush()
[Console]::Out.Write('FUNCTION_DEFINITION_BEGIN'+[char]10); [Console]::Out.Flush()
$definition=[ScriptBlock]::Create(($functions | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)
[Console]::Out.Write('FUNCTION_DEFINITION_RETURNED'+[char]10); [Console]::Out.Flush()
[Console]::Out.Write('FUNCTION_EVAL_BEGIN'+[char]10); [Console]::Out.Flush()
. $definition
[Console]::Out.Write('FUNCTION_EVAL_RETURNED'+[char]10); [Console]::Out.Flush()
$controlPhase='legacy_array'
[Console]::Out.Write('LEGACY_JSON_BEGIN'+[char]10); [Console]::Out.Flush()
$legacy=@('[1,2]' | ConvertFrom-Json)
[Console]::Out.Write('LEGACY_JSON_RETURNED'+[char]10); [Console]::Out.Flush()
if ($legacy.Count -ne 1 -or $legacy[0] -isnot [array] -or $legacy[0].Count -ne 2) { throw 'legacy_array_control' }
$controlPhase='direct_array'
[Console]::Out.Write('DIRECT_JSON_BEGIN'+[char]10); [Console]::Out.Flush()
$direct=ConvertFrom-Json -InputObject '[1,2]'
[Console]::Out.Write('DIRECT_JSON_RETURNED'+[char]10); [Console]::Out.Flush()
if ($direct -isnot [array] -or $direct.Count -ne 2) { throw 'direct_array_control' }
$controlPhase='single_array'
[Console]::Out.Write('SINGLE_JSON_BEGIN'+[char]10); [Console]::Out.Flush()
$single=ConvertFrom-Json -InputObject '[1]'
[Console]::Out.Write('SINGLE_JSON_RETURNED'+[char]10); [Console]::Out.Flush()
if ($single -isnot [array] -or $single.Count -ne 1) { throw 'single_array_control' }
$controlPhase='object_array'
[Console]::Out.Write('OBJECT_JSON_BEGIN'+[char]10); [Console]::Out.Flush()
$object=ConvertFrom-Json -InputObject '{"x":1}'
[Console]::Out.Write('OBJECT_JSON_RETURNED'+[char]10); [Console]::Out.Flush()
if ($object -is [array]) { throw 'object_array_control' }
$controlPhase='manifest'
[Console]::Out.Write('PAYLOAD_BEGIN'+[char]10); [Console]::Out.Flush()
$payload=Read-ExternalPayload
[Console]::Out.Write('PAYLOAD_RETURNED'+[char]10); [Console]::Out.Flush()
if ($payload.files -isnot [array] -or $payload.files.Count -ne 85) { throw 'public_manifest_control' }
$controlPhase='members'
[Console]::Out.Write('MEMBERS_BEGIN'+[char]10); [Console]::Out.Flush()
foreach ($file in $payload.files) { if ($file -is [array] -or $file.path -isnot [string] -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $file.bytes -le 0) { throw 'public_member_control' } }
[Console]::Out.Write('MEMBERS_RETURNED'+[char]10); [Console]::Out.Flush()
$controlPhase='executable'
[Console]::Out.Write('EXECUTABLE_BEGIN'+[char]10); [Console]::Out.Flush()
$executables=@($payload.files | Where-Object { $_.sha256 -eq '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a' })
[Console]::Out.Write('EXECUTABLE_RETURNED'+[char]10); [Console]::Out.Flush()
if ($executables.Count -ne 1) { throw 'public_executable_control' }
[Console]::Out.Write('{"object":"windowsPayloadControl","legacyWrapperCount":1,"directCount":2,"members":85,"parserErrors":0}')
} catch {
  $allowedCodes=@('powershell_version','powershell_parse','public_functions','legacy_array_control','direct_array_control','single_array_control','object_array_control','external_data_encoding','payload_encoding','payload_equivalence','asset_members','asset_url','public_manifest_control','public_member_control','public_executable_control')
  $message=$_.Exception.Message
  $controlCode=if ($allowedCodes -ccontains $message) { $message } else { 'unexpected_public_control_failure' }
  [Console]::Out.Write('{"object":"windowsPayloadControlFailure","phase":"'+$controlPhase+'","code":"'+$controlCode+'"}')
  exit 1
}
`
    let output
    let failureCode
    let failureMetadata
    let failurePhase
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
          // The isolated public Utility control on windows-2025 completed in
          // 20-30 seconds on two fresh runs. Allow cold module initialization;
          // retain a finite deadline and require the complete success frame.
          timeout: 45000,
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
    } catch (error) {
      // Never forward raw child errors, output, command text or environment values.
      failureCode = decodePublicControlError(error).failureCode
      failurePhase = publicControlPhase(error)
      failureMetadata = publicExecFailureMetadata(error)
    }
    if (failureCode) {
      process.stdout.write(JSON.stringify(failurePhase) + '\n')
      throw Error(failureCode + ' ' + JSON.stringify(failureMetadata))
    }
    if (!decodePublicControlStream(output).success) {
      process.stdout.write(
        JSON.stringify(publicControlPhase({ stdout: output })) + '\n',
      )
      throw Error('powershell_public_payload_projection_failed')
    }
    output = output.slice(PUBLIC_PHASES.join('\n').length + 1)
    if (
      output.trim() !==
      '{"object":"windowsPayloadControl","legacyWrapperCount":1,"directCount":2,"members":85,"parserErrors":0}'
    )
      throw Error('powershell_public_payload_projection_failed')
  },
)
