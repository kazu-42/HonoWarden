import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

export const UTILITY_PHASES = Object.freeze([
  'ENTRY',
  'VERSION_OK',
  'ENV_CHECKED',
  'MANIFEST_BEGIN',
  'MANIFEST_RETURNED',
  'LOOKUP_BEGIN',
  'LOOKUP_RETURNED',
  'IDENTITY_BEGIN',
  'IDENTITY_RETURNED',
  'JSON_BEGIN',
  'JSON_RETURNED',
])
export const ELAPSED_BUCKETS = Object.freeze([
  'LT1S',
  'ONE_TO_FIVE',
  'FIVE_TO_TEN',
  'TEN_TO_TWENTY',
  'TWENTY_TO_THIRTY',
  'GE_THIRTY',
])
const CHILD_CODES = Object.freeze([
  'ETIMEDOUT',
  'ENOENT',
  'EACCES',
  'ENOBUFS',
  'E2BIG',
  'OTHER',
])
const CAP = 4096

export function buildUtilityInvocation(input) {
  let systemRoot
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Reflect.ownKeys(input).length !== 1 ||
      Reflect.ownKeys(input)[0] !== 'systemRoot'
    )
      throw Error('input')
    const descriptor = Object.getOwnPropertyDescriptor(input, 'systemRoot')
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('input')
    systemRoot = descriptor.value
    if (
      typeof systemRoot !== 'string' ||
      systemRoot.length > 243 ||
      !/^[A-Za-z]:\\/.test(systemRoot) ||
      !systemRoot.isWellFormed() ||
      [...systemRoot].some(
        (value) => value.codePointAt(0) <= 31 || value.codePointAt(0) === 127,
      )
    )
      throw Error('input')
  } catch {
    throw Error('utility_admission_rejected')
  }
  const phase = (name) => `
  $ms=$timer.ElapsedMilliseconds
  $bucket=if ($ms -lt 1000) { 'LT1S' } elseif ($ms -lt 5000) { 'ONE_TO_FIVE' } elseif ($ms -lt 10000) { 'FIVE_TO_TEN' } elseif ($ms -lt 20000) { 'TEN_TO_TWENTY' } elseif ($ms -lt 30000) { 'TWENTY_TO_THIRTY' } else { 'GE_THIRTY' }
  [Console]::Out.Write('${name}|'+$bucket+'|'+$match+'|'+$countBucket+'|'+$manifestFlag+'|'+$identityFlag+'|'+$jsonFlag+[char]10); [Console]::Out.Flush()
`
  // Exact-name lookup ACTIVELY imports modules and may run module scripts.
  // Identity is checked after import, before fixed JSON, not before import.
  // https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/get-command?view=powershell-5.1
  // https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-5.1
  const command = `
$ErrorActionPreference='Stop'
$timer=[Diagnostics.Stopwatch]::StartNew()
$match='U'; $countBucket='UNKNOWN'; $manifestFlag='U'; $identityFlag='U'; $jsonFlag='U'
try {${phase('ENTRY')}
  Set-StrictMode -Version Latest
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { exit 1 }${phase('VERSION_OK')}
  $expected=[IO.Path]::Combine('${systemRoot.replace(/'/g, "''")}','System32','WindowsPowerShell','v1.0','Modules')
  $effective=$env:PSModulePath
  $match=if ([String]::Equals($effective,$expected,[StringComparison]::OrdinalIgnoreCase)) { 'T' } else { 'F' }
  if ($null -eq $effective -or $effective.Length -eq 0) { $countBucket='ZERO' }
  elseif ($effective.Length -gt 8192) { $countBucket='OVERCAP' }
  else {
    $count=$effective.Split(';').Length
    $countBucket=if ($count -eq 1) { 'ONE' } elseif ($count -le 4) { 'TWO_TO_FOUR' } elseif ($count -le 16) { 'FIVE_TO_SIXTEEN' } else { 'OVERCAP' }
  }${phase('ENV_CHECKED')}${phase('MANIFEST_BEGIN')}
  $manifest=[IO.Path]::Combine($expected,'Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')
  $manifestFlag=if ([IO.File]::Exists($manifest)) { 'T' } else { 'F' }${phase('MANIFEST_RETURNED')}${phase('LOOKUP_BEGIN')}
  $commands=@(Get-Command -Name ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop)${phase('LOOKUP_RETURNED')}${phase('IDENTITY_BEGIN')}
  $identity=$commands.Count -eq 1 -and $commands[0].Name -ceq 'ConvertFrom-Json' -and $commands[0].ModuleName -ceq 'Microsoft.PowerShell.Utility' -and $commands[0].CommandType -eq [System.Management.Automation.CommandTypes]::Cmdlet -and $commands[0].ImplementingType.FullName -ceq 'Microsoft.PowerShell.Commands.ConvertFromJsonCommand' -and $commands[0].ImplementingType.Assembly.GetName().Name -ceq 'Microsoft.PowerShell.Commands.Utility'
  $identityFlag=if ($identity) { 'T' } else { 'F' }${phase('IDENTITY_RETURNED')}
  if (-not $identity) { exit 1 }${phase('JSON_BEGIN')}
  $legacy=@('[1,2]' | ConvertFrom-Json)
  $json=$legacy.Count -eq 1 -and $legacy[0] -is [array] -and $legacy[0].Count -eq 2 -and $legacy[0][0] -eq 1 -and $legacy[0][1] -eq 2
  $jsonFlag=if ($json) { 'T' } else { 'F' }${phase('JSON_RETURNED')}
  if (-not $json) { exit 1 }
} catch { exit 1 }
`
  return {
    file: win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ],
    options: {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: CAP,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        SystemRoot: systemRoot,
        windir: systemRoot,
        PATH: win32.join(systemRoot, 'System32'),
        PSModulePath: win32.join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'Modules',
        ),
      },
    },
  }
}
export function decodeUtilityPrefix(value) {
  const rejected = {
    valid: false,
    phase: 'NONE',
    completed: false,
    elapsedBucket: 'UNKNOWN',
    effectiveModulePathMatchesInput: null,
    modulePathCountBucket: 'UNKNOWN',
    manifestExists: null,
    moduleIdentityMatches: null,
    jsonControlPassed: null,
  }
  if (
    typeof value !== 'string' ||
    value.length > CAP ||
    Buffer.byteLength(value, 'utf8') > CAP
  )
    return rejected
  if (value === '') return { ...rejected, valid: true }
  if (!value.endsWith('\n')) return rejected
  const lines = value.slice(0, -1).split('\n')
  if (lines.length > UTILITY_PHASES.length) return rejected
  let previousRank = -1,
    previous = null,
    result = rejected
  const flag = (item) => (item === 'T' ? true : item === 'F' ? false : null)
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split('|')
    const [phase, bucket, match, count, manifest, identity, json] = fields
    const rank = ELAPSED_BUCKETS.indexOf(bucket)
    if (
      fields.length !== 7 ||
      phase !== UTILITY_PHASES[i] ||
      rank < 0 ||
      rank < previousRank ||
      [match, manifest, identity, json].some(
        (item) => !['U', 'T', 'F'].includes(item),
      )
    )
      return rejected
    if (
      i < 2
        ? match !== 'U' || count !== 'UNKNOWN'
        : match === 'U' ||
          ![
            'ZERO',
            'ONE',
            'TWO_TO_FOUR',
            'FIVE_TO_SIXTEEN',
            'OVERCAP',
          ].includes(count)
    )
      return rejected
    if (i < 4 ? manifest !== 'U' : manifest === 'U') return rejected
    if (i < 8 ? identity !== 'U' : identity === 'U') return rejected
    if (i < 10 ? json !== 'U' : json === 'U') return rejected
    if (i >= 9 && identity !== 'T') return rejected
    if (
      previous &&
      ((i > 2 && (match !== previous[2] || count !== previous[3])) ||
        (i > 4 && manifest !== previous[4]) ||
        (i > 8 && identity !== previous[5]))
    )
      return rejected
    previousRank = rank
    previous = fields
    result = {
      valid: true,
      phase,
      completed: i === 10 && json === 'T',
      elapsedBucket: bucket,
      effectiveModulePathMatchesInput: flag(match),
      modulePathCountBucket: count,
      manifestExists: flag(manifest),
      moduleIdentityMatches: flag(identity),
      jsonControlPassed: flag(json),
    }
  }
  return result
}
function ownData(object, keys) {
  if (!object || typeof object !== 'object') return null
  try {
    const result = {}
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)
      if (descriptor && !Object.hasOwn(descriptor, 'value')) return null
      result[key] = descriptor?.value
    }
    return result
  } catch {
    return null
  }
}
function byteCount(value) {
  if (value === undefined || value === null) return 0
  if (typeof value === 'string') {
    if (value.length > CAP) return null
    const count = Buffer.byteLength(value, 'utf8')
    return count <= CAP ? count : null
  }
  try {
    if (Buffer.isBuffer(value)) {
      const count = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(Uint8Array.prototype),
        'byteLength',
      ).get.call(value)
      return count <= CAP ? count : null
    }
  } catch {
    return null
  }
  return null
}
function isBuffer(value) {
  try {
    return Buffer.isBuffer(value)
  } catch {
    return false
  }
}
function project(classification, values) {
  const { code, status, stdout, stderr } = values ?? {}
  const prefix = decodeUtilityPrefix(stdout)
  return {
    object: 'windowsColdUtilityDiagnostic',
    classification,
    phase: prefix.phase,
    prefixValid: prefix.valid,
    elapsedBucket: prefix.elapsedBucket,
    effectiveModulePathMatchesInput: prefix.effectiveModulePathMatchesInput,
    modulePathCountBucket: prefix.modulePathCountBucket,
    manifestExists: prefix.manifestExists,
    moduleIdentityMatches: prefix.moduleIdentityMatches,
    jsonControlPassed: prefix.jsonControlPassed,
    code: CHILD_CODES.includes(code) ? code : 'OTHER',
    statusBucket:
      status === null
        ? 'null'
        : status === 0
          ? 'zero'
          : Number.isSafeInteger(status)
            ? 'nonzero'
            : 'other',
    stdoutType:
      typeof stdout === 'string'
        ? 'string'
        : isBuffer(stdout)
          ? 'buffer'
          : stdout === undefined || stdout === null
            ? 'absent'
            : 'other',
    stdoutBytes: byteCount(stdout),
    stderrBytes: byteCount(stderr),
    nativeAdmission: false,
    authenticated: false,
    windows11Acceptance: false,
  }
}
export function runUtilityDiagnostic(input, execute = spawnSync) {
  let invocation
  try {
    invocation = buildUtilityInvocation(input)
  } catch {
    return project('utility_admission_rejected', null)
  }
  let result
  try {
    // One synchronous child only; timeout does not reset and this script spawns
    // no subprocesses or owned state. spawnSync waits for close/termination.
    result = ownData(
      execute(invocation.file, invocation.args, invocation.options),
      ['error', 'status', 'stdout', 'stderr'],
    )
  } catch (error) {
    return project(
      'utility_exec_failed',
      ownData(error, ['code', 'status', 'stdout', 'stderr']),
    )
  }
  if (!result) return project('utility_protocol_rejected', null)
  const error = ownData(result.error, ['code'])
  const values = { ...result, code: error?.code }
  if (result.error || result.status !== 0)
    return project('utility_exec_failed', values)
  const prefix = decodeUtilityPrefix(result.stdout)
  return project(
    !prefix.valid
      ? 'utility_protocol_rejected'
      : prefix.completed
        ? 'utility_completed'
        : 'utility_incomplete',
    values,
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report =
    process.platform !== 'win32' || process.version !== 'v22.22.0'
      ? project('utility_admission_rejected', null)
      : runUtilityDiagnostic({ systemRoot: process.env.SystemRoot })
  process.stdout.on('error', () => {
    process.exitCode = 1
  })
  process.stdout.write(JSON.stringify(report) + '\n')
  process.exitCode = report.classification === 'utility_completed' ? 0 : 1
}
