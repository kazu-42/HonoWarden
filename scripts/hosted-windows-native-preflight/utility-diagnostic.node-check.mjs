import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { createHash } from 'node:crypto'
import {
  UTILITY_PHASES,
  ELAPSED_BUCKETS,
  buildUtilityInvocation,
  decodeUtilityPrefix,
  runUtilityDiagnostic,
} from './utility-diagnostic.mjs'

const input = { systemRoot: "C:\\Windows space\\O'Brien\\日本語😀" }
const stream = (count = UTILITY_PHASES.length, bucket = 'LT1S') =>
  UTILITY_PHASES.slice(0, count)
    .map(
      (phase, index) =>
        [
          phase,
          bucket,
          index >= 2 ? 'T' : 'U',
          index >= 2 ? 'ONE' : 'UNKNOWN',
          index >= 4 ? 'T' : 'U',
          index >= 8 ? 'T' : 'U',
          index >= 10 ? 'T' : 'U',
        ].join('|') + '\n',
    )
    .join('')

test('Utility diagnostic retains one exact absolute child and existing narrow env with only diagnostic30s', () => {
  const invocation = buildUtilityInvocation(input)
  assert.equal(
    invocation.file,
    input.systemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  )
  assert.deepEqual(invocation.args.slice(0, 4), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
  ])
  assert.equal(invocation.options.timeout, 30000)
  assert.equal(invocation.options.maxBuffer, 4096)
  assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'pipe'])
  assert.deepEqual(invocation.options.env, {
    SystemRoot: input.systemRoot,
    windir: input.systemRoot,
    PATH: input.systemRoot + '\\System32',
    PSModulePath:
      input.systemRoot + '\\System32\\WindowsPowerShell\\v1.0\\Modules',
  })
  const command = Buffer.from(invocation.args[4], 'base64').toString('utf16le')
  assert.equal(
    Buffer.from(command, 'utf16le').toString('base64'),
    invocation.args[4],
  )
  assert.equal(
    command.includes(
      "$expected=[IO.Path]::Combine('C:\\Windows space\\O''Brien\\日本語😀','System32','WindowsPowerShell','v1.0','Modules')",
    ),
    true,
  )
})
test('Utility diagnostic closed source brackets active lookup before identity and fixed tinyJSON without runtimeenv reset', () => {
  const command = Buffer.from(
    buildUtilityInvocation(input).args[4],
    'base64',
  ).toString('utf16le')
  assert.match(command, /\[Diagnostics.Stopwatch\]::StartNew\(\)/)
  assert.match(
    command,
    /\$commands=@\(Get-Command -Name ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop\)/,
  )
  assert.match(command, /\[IO.File\]::Exists\(\$manifest\)/)
  assert.match(
    command,
    /ImplementingType.FullName -ceq 'Microsoft.PowerShell.Commands.ConvertFromJsonCommand'/,
  )
  assert.match(
    command,
    /Assembly.GetName\(\).Name -ceq 'Microsoft.PowerShell.Commands.Utility'/,
  )
  assert.match(command, /if \(-not \$identity\) \{ exit 1 \}/)
  assert.equal(
    command.indexOf('if (-not $identity) { exit 1 }') <
      command.indexOf("$legacy=@('[1,2]' | ConvertFrom-Json)"),
    true,
  )
  assert.doesNotMatch(
    command,
    /\$env:PSModulePath\s*=|PSModuleAutoLoadingPreference\s*=|Import-Module|FullyQualifiedModule|Get-Content|ScriptBlock|Read-ExternalPayload|Add-Type|Invoke-|Start-Process|Join-Path|Select-Object|Get-Module/,
  )
  assert.deepEqual(
    [...command.matchAll(/\[Console\]::Out.Write\('([A-Z_]+)\|'/g)].map(
      (match) => match[1],
    ),
    UTILITY_PHASES,
  )
})
test('Utility prefix accepts ordered incomplete phases and only full finite normal success', () => {
  for (let i = 0; i <= UTILITY_PHASES.length; i++) {
    const result = decodeUtilityPrefix(stream(i))
    assert.equal(result.valid, true)
    assert.equal(result.phase, i ? UTILITY_PHASES[i - 1] : 'NONE')
    assert.equal(result.completed, i === UTILITY_PHASES.length)
  }
  for (const bucket of ELAPSED_BUCKETS)
    assert.equal(decodeUtilityPrefix(stream(undefined, bucket)).completed, true)
})
test('Utility prefix rejects unknown skipped duplicated truncated extra and nonprimitive data', () => {
  for (const value of [
    stream().replace('ENTRY', 'UNKNOWN'),
    stream().replace('VERSION_OK', 'ENTRY'),
    stream().split('\n').slice(1).join('\n'),
    stream().slice(0, -1),
    stream() + 'private-secret-marker',
    stream().replace('|LT1S|', '|private-secret-marker|'),
    'x'.repeat(4097),
    Buffer.from(stream()),
    {},
    null,
  ]) {
    const result = decodeUtilityPrefix(value)
    assert.equal(result.valid, false)
    assert.equal(result.phase, 'NONE')
    assert.equal(result.completed, false)
    assert.equal(
      JSON.stringify(result).includes('private-secret-marker'),
      false,
    )
  }
})
test('Utility metadata transitions are immutable and elapsed buckets cannot regress', () => {
  const value = stream()
  for (const invalid of [
    value.replace('ENV_CHECKED|LT1S|T|ONE', 'ENV_CHECKED|LT1S|U|UNKNOWN'),
    value.replace('MANIFEST_BEGIN|LT1S|T', 'MANIFEST_BEGIN|LT1S|F'),
    value.replace('JSON_BEGIN|LT1S|T|ONE|T|T', 'JSON_BEGIN|LT1S|T|ONE|T|F'),
    value.replace(
      'JSON_RETURNED|LT1S|T|ONE|T|T|T',
      'JSON_RETURNED|LT1S|T|ONE|T|T|U',
    ),
    value.replace('ENTRY|LT1S', 'ENTRY|TEN_TO_TWENTY'),
  ])
    assert.equal(decodeUtilityPrefix(invalid).valid, false)
  assert.equal(
    decodeUtilityPrefix(
      value.replace(
        'JSON_RETURNED|LT1S|T|ONE|T|T|T',
        'JSON_RETURNED|LT1S|T|ONE|T|T|F',
      ),
    ).completed,
    false,
  )
})
test('Utility normal return and errored success retain distinct nonadmission outcomes with onechild', () => {
  let calls = 0
  const report = runUtilityDiagnostic(input, () => {
    calls++
    return { status: 0, stdout: stream(), stderr: '' }
  })
  assert.equal(calls, 1)
  assert.equal(report.classification, 'utility_completed')
  assert.equal(report.moduleIdentityMatches, true)
  assert.equal(report.jsonControlPassed, true)
  assert.equal(report.nativeAdmission, false)
  assert.equal(report.authenticated, false)
  assert.equal(report.windows11Acceptance, false)
  const failed = runUtilityDiagnostic(input, () => {
    throw {
      code: 'ETIMEDOUT',
      status: null,
      stdout: stream(),
      stderr: 'private-secret-marker',
      message: 'private-secret-marker',
      cmd: 'private-secret-marker',
    }
  })
  assert.equal(failed.classification, 'utility_exec_failed')
  assert.equal(failed.phase, 'JSON_RETURNED')
  assert.equal(failed.code, 'ETIMEDOUT')
  assert.equal(JSON.stringify(failed).includes('private-secret-marker'), false)
})
test('Utility rejects input getters unknown fields malformed paths without a child', () => {
  let getterRead = false,
    executed = false
  const getter = Object.defineProperty({}, 'systemRoot', {
    get() {
      getterRead = true
      throw Error('private-secret-marker')
    },
  })
  for (const value of [
    getter,
    Object.create(input),
    { ...input, secret: 'private-secret-marker' },
    { systemRoot: 'relative' },
    { systemRoot: '\\\\server\\share' },
    { systemRoot: 'C:\\x\n' },
    { systemRoot: 'C:\\' + 'x'.repeat(241) },
    null,
  ]) {
    const result = runUtilityDiagnostic(value, () => {
      executed = true
    })
    assert.equal(result.classification, 'utility_admission_rejected')
    assert.equal(
      JSON.stringify(result).includes('private-secret-marker'),
      false,
    )
  }
  assert.equal(getterRead, false)
  assert.equal(executed, false)
})
test('Utility error getters and Buffer cannot become parsed phase or leaked exceptions', () => {
  let getterRead = false
  const error = Object.defineProperty({}, 'stdout', {
    get() {
      getterRead = true
      throw Error('private-secret-marker')
    },
  })
  for (const thrown of [
    error,
    {
      stdout: Buffer.from(stream()),
      stderr: Buffer.from('private-secret-marker'),
      code: 'private-secret-marker',
    },
    { stdout: 'x'.repeat(4097), stderr: 'x'.repeat(4097) },
  ]) {
    const report = runUtilityDiagnostic(input, () => {
      throw thrown
    })
    assert.equal(report.prefixValid, false)
    assert.equal(report.phase, 'NONE')
    assert.equal(
      JSON.stringify(report).includes('private-secret-marker'),
      false,
    )
    assert.equal(Object.keys(report).length, 18)
  }
  assert.equal(getterRead, false)
})
test('Utility normal incomplete and malformed output never reports completion', () => {
  assert.equal(
    runUtilityDiagnostic(input, () => ({
      status: 0,
      stdout: stream(6),
      stderr: '',
    })).classification,
    'utility_incomplete',
  )
  assert.equal(
    runUtilityDiagnostic(input, () => ({
      status: 0,
      stdout: stream() + 'x',
      stderr: '',
    })).classification,
    'utility_protocol_rejected',
  )
})
test('Utility synchronous result measures normal stderr and handles timeout result without retry', () => {
  const normal = runUtilityDiagnostic(input, () => ({
    status: 0,
    stdout: stream(),
    stderr: 'private-secret-marker',
  }))
  assert.equal(normal.stderrBytes, Buffer.byteLength('private-secret-marker'))
  assert.equal(JSON.stringify(normal).includes('private-secret-marker'), false)
  let calls = 0
  const timeout = runUtilityDiagnostic(input, () => {
    calls++
    return {
      error: { code: 'ETIMEDOUT', message: 'private-secret-marker' },
      status: null,
      stdout: stream(6, 'TWENTY_TO_THIRTY'),
      stderr: '',
    }
  })
  assert.equal(calls, 1)
  assert.equal(timeout.classification, 'utility_exec_failed')
  assert.equal(timeout.code, 'ETIMEDOUT')
  assert.equal(timeout.statusBucket, 'null')
  assert.equal(timeout.phase, 'LOOKUP_BEGIN')
  assert.equal(timeout.elapsedBucket, 'TWENTY_TO_THIRTY')
})
test('Utility records environment expansion and absent manifest without treating it as admission', () => {
  const value = stream()
    .replaceAll('|T|ONE|', '|F|TWO_TO_FOUR|')
    .replaceAll('|TWO_TO_FOUR|T|', '|TWO_TO_FOUR|F|')
  const result = runUtilityDiagnostic(input, () => ({
    status: 0,
    stdout: value,
    stderr: '',
  }))
  assert.equal(result.classification, 'utility_completed')
  assert.equal(result.effectiveModulePathMatchesInput, false)
  assert.equal(result.modulePathCountBucket, 'TWO_TO_FOUR')
  assert.equal(result.manifestExists, false)
  assert.equal(result.nativeAdmission, false)
})
test('Utility unexpected module identity stops before JSON in the finite protocol', () => {
  const value = stream(9).replace(
    'IDENTITY_RETURNED|LT1S|T|ONE|T|T|U',
    'IDENTITY_RETURNED|LT1S|T|ONE|T|F|U',
  )
  const result = runUtilityDiagnostic(input, () => ({
    status: 1,
    stdout: value,
    stderr: '',
  }))
  assert.equal(result.classification, 'utility_exec_failed')
  assert.equal(result.moduleIdentityMatches, false)
  assert.equal(result.jsonControlPassed, null)
  assert.equal(
    decodeUtilityPrefix(value + stream().split('\n').slice(9).join('\n')).valid,
    false,
  )
})
test('Utility malformed synchronous results and revoked proxies fail with finite metadata', () => {
  const proxy = Proxy.revocable({}, {})
  proxy.revoke()
  for (const value of [
    null,
    'private-secret-marker',
    { status: 0, stdout: proxy.proxy },
    Object.defineProperty({}, 'stdout', {
      get() {
        throw Error('private-secret-marker')
      },
    }),
  ]) {
    const result = runUtilityDiagnostic(input, () => value)
    assert.notEqual(result.classification, 'utility_completed')
    assert.equal(
      JSON.stringify(result).includes('private-secret-marker'),
      false,
    )
  }
})
test('Utility workflow is additive failure-only and cannot clear original failure or bypass native Finish gates', async () => {
  let workflow
  try {
    workflow = await readFile(
      new URL('./hosted-windows-native.yml', import.meta.url),
      'utf8',
    )
  } catch {
    workflow = await readFile(
      new URL(
        '../../.github/workflows/hosted-windows-native.yml',
        import.meta.url,
      ),
      'utf8',
    )
  }
  assert.match(
    workflow,
    /name: Check cold Utility diagnostic policy tests\n\s+id: utility_policy_tests\n\s+if: always\(\) && steps.source_policy_tests.outcome == 'failure'\n\s+timeout-minutes: 1/,
  )
  assert.match(
    workflow,
    /name: Diagnose only cold public Utility loading\n\s+if: always\(\) && steps.source_policy_tests.outcome == 'failure' && steps.utility_policy_tests.outcome == 'success'\n\s+timeout-minutes: 1/,
  )
  assert.doesNotMatch(
    workflow,
    /continue-on-error|Probe finite hosted Server pre-auth capabilities\n\s+if:/,
  )
  assert.match(
    workflow,
    /name: Independently finish exact owned cleanup\n\s+if: always\(\)/,
  )
  const inverse = workflow.replace(
    / {6}- name: Check cold Utility diagnostic policy tests\n[\s\S]*?(?= {6}- name: Probe finite hosted Server pre-auth capabilities\n)/,
    '',
  )
  assert.equal(
    createHash('sha256').update(inverse).digest('hex'),
    '0927b01a2b01d915dadabacec385c9faef343984fb8a8b53a6779deafad2e90e',
  )
})
