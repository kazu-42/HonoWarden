import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

test(
  'Windows Framework rejects a path-based NUL stream and the native output handle is valid and disposed',
  { skip: process.platform !== 'win32' },
  () => {
    const systemRoot = process.env.SystemRoot
    assert.match(systemRoot ?? '', /^[A-Za-z]:\\[^\r\n\0]*$/)
    const root = dirname(fileURLToPath(import.meta.url)).replace(/'/g, "''")
    const command = `
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$phase='legacy'
try {
  $rejected=$false
  try { $legacy=[IO.FileStream]::new('NUL',[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite); $legacy.Dispose() }
  catch { $rejected=$_.Exception.GetBaseException() -is [ArgumentException] }
  if (-not $rejected) { throw 'legacy_control' }
  $phase='compile'
  Add-Type -Path '${root}/windows-native.cs'
  $phase='open'
  $handle=[HonoWardenWindowsNative]::OpenNullOutput()
  try {
    if ($handle.IsInvalid -or $handle.IsClosed) { throw 'handle_invalid' }
    $phase='inherit'
    if (-not [HonoWardenWindowsNative]::SetHandleInformation($handle.DangerousGetHandle(),1,1)) { throw 'handle_inherit' }
  } finally { $handle.Dispose() }
  $phase='closed'
  if (-not $handle.IsClosed) { throw 'handle_not_closed' }
  [Console]::Out.Write('native_null_output_control_passed')
} catch {
  $kind=$_.Exception.GetBaseException().GetType().Name
  if (@('ArgumentException','NotSupportedException','IOException','UnauthorizedAccessException','Win32Exception','TypeLoadException','InvalidOperationException','RuntimeException') -cnotcontains $kind) { $kind='other' }
  [Console]::Out.Write('native_null_output_control_failed:'+ $phase + ':' + $kind); exit 1
}
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
      const value = Object.getOwnPropertyDescriptor(
        error ?? {},
        'stdout',
      )?.value
      const safe =
        typeof value === 'string' &&
        /^native_null_output_control_failed:(legacy|compile|open|inherit|closed):(ArgumentException|NotSupportedException|IOException|UnauthorizedAccessException|Win32Exception|TypeLoadException|InvalidOperationException|RuntimeException|other)$/.test(
          value,
        )
      throw Error(safe ? value : 'native_null_output_control_failed')
    }
    assert.equal(output, 'native_null_output_control_passed')
  },
)
