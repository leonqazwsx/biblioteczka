param([Parameter(Mandatory=$true)][string]$AppRoot,[int]$Port=47831,[switch]$Probe,[int]$ExitAfterMs=0)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$taskMutex=$null;$taskOwned=$false;$taskIcon=$null;$taskTimer=$null;$taskMenu=$null;$taskStatePath=$null
$taskWorker=$null;$taskLease=$null;$taskWorkerGraceUntil=0;$taskWallpaperWorker=$null;$taskStopping=$false;$taskLedgerBlocked=$false;$taskStopAuthorized=$false
try {
 . (Join-Path $PSScriptRoot 'desktop-functions.ps1')
 . (Join-Path $PSScriptRoot 'runtime-functions.ps1')
 . (Join-Path $PSScriptRoot 'runtime-policy.ps1')
 . (Join-Path $PSScriptRoot 'lively-functions.ps1')
 $taskRoot=[IO.Path]::GetFullPath($AppRoot);$taskData=Join-Path $taskRoot 'data';$taskIdentity=Get-BiblioteczkaIdentity $taskRoot;$taskOrigin='http://127.0.0.1:'+$Port
 $taskPowerShell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
 $taskVersion=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw|ConvertFrom-Json).version
 function Get-TaskHealth {try{return Invoke-RestMethod ($taskOrigin+'/api/health') -TimeoutSec 1}catch{return $null}}
 function Test-TaskHealth($Health) {return [bool]($Health -and $Health.appId -ceq 'bookshelf-wallpaper' -and $Health.installationId -ceq $taskIdentity -and $Health.version -ceq $taskVersion -and $Health.pid -is [ValueType] -and $Health.pid -gt 0 -and $Health.sessionId -is [string] -and $Health.sessionId.Length -gt 0)}
 $taskHealth=Get-TaskHealth
 if(-not (Test-TaskHealth $taskHealth)){throw 'Nie mozna potwierdzic serwera tej Biblioteczki.'}
 $taskFingerprint=Get-BiblioteczkaOwnedFingerprint $taskRoot $Port $taskHealth
 $taskMutex=New-Object Threading.Mutex($false,('Local\BiblioteczkaTray-'+$taskIdentity))
 try{$taskOwned=$taskMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$taskOwned=$true}
 if(-not $taskOwned){Write-Output '{"duplicate":true}';exit 0}
 Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing
 $taskMenu=New-Object Windows.Forms.ContextMenuStrip
 $taskOpen=$taskMenu.Items.Add('Otwórz biblioteczkę');$taskWallpaper=$taskMenu.Items.Add('Podgląd tapety');$taskAuto=$taskMenu.Items.Add('Autostart');$taskRetry=$taskMenu.Items.Add('Spróbuj ponownie');$taskQuit=$taskMenu.Items.Add('Zamknij Biblioteczkę')
 $taskAuto.Checked=(Get-BiblioteczkaAutostart $taskRoot $Port).autostart
 $taskOpen.Add_Click({Start-Process ($taskOrigin+'/manager')});$taskWallpaper.Add_Click({Start-Process ($taskOrigin+'/wallpaper')})
 $taskAuto.Add_Click({try{$taskStatus=Set-BiblioteczkaAutostart $taskRoot $Port (-not $taskAuto.Checked);$taskAuto.Checked=$taskStatus.autostart}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Biblioteczka')|Out-Null}})
 $taskMenu.Add_Opening({try{$taskStatus=Get-BiblioteczkaAutostart $taskRoot $Port;$taskAuto.Checked=$taskStatus.autostart;$taskAuto.Enabled=(-not $taskStatus.conflict -and ($taskStatus.autostart -or $taskStatus.canEnable))}catch{$taskAuto.Enabled=$false}})
 $taskIcon=New-Object Windows.Forms.NotifyIcon
 $taskIcon.Icon=[Drawing.SystemIcons]::Application;$taskIcon.Text='Biblioteczka';$taskIcon.ContextMenuStrip=$taskMenu
 $taskIcon.Add_DoubleClick({Start-Process ($taskOrigin+'/manager')})
 if($Probe){[pscustomobject]@{actions=@($taskMenu.Items|ForEach-Object Text);autostart=$taskAuto.Checked;identity=$taskIdentity}|ConvertTo-Json -Compress;exit 0}
 function Get-TaskNow {return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
 try{$taskLedger=Read-BiblioteczkaRecoveryLedger $taskData $taskIdentity}catch{$taskLedgerBlocked=$true;$taskLedger=[pscustomobject]@{version=1;installationId=$taskIdentity;serverAttempts=@();wallpapers=@{}}}
 $taskRecovery=New-BiblioteczkaRecoveryState (Get-TaskNow) $taskLedger.serverAttempts
 $taskLivelyData=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Lively Wallpaper'
 $taskLivelyCursor=New-BiblioteczkaLivelyCursor;$taskWallpaperQueue=@{}
 $taskStartupUntil=(Get-TaskNow)+90000
 function Add-TaskWallpapers {try{foreach($taskTarget in @(Get-BiblioteczkaLivelyTargets $taskLivelyData $taskOrigin)){$taskWallpaperQueue[$taskTarget.key]=$true}}catch{}}
 function Save-TaskTrayState {
  $taskValue=[pscustomobject]@{pid=$PID;serverPid=$taskHealth.pid;sessionId=$taskHealth.sessionId;installationId=$taskIdentity;phase=$taskRecovery.phase}
  $taskJson=$taskValue|ConvertTo-Json -Compress
  if($script:taskLastState -cne $taskJson){Write-BiblioteczkaAtomicJson $taskStatePath $taskValue;$script:taskLastState=$taskJson}
 }
 function Cancel-TaskRecovery {if($taskLease){Cancel-BiblioteczkaRecoveryLease $taskData $taskLease.nonce}}
 function Stop-TaskRuntime {$script:taskStopping=$true;$taskRecovery.phase='stopping';Cancel-TaskRecovery}
 function Get-TaskIntent {Read-BiblioteczkaStopIntent $taskData $taskHealth $taskLease.nonce}
 function Finish-TaskWorker {
  if($taskWorker -and $taskWorker.HasExited){
   if(-not $taskStopping -and (Get-TaskIntent) -eq 'stop'){$script:taskStopAuthorized=$true;Stop-TaskRuntime}
   if(-not $taskStopping -and $taskRecovery.phase -eq 'starting' -and $taskWorker.ExitCode -eq 0){
    # A good launch can precede a transient failed probe. Retain its nonce for adoption.
    if(-not $taskWorkerGraceUntil){$script:taskWorkerGraceUntil=(Get-TaskNow)+10000}
    if((Get-TaskNow) -lt $taskWorkerGraceUntil){return}
   }
   $taskWorker.Dispose();$script:taskWorker=$null
   if($taskLease){$taskPath=Get-BiblioteczkaRecoveryLeasePath $taskData $taskLease.nonce;if([IO.File]::Exists($taskPath)){[IO.File]::Delete($taskPath)};$script:taskLease=$null}
   if(-not $taskStopping -and $taskRecovery.phase -eq 'starting'){Complete-BiblioteczkaRecoveryAttempt $taskRecovery $false (Get-TaskNow);Write-BiblioteczkaRuntimeEvent $taskData 'SERVER_START_FAILED'|Out-Null}
  }
 }
 $taskRetry.Enabled=$false
 $taskRetry.Add_Click({
  if($taskStopping -or $taskWorker){return}
  try{Reset-BiblioteczkaRecoveryState $taskRecovery (Get-TaskNow);$taskLedger.serverAttempts=@();Write-BiblioteczkaRecoveryLedger $taskData $taskLedger;$script:taskLedgerBlocked=$false;Write-BiblioteczkaRuntimeEvent $taskData 'MANUAL_RETRY'|Out-Null}catch{$script:taskLedgerBlocked=$true}
 })
 $taskQuit.Add_Click({
  try{
   Stop-TaskRuntime;$taskCurrent=Get-TaskHealth
   if(Test-TaskHealth $taskCurrent){$null=Confirm-BiblioteczkaQuit $taskOrigin $taskIdentity $taskCurrent.pid}
   elseif($taskFingerprint -and (Test-BiblioteczkaProcessFingerprint (Get-BiblioteczkaProcessRecord $taskHealth.pid) $taskFingerprint)){$null=Stop-BiblioteczkaOwnedProcess $taskFingerprint}
  }catch{$taskIcon.Text='Biblioteczka: ponów zamknięcie'}
 })
 function Invoke-TaskStopping {
  Cancel-TaskRecovery
  if($taskWallpaperWorker -and $taskWallpaperWorker.HasExited){$taskWallpaperWorker.Dispose();$script:taskWallpaperWorker=$null}
  if($taskStopAuthorized -and -not $taskWorker){if(-not $taskWallpaperWorker){[Windows.Forms.Application]::ExitThread()};return}
  $taskCurrent=Get-TaskHealth
  if(Test-TaskHealth $taskCurrent){
   $taskIsCurrent=$taskCurrent.pid -eq $taskHealth.pid -and $taskCurrent.sessionId -ceq $taskHealth.sessionId
   $taskCandidate=if($taskLease -and -not $taskIsCurrent){Get-BiblioteczkaOwnedFingerprint $taskRoot $Port $taskCurrent}
   if($taskIsCurrent -or ($taskCandidate -and $taskCandidate.recoveryNonce -ceq $taskLease.nonce)){
    try{$null=Confirm-BiblioteczkaQuit $taskOrigin $taskIdentity $taskCurrent.pid;$script:taskStopAuthorized=$true}catch{return}
   }
  }
  Finish-TaskWorker
  $taskAlive=$null -ne (Get-Process -Id $taskHealth.pid -ErrorAction SilentlyContinue)
  if(-not $taskWorker -and -not $taskWallpaperWorker -and ($taskStopAuthorized -or -not $taskAlive -or ($taskCurrent -and $taskCurrent.pid -ne $taskHealth.pid))){[Windows.Forms.Application]::ExitThread()}
 }
 function Invoke-TaskWallpaper {
  if($taskWallpaperWorker){if($taskWallpaperWorker.HasExited){$taskWallpaperWorker.Dispose();$script:taskWallpaperWorker=$null}else{return}}
  if($taskStopping -or $taskLedgerBlocked -or $taskRecovery.phase -ne 'healthy' -or $taskHealth.recovery -eq 'unrecoverable'){return}
  $taskHost=Get-BiblioteczkaLivelyHost
  if(-not $taskHost -or -not (Test-BiblioteczkaLivelyReload $taskLivelyData $taskHost)){return}
  $taskTargets=@(Get-BiblioteczkaLivelyTargets $taskLivelyData $taskOrigin)
  if($taskTargets.Count -and (Get-TaskNow) -lt $taskStartupUntil){Add-TaskWallpapers;$script:taskStartupUntil=0}
  foreach($taskFailure in @(Read-BiblioteczkaLivelyFailures $taskLivelyCursor (Join-Path $taskLivelyData 'logs') $taskOrigin $taskTargets)){
   if(Test-BiblioteczkaWallpaperBudget $taskLedger $taskFailure.key (Get-TaskNow)){$taskWallpaperQueue[$taskFailure.key]=$true}
  }
  foreach($taskKey in @($taskWallpaperQueue.Keys)){
   if(-not @($taskTargets|Where-Object{$_.key -ceq $taskKey}).Count){$taskWallpaperQueue.Remove($taskKey);continue}
   if(-not (Test-BiblioteczkaWallpaperBudget $taskLedger $taskKey (Get-TaskNow))){continue}
   $null=Test-BiblioteczkaWallpaperBudget $taskLedger $taskKey (Get-TaskNow) $true
   Write-BiblioteczkaRecoveryLedger $taskData $taskLedger;$taskWallpaperQueue.Remove($taskKey)
   $script:taskWallpaperWorker=Start-Process -FilePath $taskPowerShell -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $taskRoot 'scripts/lively-repair.ps1')+'" -AppRoot "'+$taskRoot+'" -Port '+$Port+' -DisplayKey '+$taskKey) -WindowStyle Hidden -PassThru
   break
  }
 }
 function Invoke-TaskProbe {
  $taskIntent=Get-TaskIntent
  if($taskIntent -eq 'stop'){$script:taskStopAuthorized=$true;Stop-TaskRuntime}
  if($taskStopping){Invoke-TaskStopping;return}
  $taskNow=Get-TaskNow;$taskCurrent=Get-TaskHealth
  if(Test-TaskHealth $taskCurrent){
   if($taskCurrent.pid -ne $taskHealth.pid -or $taskCurrent.sessionId -cne $taskHealth.sessionId){
    if(-not $taskWorker){[Windows.Forms.Application]::ExitThread();return}
    $taskNewFingerprint=Get-BiblioteczkaOwnedFingerprint $taskRoot $Port $taskCurrent
    if(-not $taskNewFingerprint -or $taskNewFingerprint.recoveryNonce -cne $taskLease.nonce){
     Cancel-TaskRecovery;Finish-TaskWorker
     if(-not $taskWorker){[Windows.Forms.Application]::ExitThread()};return
    }
    if((Get-TaskIntent) -eq 'stop'){$script:taskStopAuthorized=$true;Stop-TaskRuntime;return}
    $script:taskHealth=$taskCurrent;$script:taskFingerprint=$taskNewFingerprint
    Complete-BiblioteczkaRecoveryAttempt $taskRecovery $true $taskNow;Write-BiblioteczkaRuntimeEvent $taskData 'SERVER_RECOVERED' @{pid=$taskHealth.pid}|Out-Null;Add-TaskWallpapers
   }
   $null=Get-BiblioteczkaRecoveryDecision $taskRecovery 'ok' $taskNow
   Finish-TaskWorker;Invoke-TaskWallpaper
  }else{
   $taskAlive=$null -ne (Get-Process -Id $taskHealth.pid -ErrorAction SilentlyContinue)
   $taskObservation=if($taskCurrent){'foreign'}elseif($taskLedgerBlocked -or $taskIntent -eq 'invalid'){'blocked'}elseif($taskAlive){'hung'}else{'dead'}
   $taskOwnedProcess=$taskFingerprint -and (Test-BiblioteczkaProcessFingerprint (Get-BiblioteczkaProcessRecord $taskHealth.pid) $taskFingerprint)
   $taskDecision=Get-BiblioteczkaRecoveryDecision $taskRecovery $taskObservation $taskNow ([bool]$taskOwnedProcess)
   if($taskDecision.kind -eq 'recover' -and -not $taskWorker){
    if((Get-TaskIntent) -ne 'none'){return};if(Get-TaskHealth){return}
    Start-BiblioteczkaRecoveryAttempt $taskRecovery $taskNow
    $taskLedger.serverAttempts=@($taskRecovery.attempts);Write-BiblioteczkaRecoveryLedger $taskData $taskLedger
    if($taskDecision.terminate){
     if(-not (Stop-BiblioteczkaOwnedProcess $taskFingerprint)){$taskRecovery.phase='blocked';return}
     $taskOld=Get-Process -Id $taskHealth.pid -ErrorAction SilentlyContinue
     if($taskOld -and -not $taskOld.WaitForExit(2000)){$taskRecovery.phase='blocked';return}
    }
    $script:taskLease=New-BiblioteczkaRecoveryLease $taskData $taskIdentity
    $script:taskWorkerGraceUntil=0
    try{
     $script:taskWorker=Start-Process -FilePath $taskPowerShell -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $taskRoot 'scripts/start.ps1')+'" -AppRoot "'+$taskRoot+'" -Port '+$Port+' -NoBrowser -NoTray -RecoveryNonce '+$taskLease.nonce) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskData 'recovery-launch.log') -RedirectStandardError (Join-Path $taskData 'recovery-launch-error.log')
    }catch{
     Cancel-TaskRecovery;[IO.File]::Delete((Get-BiblioteczkaRecoveryLeasePath $taskData $taskLease.nonce));$script:taskLease=$null
     Complete-BiblioteczkaRecoveryAttempt $taskRecovery $false (Get-TaskNow);Write-BiblioteczkaRuntimeEvent $taskData 'SERVER_START_FAILED'|Out-Null;return
    }
    Write-BiblioteczkaRuntimeEvent $taskData 'SERVER_RECOVERY_STARTED' @{attempt=$taskRecovery.attempts.Count}|Out-Null
   }
   Finish-TaskWorker
  }
 }
 $taskIcon.Visible=$true;$taskStarted=[DateTime]::UtcNow;$taskStatePath=Join-Path $taskData 'tray-state.json';$taskLastState=''
 Save-TaskTrayState
 $taskTimer=New-Object Windows.Forms.Timer;$taskTimer.Interval=2000
 $taskTimer.Add_Tick({
  $taskTimer.Stop()
  try{Invoke-TaskProbe;Save-TaskTrayState}catch{$taskRecovery.phase='blocked';Write-BiblioteczkaRuntimeEvent $taskData 'GUARDIAN_CHECK_FAILED'|Out-Null}
  $taskRetry.Enabled=(-not $taskStopping -and -not $taskWorker -and $taskRecovery.phase -in @('limited','blocked','waiting'))
  $taskIcon.Text=switch($taskRecovery.phase){'healthy'{'Biblioteczka'};'limited'{'Biblioteczka: wybierz Spróbuj ponownie'};'blocked'{'Biblioteczka: wymaga sprawdzenia'};'stopping'{'Biblioteczka: zamykanie'};default{'Biblioteczka: przywracanie połączenia'}}
  if($ExitAfterMs -gt 0 -and ([DateTime]::UtcNow-$taskStarted).TotalMilliseconds -ge $ExitAfterMs){[Windows.Forms.Application]::ExitThread()}
  $taskTimer.Start()
 })
 $taskTimer.Start();Write-Output '{"ready":true}';[Windows.Forms.Application]::Run()
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
finally{
 if($taskTimer){$taskTimer.Stop();$taskTimer.Dispose()};if($taskIcon){$taskIcon.Visible=$false;$taskIcon.Dispose()};if($taskMenu){$taskMenu.Dispose()}
 if($taskLease){try{Cancel-TaskRecovery}catch{}}
 if($taskStatePath){try{$taskSaved=Get-Content -LiteralPath $taskStatePath -Raw -ErrorAction Stop|ConvertFrom-Json;if($taskSaved.pid -eq $PID -and $taskSaved.installationId -ceq $taskIdentity){Remove-Item -LiteralPath $taskStatePath -Force}}catch{}}
 if($taskMutex){if($taskOwned){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()}
}
