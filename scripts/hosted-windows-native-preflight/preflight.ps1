param([switch]$Execute,[switch]$Finish,[string]$Company)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$PSScriptRoot
$statePath=Join-Path $env:RUNNER_TEMP 'honowarden-windows-preauth-state.json'
$failed=$false; $job=[IntPtr]::Zero; $processInfo=$null; $pipe=$null; $nullStream=$null; $state=$null
$journalAuthenticated=$false
$previousTemp=$env:TEMP; $previousTmp=$env:TMP
$report=@{object='windowsHostedPreauth';status='blocked';phase='admission';failureCode=$null;worker=$false;gui=$false;dpapi=$false;credentialMarker=$false;cleanup=$false;authenticated=$false;windows11Acceptance=$false}
function Assert-PlainPath([string]$Path) {
  $cursor=[IO.Path]::GetFullPath($Path)
  if ($cursor.StartsWith('\\')) { throw 'network_path' }
  while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'reparse_path' }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
}
function Private-Directory([string]$Path) {
  Assert-PlainPath $Path
  New-Item -ItemType Directory -Path $Path | Out-Null
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Verify-Source {
  $manifest=Get-Content -LiteralPath (Join-Path $root 'source-manifest.json') -Raw | ConvertFrom-Json
  foreach ($file in $manifest.files) {
    if ($file.path -notmatch '^[A-Za-z0-9_.-]+$') { throw 'source_path' }
    $path=Join-Path $root $file.path; Assert-PlainPath $path
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'source_hash' }
  }
}
function Verify-Executable([string]$Path,[string]$Digest) {
  Assert-PlainPath $Path
  if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Digest) { throw 'executable_digest' }
  $signature=Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw 'authenticode_unproved' }
  $stream=[IO.File]::OpenRead($Path); $reader=[IO.BinaryReader]::new($stream)
  try { if ($reader.ReadUInt16() -ne 0x5a4d) { throw 'pe_magic' }; $stream.Position=0x3c; $offset=$reader.ReadUInt32(); $stream.Position=$offset; if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'pe_machine' } }
  finally { $reader.Dispose(); $stream.Dispose() }
}
function Decode-ExternalUtf8([string]$Value,[int]$Maximum=16384) {
  if (-not $Value -or $Value.Length -gt (4*[Math]::Ceiling($Maximum/3.0)) -or $Value -cnotmatch '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$') { throw 'external_data_encoding' }
  $bytes=[Convert]::FromBase64String($Value)
  if ($bytes.Length -gt $Maximum -or [Convert]::ToBase64String($bytes) -cne $Value) { throw 'external_data_encoding' }
  return [Text.UTF8Encoding]::new($false,$true).GetString($bytes)
}
function Read-ExternalPayload {
  $encoded=Get-Content -LiteralPath (Join-Path $root 'desktop-payload-manifest.json') -Raw | ConvertFrom-Json
  if ($encoded.schemaVersion -ne 1 -or $encoded.encoding -cne 'canonical-base64-utf8') { throw 'payload_encoding' }
  $text=Decode-ExternalUtf8 $encoded.payloadBase64
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
  if ($digest -ne '7baaf42799ec914f5e0f08cffca3641d97b3c4b98bd02da06ec678c7cedbd2a8') { throw 'payload_equivalence' }
  $files=@($text | ConvertFrom-Json)
  if ($files.Count -ne 85) { throw 'asset_members' }
  $url=Decode-ExternalUtf8 $encoded.assetUrlBase64 2048
  $uri=[Uri]$url
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.Host -ne 'github.com' -or $uri.UserInfo -or -not $uri.IsDefaultPort -or $uri.Query -or $uri.Fragment) { throw 'asset_url' }
  return @{files=$files;assetUrl=$url}
}
function Cleanup-Owned {
  $clean=($journalAuthenticated -or -not (Test-Path -LiteralPath $statePath))
  if ($state -and $journalAuthenticated) {
    try {
      if ($job -ne [IntPtr]::Zero) { if (-not [HonoWardenWindowsNative]::TerminateJobObject($job,74)) { throw 'job_stop' } }
      elseif ($state.jobCreated -eq $true -and @([HonoWardenWindowsNative]::JobPids($state.jobName)).Count -ne 0) { throw 'unexpected_live_job' }
      if ($job -ne [IntPtr]::Zero -and @([HonoWardenWindowsNative]::JobPids($state.jobName)).Count -ne 0) { throw 'job_processes_remain' }
    } catch { if ($_.Exception.GetBaseException() -isnot [ComponentModel.Win32Exception] -or $_.Exception.GetBaseException().NativeErrorCode -ne 2) { $clean=$false } }
    try { if ($state.markerClaimed -eq $true) { if (-not [HonoWardenPreauthNative]::RemoveMarker($state.marker)) { throw 'marker_remains' } } } catch { $clean=$false }
    try { Assert-PlainPath $state.attempt; if (Test-Path -LiteralPath $state.attempt) { Remove-Item -LiteralPath $state.attempt -Recurse -Force }; if (Test-Path -LiteralPath $state.attempt) { throw 'directory_remains' } } catch { $clean=$false }
  }
  try { if ($pipe) { $pipe.Dispose() } } catch { $clean=$false }
  try { if ($nullStream) { $nullStream.Dispose() } } catch { $clean=$false }
  try { if ($processInfo) { [HonoWardenWindowsNative]::CloseHandle($processInfo.Thread) | Out-Null; [HonoWardenWindowsNative]::CloseHandle($processInfo.Process) | Out-Null } } catch { $clean=$false }
  try { if ($job -ne [IntPtr]::Zero) { [HonoWardenWindowsNative]::CloseHandle($job) | Out-Null } } catch { $clean=$false }
  try { if ($clean -and $journalAuthenticated -and (Test-Path -LiteralPath $statePath)) { Remove-Item -LiteralPath $statePath -Force; if (Test-Path -LiteralPath $statePath) { throw 'journal_remains' } } } catch { $clean=$false }
  return $clean
}
try {
  if (-not $Execute -and -not $Finish) { throw 'explicit_mode_required' }
  if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_REPOSITORY -ne 'kazu-42/HonoWarden') { throw 'hosted_runner_required' }
  $report.phase='source_integrity'
  Verify-Source
  if ($Finish) {
    $report.phase='finish_state'
    if (-not (Test-Path -LiteralPath $statePath)) { $report.status='nothing_started'; $report.cleanup=$true; exit 0 }
    if ((Get-Item -LiteralPath $statePath).Length -gt 4096) { throw 'state_bound' }
    $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.nonce -notmatch '^[a-f0-9-]{36}$' -or $state.attempt -ne (Join-Path $env:RUNNER_TEMP ('HonoWardenPreauth-'+$state.nonce)) -or $state.jobName -ne ('Local\HonoWarden-'+$state.nonce) -or $state.marker -ne ('HonoWarden-HostedPreauth-'+$state.nonce) -or $state.markerClaimed -isnot [bool] -or $state.jobCreated -isnot [bool]) { $state=$null; throw 'state_identity' }
    $journalAuthenticated=$true
    Add-Type -Path (Join-Path $root 'windows-native.cs')
    Add-Type -Path (Join-Path $root 'preauth-native.cs') -ReferencedAssemblies 'System.Security.dll','System.dll'
  } else {
    $report.phase='guest_identity'
    $os=Get-CimInstance Win32_OperatingSystem
    if ($os.Caption -notmatch 'Windows Server 2025' -or $os.OSArchitecture -notmatch '64' -or $os.ProductType -eq 1) { throw 'server_identity' }
    if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'interactive_session_unavailable' }
    $drive=New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($env:RUNNER_TEMP))
    if ($drive.AvailableFreeSpace -lt 2GB) { throw 'reserve_before_prepare' }
    Assert-PlainPath $Company
    if ((git -C $Company rev-parse HEAD) -ne '2deeee0cf159da92babc86e09de44c12eea2aa93' -or $LASTEXITCODE -ne 0) { throw 'company_commit' }
    foreach ($file in (Get-Content -LiteralPath (Join-Path $root 'company-source-manifest.json') -Raw | ConvertFrom-Json).files) {
      $path=Join-Path $Company $file.path; Assert-PlainPath $path
      if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'company_source_changed' }
    }
    $node=(Get-Command node.exe).Source
    Verify-Executable $node 'bae898add4643fcf890a83ad8ae56e20dce7e781cab161a53991ceba70c99ffb'
    if ((& $node --version) -ne 'v22.22.0') { throw 'node_version' }
    $report.phase='journal_create'
    $created=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); $nonce=[Guid]::NewGuid().ToString()
    if (Test-Path -LiteralPath $statePath) { throw 'preexisting_journal_retained' }
    $state=@{nonce=$nonce;attempt=(Join-Path $env:RUNNER_TEMP ('HonoWardenPreauth-'+$nonce));jobName=('Local\HonoWarden-'+$nonce);marker=('HonoWarden-HostedPreauth-'+$nonce);markerClaimed=$false;jobCreated=$false}
    if (Test-Path -LiteralPath $state.attempt) { $state=$null; throw 'no_retry_or_existing_state' }
    $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $statePath -Encoding UTF8
    $journalAuthenticated=$true
    Private-Directory $state.attempt
    foreach ($name in @('tmp','user','appdata','localappdata','desktop')) { Private-Directory (Join-Path $state.attempt $name) }
    $env:TEMP=Join-Path $state.attempt 'tmp'; $env:TMP=$env:TEMP
    $archive=Join-Path $state.attempt 'desktop.7z'
    $report.phase='asset_identity'
    $external=Read-ExternalPayload
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri $external.assetUrl -OutFile $archive
    if ((Get-Item -LiteralPath $archive).Length -ne 128340508 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '75b2793dad87f8748c9f6190523819c315c412c432489807b5154513aa3a5811') { throw 'asset_identity' }
    & 'C:/Program Files/7-Zip/7z.exe' x -y ('-o'+(Join-Path $state.attempt 'desktop')) $archive *> $null
    if ($LASTEXITCODE -ne 0) { throw 'asset_extract' }
    $payload=@($external.files)
    foreach ($file in $payload) { if ($file.path -match '(^|/)\.\.?(/|$)|[:\\]') { throw 'asset_path' }; $path=Join-Path (Join-Path $state.attempt 'desktop') $file.path; Assert-PlainPath $path; if ((Get-Item -LiteralPath $path).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'asset_member' } }
    if (@(Get-ChildItem -LiteralPath (Join-Path $state.attempt 'desktop') -File -Recurse).Count -ne $payload.Count) { throw 'asset_extra_members' }
    $executables=@($payload | Where-Object { $_.sha256 -eq '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a' })
    if ($executables.Count -ne 1) { throw 'asset_executable' }
    $desktop=Join-Path (Join-Path $state.attempt 'desktop') $executables[0].path
    Verify-Executable $desktop '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a'
    if ((Get-Item -LiteralPath $desktop).VersionInfo.ProductVersion -notmatch '^2026\.9\.1') { throw 'desktop_version' }
    if ($drive.AvailableFreeSpace -lt 1GB) { throw 'reserve_after_prepare' }
    $report.phase='native_capability'
    Add-Type -Path (Join-Path $root 'windows-native.cs')
    Add-Type -Path (Join-Path $root 'preauth-native.cs') -ReferencedAssemblies 'System.Security.dll','System.dll'
    $job=[HonoWardenWindowsNative]::CreateOwnedJob($state.jobName)
    $state.jobCreated=$true
    $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $statePath -Encoding UTF8
    $report.dpapi=[HonoWardenPreauthNative]::DpapiProbe()
    if ([HonoWardenPreauthNative]::MarkerExists($state.marker)) { throw 'preexisting_marker_refused' }
    $state.markerClaimed=$true
    $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $statePath -Encoding UTF8
    $report.credentialMarker=[HonoWardenPreauthNative]::MarkerProbe($state.marker)
    if (-not $report.dpapi -or -not $report.credentialMarker) { throw 'marker_probe' }
    $pipe=[IO.Pipes.AnonymousPipeServerStream]::new([IO.Pipes.PipeDirection]::Out,[IO.HandleInheritability]::Inheritable)
    $nullStream=[IO.FileStream]::new('NUL',[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
    $nullHandle=$nullStream.SafeFileHandle.DangerousGetHandle()
    if (-not [HonoWardenWindowsNative]::SetHandleInformation($nullHandle,1,1)) { throw 'stdio' }
    $childEnv=@{SystemRoot=$env:SystemRoot;windir=$env:windir;SystemDrive=$env:SystemDrive;COMSPEC=(Join-Path $env:SystemRoot 'System32/cmd.exe');PATH=((Split-Path -Parent $node)+';'+(Join-Path $env:SystemRoot 'System32'));TEMP=$env:TEMP;TMP=$env:TMP;USERPROFILE=(Join-Path $state.attempt 'user');APPDATA=(Join-Path $state.attempt 'appdata');LOCALAPPDATA=(Join-Path $state.attempt 'localappdata');ProgramFiles=$env:ProgramFiles;'ProgramFiles(x86)'=${env:ProgramFiles(x86)}}
    $environmentBlock=(($childEnv.Keys | Sort-Object | ForEach-Object {$_+'='+$childEnv[$_]}) -join [char]0)+[char]0+[char]0
    $processInfo=[HonoWardenWindowsNative]::StartOwnedNode($job,$node,(Join-Path $root 'preflight.mjs'),$root,$environmentBlock,[IntPtr]::new([long]$pipe.GetClientHandleAsString()),$nullHandle)
    $pipe.DisposeLocalCopyOfClientHandle()
    $input=@{companyCommit='2deeee0cf159da92babc86e09de44c12eea2aa93';company=$Company;createdAtMs=$created;expiresAtMs=($created+240000);freeBytes=$drive.AvailableFreeSpace;freshHostedGuest=$true;attempt=$state.attempt;jobName=$state.jobName}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($input | ConvertTo-Json -Compress));try{$pipe.Write($bytes,0,$bytes.Length);$pipe.Flush()}finally{[Array]::Clear($bytes,0,$bytes.Length);$pipe.Dispose();$pipe=$null}
    $report.phase='owned_node'
    $waitCode=258
    while (($waitCode=[HonoWardenWindowsNative]::WaitForSingleObject($processInfo.Process,200)) -eq 258) { if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $created+240000) { throw 'absolute_deadline' } }
    if ($waitCode -ne 0) { throw 'native_wait_failed' }
    [uint32]$exitCode=0
    if (-not [HonoWardenWindowsNative]::GetExitCodeProcess($processInfo.Process,[ref]$exitCode) -or $exitCode -ne 0) { throw 'native_exit_failed' }
    $resultPath=Join-Path $state.attempt 'safe-result.json'
    if ((Get-Item -LiteralPath $resultPath).Length -gt 4096) { throw 'result_bound' }
    $result=Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    $report.worker=($result.worker -eq $true);$report.gui=($result.gui -eq $true)
    if (-not $report.worker -or -not $report.gui -or $result.cleanup -ne $true) { throw 'preauth_capability_unavailable' }
    $report.status='preauth_capabilities_observed'
  }
} catch {
  $failed=$true; $report.status='blocked_or_incomplete_preauth'
  $allowedFailureCodes=@('explicit_mode_required','hosted_runner_required','source_path','source_hash','state_bound','state_identity','server_identity','interactive_session_unavailable','reserve_before_prepare','company_commit','company_source_changed','executable_digest','authenticode_unproved','pe_magic','pe_machine','node_version','preexisting_journal_retained','no_retry_or_existing_state','external_data_encoding','payload_encoding','payload_equivalence','asset_members','asset_url','asset_identity','asset_extract','asset_path','asset_member','asset_extra_members','asset_executable','desktop_version','reserve_after_prepare','preexisting_marker_refused','marker_probe','stdio','absolute_deadline','native_wait_failed','native_exit_failed','result_bound','preauth_capability_unavailable')
  $code=$_.Exception.Message
  $report.failureCode=if ($allowedFailureCodes -ccontains $code) { $code } else { 'unexpected_preauth_failure' }
}
finally {
  $report.cleanup=Cleanup-Owned
  if (-not $report.cleanup) { $failed=$true; $report.status='owned_cleanup_unproved' }
  $env:TEMP=$previousTemp;$env:TMP=$previousTmp
  $report | ConvertTo-Json -Compress
}
if ($failed) { exit 1 }
