import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { dirname, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const PHASES = Object.freeze([
  'ENTRY',
  'VERSION_OK',
  'PATH_BEGIN',
  'PATH_READY',
  'PARSER_BEGIN',
  'PARSER_RETURNED',
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

function ownData(object, keys) {
  if (object === null || typeof object !== 'object') return null
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

function requireWindowsPath(value, maximum) {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    !/^[A-Za-z]:\\/.test(value) ||
    !value.isWellFormed() ||
    [...value].some((character) => {
      const code = character.codePointAt(0)
      return code <= 31 || code === 127
    })
  )
    throw Error('diagnostic_admission_rejected')
  return value
}

export function buildDiagnosticInvocation(input) {
  const values = ownData(input, ['systemRoot', 'root'])
  if (!values) throw Error('diagnostic_admission_rejected')
  const systemRoot = requireWindowsPath(values.systemRoot, 243)
  const root = requireWindowsPath(values.root, 2048).replace(/'/g, "''")
  // Parse only. No controller/function evaluation, native work or state writes.
  const command = `
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
  [Console]::Out.Write('ENTRY'+[char]10); [Console]::Out.Flush()
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { exit 1 }
  [Console]::Out.Write('VERSION_OK'+[char]10); [Console]::Out.Flush()
  $root='${root}'
  [Console]::Out.Write('PATH_BEGIN'+[char]10); [Console]::Out.Flush()
  $path=Join-Path $root 'preflight.ps1'
  if (-not [IO.File]::Exists($path)) { exit 1 }
  [Console]::Out.Write('PATH_READY'+[char]10); [Console]::Out.Flush()
  $tokens=$null; $parseErrors=$null
  [Console]::Out.Write('PARSER_BEGIN'+[char]10); [Console]::Out.Flush()
  $ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
  [Console]::Out.Write('PARSER_RETURNED'+[char]10); [Console]::Out.Flush()
  if ($null -ne $parseErrors -and $parseErrors.Length -ne 0) { exit 1 }
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
      timeout: 10000,
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

export function decodeDiagnosticPrefix(value) {
  const rejected = { valid: false, phase: 'NONE', completed: false }
  if (
    typeof value !== 'string' ||
    value.length > CAP ||
    Buffer.byteLength(value, 'utf8') > CAP
  )
    return rejected
  let prefix = ''
  for (let count = 0; count <= PHASES.length; count++) {
    if (value === prefix)
      return {
        valid: true,
        phase: count === 0 ? 'NONE' : PHASES[count - 1],
        completed: count === PHASES.length,
      }
    if (count < PHASES.length) prefix += `${PHASES[count]}\n`
  }
  return rejected
}

function boundedByteCount(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') {
    if (value.length > CAP) return null
    const count = Buffer.byteLength(value, 'utf8')
    return count <= CAP ? count : null
  }
  if (isBuffer(value)) {
    try {
      const byteLength = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(Uint8Array.prototype),
        'byteLength',
      ).get.call(value)
      return byteLength <= CAP ? byteLength : null
    } catch {
      return null
    }
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
  const prefix = decodeDiagnosticPrefix(stdout)
  return {
    object: 'windowsIndependentParserDiagnostic',
    classification,
    phase: prefix.phase,
    prefixValid: prefix.valid,
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
          : stdout === null || stdout === undefined
            ? 'absent'
            : 'other',
    stdoutBytes: boundedByteCount(stdout),
    stderrBytes: boundedByteCount(stderr),
    nativeAdmission: false,
    windows11Acceptance: false,
  }
}

export function runDiagnostic(input, execute = execFileSync) {
  let invocation
  try {
    invocation = buildDiagnosticInvocation(input)
  } catch {
    return project('diagnostic_admission_rejected', null)
  }
  let output
  try {
    // Exactly one synchronous child; Node waits for its exit/termination before
    // returning or throwing. The script creates no subprocesses or owned state.
    output = execute(invocation.file, invocation.args, invocation.options)
  } catch (error) {
    return project(
      'diagnostic_exec_failed',
      ownData(error, ['code', 'status', 'stdout', 'stderr']),
    )
  }
  const prefix = decodeDiagnosticPrefix(output)
  return project(
    !prefix.valid
      ? 'diagnostic_protocol_rejected'
      : prefix.completed
        ? 'diagnostic_completed'
        : 'diagnostic_incomplete',
    { status: 0, stdout: output },
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report =
    process.platform !== 'win32'
      ? project('diagnostic_admission_rejected', null)
      : runDiagnostic({
          systemRoot: process.env.SystemRoot,
          root: dirname(fileURLToPath(import.meta.url)),
        })
  process.stdout.on('error', () => {
    process.exitCode = 1
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
  process.exitCode = report.classification === 'diagnostic_completed' ? 0 : 1
}
