param([string]$AppRoot, [int]$Port = 47831, [switch]$NoBrowser, [switch]$NoTray, [switch]$ResultJson, [string]$Handoff, [string]$RecoveryNonce)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$taskLauncherMutex=$null;$taskLauncherOwned=$false;$taskLaunchSucceeded=$false;$taskHandoffAccepted=$false;$taskFailureCode=''
try {
  $taskRoot = if ($AppRoot) { [IO.Path]::GetFullPath($AppRoot) } else { Split-Path -Parent $PSScriptRoot }
  if (-not $AppRoot -and (Test-Path -LiteralPath (Join-Path $taskRoot 'Biblioteczka/package.json'))) { $taskRoot = Join-Path $taskRoot 'Biblioteczka' }
  if ($Port -lt 1 -or $Port -gt 65535) { throw 'Nieprawidłowy port.' }
  $taskOrigin = 'http://127.0.0.1:' + $Port
  $taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
  . (Join-Path $PSScriptRoot 'desktop-functions.ps1')
  . (Join-Path $PSScriptRoot 'runtime-functions.ps1')
  function Assert-TaskRecoveryActive {
    if($RecoveryNonce -and -not (Test-BiblioteczkaRecoveryLease (Join-Path $taskRoot 'data') $RecoveryNonce (Get-BiblioteczkaIdentity $taskRoot))){throw 'Recovery start was cancelled.'}
    if($taskHandoffAccepted){$null=Read-BiblioteczkaHandoff $taskRoot $Handoff $Port ([bool]$NoBrowser) ([bool]$NoTray) $RecoveryNonce}
  }
  Assert-TaskRecoveryActive
  $taskJob=Get-BiblioteczkaJobState
  if($Handoff){
    $null=Read-BiblioteczkaHandoff $taskRoot $Handoff $Port ([bool]$NoBrowser) ([bool]$NoTray) $RecoveryNonce
    $taskHandoffAccepted=$true
    if($taskJob.killOnClose){throw 'Windows did not establish an independent runtime.'}
  } elseif($taskJob.inJob){
    $taskIndependent=Invoke-BiblioteczkaIndependentStart $taskRoot $Port ([bool]$NoBrowser) ([bool]$NoTray) $RecoveryNonce
    if($taskIndependent.version -ne $taskVersion){throw 'Independent runtime has a different version.'}
    if($ResultJson){Write-Output ('BOOKSHELF_STARTED:'+($taskIndependent|ConvertTo-Json -Compress))}
    exit 0
  }
  $taskData = [IO.Path]::GetFullPath((Join-Path $taskRoot 'data'))
  $taskIdentityBytes = [Text.Encoding]::UTF8.GetBytes($taskRoot.ToLowerInvariant() + "`n" + $taskData.ToLowerInvariant())
  $taskSha = [Security.Cryptography.SHA256]::Create()
  try { $taskIdentity = ([BitConverter]::ToString($taskSha.ComputeHash($taskIdentityBytes))).Replace('-','').ToLowerInvariant() } finally { $taskSha.Dispose() }
  $taskLauncherMutex=New-Object Threading.Mutex($false,('Local\BiblioteczkaLauncher-'+$taskIdentity))
  try { $taskLauncherOwned=$taskLauncherMutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $taskLauncherOwned=$true }
  if (-not $taskLauncherOwned) { throw 'Poprzednie uruchomienie jeszcze trwa. Spróbuj ponownie.' }
  $taskNode = Join-Path $taskRoot 'runtime/node.exe'
  if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
  $taskManifest = Join-Path $taskRoot 'payload-manifest.json'
  if (Test-Path -LiteralPath $taskManifest) {
    & $taskNode (Join-Path $taskRoot 'scripts/payload-manifest.mjs') --verify $taskRoot
    if ($LASTEXITCODE -ne 0) { $taskFailureCode='PACKAGE_INTEGRITY';throw 'Uszkodzony pakiet. Napraw Biblioteczkę instalatorem.' }
  } elseif (Test-Path -LiteralPath (Join-Path $taskRoot 'runtime/node.exe')) { $taskFailureCode='PACKAGE_INTEGRITY';throw 'Brakuje manifestu pakietu. Napraw Biblioteczkę instalatorem.' }
  $taskHealth = $null
  try { $taskHealth = Invoke-RestMethod "$taskOrigin/api/health" -TimeoutSec 1 } catch {}
  if ($taskHealth -and ($taskHealth.appId -ne 'bookshelf-wallpaper' -or $taskHealth.installationId -ne $taskIdentity)) { throw 'Port zajmuje inny program lub inna instalacja Biblioteczki.' }
  if ($taskHealth -and $taskHealth.version -ne $taskVersion) { throw 'Na tym porcie działa inna wersja. Zaktualizuj Biblioteczkę.' }
  if (-not $taskHealth) {
    $taskNode = Join-Path $taskRoot 'runtime/node.exe'
    if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
    $taskNodeVersion = & $taskNode -v
    if ([int]($taskNodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Wymagany jest Node.js 24 lub nowszy.' }
    New-Item -ItemType Directory -Path $taskData -Force | Out-Null
    $taskEntry = Join-Path $taskRoot 'src/main.mjs'
    $taskInput = Join-Path $taskData 'server-stdin.txt'
    [IO.File]::WriteAllText($taskInput,'')
    Assert-TaskRecoveryActive
    $taskNodeArguments='"'+$taskEntry+'" --port '+$Port
    if($RecoveryNonce){$taskNodeArguments+=' --recovery-nonce '+$RecoveryNonce}
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList $taskNodeArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardInput $taskInput -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'server-error.log')
    for ($taskAttempt = 0; $taskAttempt -lt 40; $taskAttempt++) {
      Start-Sleep -Milliseconds 250
      Assert-TaskRecoveryActive
      try { $taskHealth = Invoke-RestMethod "$taskOrigin/api/health" -TimeoutSec 1 } catch {}
      if ($taskHealth) { break }
      if ($taskProcess.HasExited) { throw 'Program nie uruchomił się. Sprawdź data/server-error.log.' }
    }
    if (-not $taskHealth -or $taskHealth.appId -ne 'bookshelf-wallpaper' -or $taskHealth.installationId -ne $taskIdentity -or $taskHealth.version -ne $taskVersion) { throw 'Program nie odpowiedział z właściwego folderu. Sprawdź data/server-error.log.' }
  }
  Assert-TaskRecoveryActive
  if (-not $NoTray -and (Test-Path -LiteralPath (Join-Path $taskRoot 'scripts/tray.ps1'))) {
    function Test-TaskTray {
      try { $taskExistingTray=[Threading.Mutex]::OpenExisting('Local\BiblioteczkaTray-'+$taskIdentity);$taskExistingTray.Dispose();return $true } catch [Threading.WaitHandleCannotBeOpenedException] { return $false }
    }
    function Test-TaskCurrentTray {
      if (-not (Test-TaskTray)) { return $false }
      try {
        $taskTrayState=Get-Content -LiteralPath (Join-Path $taskData 'tray-state.json') -Raw -ErrorAction Stop|ConvertFrom-Json
        if ($taskTrayState.installationId -ne $taskIdentity -or $taskTrayState.serverPid -ne $taskHealth.pid -or -not $taskTrayState.pid) { return $false }
        $null=Get-Process -Id $taskTrayState.pid -ErrorAction Stop
        return $true
      } catch { return $false }
    }
    for ($taskOldTrayAttempt=0;$taskOldTrayAttempt -lt 120 -and (Test-TaskTray) -and -not (Test-TaskCurrentTray);$taskOldTrayAttempt++) { Start-Sleep -Milliseconds 100 }
    if ((Test-TaskTray) -and -not (Test-TaskCurrentTray)) { throw 'Poprzednia ikona zasobnika jeszcze pracuje. Spróbuj ponownie.' }
    if (-not (Test-TaskTray)) {
    $taskTrayScript=Join-Path $taskRoot 'scripts/tray.ps1'
    $taskTrayPowerShell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    for ($taskTrayStartAttempt=0;$taskTrayStartAttempt -lt 3 -and -not (Test-TaskCurrentTray);$taskTrayStartAttempt++) {
    Assert-TaskRecoveryActive
    $taskTrayProcess=Start-Process -FilePath $taskTrayPowerShell -ArgumentList ('-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$taskTrayScript+'" -AppRoot "'+$taskRoot+'" -Port '+$Port) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskData 'tray.log') -RedirectStandardError (Join-Path $taskData 'tray-error.log')
    for ($taskTrayAttempt=0;$taskTrayAttempt -lt 60;$taskTrayAttempt++) {
      if ($taskTrayProcess.HasExited) { break }
      if ((Test-TaskCurrentTray) -and ((Get-Content -LiteralPath (Join-Path $taskData 'tray.log') -Raw -ErrorAction SilentlyContinue) -match '"ready":true')) { break }
      Start-Sleep -Milliseconds 100
    }
    if (-not (Test-TaskCurrentTray) -and -not $taskTrayProcess.HasExited) { throw 'Ikona zasobnika jeszcze się uruchamia. Sprawdź data/tray-error.log.' }
    if (-not (Test-TaskCurrentTray)) { Start-Sleep -Milliseconds 200 }
    }
    if (-not (Test-TaskCurrentTray)) { throw 'Ikona zasobnika nie odpowiedziała po trzech próbach. Sprawdź data/tray-error.log.' }
    }
  }
  Assert-TaskRecoveryActive
  if (-not $NoBrowser) { Start-Process "$taskOrigin/manager" }
  $taskLaunchSucceeded=$true
  if($ResultJson){Write-Output ('BOOKSHELF_STARTED:'+($taskHealth|ConvertTo-Json -Compress))}
} catch { Write-Host ('Nie można uruchomić Biblioteczki: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
finally {
 if(($RecoveryNonce -or $taskHandoffAccepted) -and -not $taskLaunchSucceeded){foreach($taskOwnedChild in @($taskTrayProcess,$taskProcess)){try{if($taskOwnedChild -and -not $taskOwnedChild.HasExited){$taskOwnedChild.Kill();$null=$taskOwnedChild.WaitForExit(2000)}}catch{}}}
 if ($taskLauncherMutex) { if ($taskLauncherOwned) { $taskLauncherMutex.ReleaseMutex() };$taskLauncherMutex.Dispose() }
 if($taskHandoffAccepted){Complete-BiblioteczkaHandoff $taskRoot $Handoff $taskLaunchSucceeded $taskHealth $taskFailureCode}
}
