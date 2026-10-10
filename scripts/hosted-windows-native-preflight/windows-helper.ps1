param([ValidateSet('ProcessProof','SyncMenu','LogoutMenu','EdgeIdentity','WindowProof')][string]$Mode)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$phase = 'request'
try {
  $inputBytes = [Console]::In.ReadToEnd()
  if ($inputBytes.Length -gt 16384) { throw 'input_bound' }
  $request = $inputBytes | ConvertFrom-Json
  if ($Mode -eq 'EdgeIdentity') {
    $allowed = @((Join-Path $env:ProgramFiles 'Microsoft/Edge/Application/msedge.exe'),
                 (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'))
    if ($request.path -notin $allowed -or -not (Test-Path -LiteralPath $request.path)) { throw 'edge_standard_path_required' }
    $cursor = [IO.Path]::GetFullPath($request.path)
    while ($cursor) {
      if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'edge_reparse' }
      $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $request.path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'edge_signing_trust_unproved' }
    @{object='edgeIdentity'; path=$request.path; sha256=(Get-FileHash -LiteralPath $request.path -Algorithm SHA256).Hash.ToLowerInvariant();
      version=(Get-Item -LiteralPath $request.path).VersionInfo.ProductVersion; signatureValid=$true} | ConvertTo-Json -Compress
    exit 0
  }
  if ($request.jobName -notmatch '^Local\\HonoWarden-[a-f0-9-]{36}$' -or $request.desktopPid -lt 1) { throw 'identity_invalid' }
  $phase = 'compile'
  Add-Type -Path (Join-Path $PSScriptRoot 'windows-native.cs')
  $phase = 'job'
  $owned = [HonoWardenWindowsNative]::JobPids($request.jobName)
  if ($owned -notcontains [uint32]$request.desktopPid) { throw 'not_in_job' }
  $phase = 'process'
  $process = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [uint32]$request.desktopPid)
  if ($null -eq $process -or $process.ExecutablePath -ne $request.desktopPath) { throw 'path_identity_invalid' }
  $hash = (Get-FileHash -LiteralPath $process.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $created = $process.CreationDate.ToUniversalTime().ToString('o')
  if ($hash -ne $request.desktopHash -or ($request.desktopCreatedAt -and $created -ne $request.desktopCreatedAt)) { throw 'process_identity_invalid' }
  if ($Mode -eq 'ProcessProof') {
    $phase = 'listener'
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort ([uint16]$request.port) -ErrorAction Stop)
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or [uint32]$listeners[0].OwningProcess -ne [uint32]$request.desktopPid) { throw 'listener_not_owned_loopback' }
    @{jobProcessIds=@($owned); desktopPid=[int]$process.ProcessId; desktopCreatedAt=$created; desktopHash=$hash;
      desktopPathMatches=$true; desktopAppdataMatches=($process.CommandLine.Contains('--user-data-dir=' + $request.appdata));
      listenerProcessId=[int]$listeners[0].OwningProcess; listenerOnlyLoopback=$true} | ConvertTo-Json -Compress -Depth 4
  } elseif ($Mode -eq 'WindowProof') {
    $phase = 'window'
    $running = Get-Process -Id ([int]$request.desktopPid) -ErrorAction Stop
    @{visible=[HonoWardenWindowsNative]::VisibleOwnedWindow($running.MainWindowHandle,[uint32]$request.desktopPid);
      sameSession=($running.SessionId -ne 0 -and $running.SessionId -eq (Get-Process -Id $PID).SessionId)} | ConvertTo-Json -Compress
  } else {
    $running = Get-Process -Id ([int]$request.desktopPid) -ErrorAction Stop
    $label = if ($Mode -eq 'SyncMenu') { 'Sync now' } else { 'Log out' }
    [HonoWardenWindowsNative]::InvokeOwnedMenu($running.MainWindowHandle, [uint32]$request.desktopPid, $label)
    @{object='nativeMenu'; invoked=$true} | ConvertTo-Json -Compress
  }
} catch {
  $code = if ($phase -in @('compile','job','process','listener','window')) { 'windows_helper_' + $phase } else { 'windows_helper_failed' }
  @{object='windowsHelperFailure'; code=$code} | ConvertTo-Json -Compress
  exit 1
}
