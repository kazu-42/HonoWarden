import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

test(
  'Windows native output handle is valid and disposed with an independent legacy comparison',
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
  $legacyResult='opened'
  try { $legacy=[IO.FileStream]::new('NUL',[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite); $legacy.Dispose() }
  catch {
    $exception=$_.Exception.GetBaseException()
    if ($exception -is [ArgumentException]) { $legacyResult='argument_rejected' }
    elseif ($exception -is [NotSupportedException]) { $legacyResult='not_supported' }
    else { $legacyResult='other_rejected' }
  }
  $phase='compile'
  Add-Type -Path '${root}/windows-native.cs'
  if ([HonoWardenWindowsNative]::VisibleOwnedWindow([IntPtr]::Zero,[uint32]$PID)) { throw 'null_window_accepted' }
  if ([HonoWardenWindowsNative]::VisibleOwnedWindow([IntPtr]::new(1),[uint32]$PID)) { throw 'invalid_window_accepted' }
  $phase='open'
  $handle=[HonoWardenWindowsNative]::OpenNullOutput()
  try {
    if ($handle.IsInvalid -or $handle.IsClosed) { throw 'handle_invalid' }
    $phase='inherit'
    if (-not [HonoWardenWindowsNative]::SetHandleInformation($handle.DangerousGetHandle(),1,1)) { throw 'handle_inherit' }
  } finally { $handle.Dispose() }
  $phase='closed'
  if (-not $handle.IsClosed) { throw 'handle_not_closed' }
  [Console]::Out.Write('native_null_output_control_passed:' + $legacyResult)
} catch {
  $kind=$_.Exception.GetBaseException().GetType().Name
  if (@('ArgumentException','NotSupportedException','IOException','UnauthorizedAccessException','Win32Exception','TypeLoadException','InvalidOperationException','RuntimeException') -cnotcontains $kind) { $kind='other' }
  [Console]::Out.Write('native_null_output_control_failed:'+ $phase + ':' + $kind); exit 1
}
`
    let output
    let failure
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
      failure = safe ? value : 'native_null_output_control_failed'
    }
    // Child errors carry encoded commands and environment details; report only
    // the fixed diagnostic projection, never the raw error or its cause.
    if (failure) throw Error(failure)
    assert.match(
      output,
      /^native_null_output_control_passed:(opened|argument_rejected|not_supported|other_rejected)$/,
    )
    process.stdout.write(
      JSON.stringify({
        object: 'windowsNullOutputControl',
        nativeHandle: 'valid_and_disposed',
        legacy: output.split(':')[1],
      }) + '\n',
    )
  },
)
