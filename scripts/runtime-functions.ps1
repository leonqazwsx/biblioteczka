function Write-BiblioteczkaAtomicJson([string]$Path,$Value) {
 $taskExisting=Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
 if($taskExisting -and ($taskExisting.PSIsContainer -or ($taskExisting.Attributes -band [IO.FileAttributes]::ReparsePoint))){throw 'Unsafe runtime control file.'}
 $taskParent=Split-Path -Parent $Path
 New-Item -ItemType Directory -Path $taskParent -Force -ErrorAction Stop|Out-Null
 $taskTemporary=Join-Path $taskParent ('.runtime-write-'+[guid]::NewGuid().ToString()+'.tmp')
 try{
  [IO.File]::WriteAllText($taskTemporary,($Value|ConvertTo-Json -Depth 8 -Compress),(New-Object Text.UTF8Encoding($false)))
  for($taskN=0;$taskN -lt 5;$taskN++){
   try{if([IO.File]::Exists($Path)){[IO.File]::Replace($taskTemporary,$Path,[NullString]::Value)}else{[IO.File]::Move($taskTemporary,$Path)};return}
   catch{if($taskN -eq 4){throw};Start-Sleep -Milliseconds 40}
  }
 }finally{if([IO.File]::Exists($taskTemporary)){[IO.File]::Delete($taskTemporary)}}
}
function Read-BiblioteczkaStopIntent([string]$Data,$Health,[string]$RecoveryNonce='') {
 $taskPath=Join-Path $Data 'runtime-stop.json'
 if(-not (Test-Path -LiteralPath $taskPath)){return 'none'}
 try{
  $taskFile=Get-Item -LiteralPath $taskPath -Force -ErrorAction Stop
  if($taskFile.PSIsContainer -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskFile.Length -gt 4096){return 'invalid'}
  $taskIntent=[IO.File]::ReadAllText($taskPath)|ConvertFrom-Json -ErrorAction Stop
  if($taskIntent.version -ne 1 -or $taskIntent.appId -ne 'bookshelf-wallpaper' -or -not $taskIntent.installationId -or -not $taskIntent.sessionId -or $taskIntent.pid -le 0 -or -not $taskIntent.createdAt){return 'invalid'}
  if($taskIntent.installationId -ceq $Health.installationId -and (($taskIntent.pid -eq $Health.pid -and $taskIntent.sessionId -ceq $Health.sessionId) -or ($RecoveryNonce -and $taskIntent.recoveryNonce -ceq $RecoveryNonce))){return 'stop'}
  return 'none'
 }catch{return 'invalid'}
}
function Get-BiblioteczkaProcessRecord([int]$ProcessId) {
 try{
  $taskNative=Get-Process -Id $ProcessId -ErrorAction Stop
  $taskTicks=$taskNative.StartTime.ToUniversalTime().Ticks
  $taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ProcessId) -ErrorAction Stop
  if(-not $taskProcess -or -not $taskProcess.ExecutablePath -or -not $taskProcess.CommandLine -or -not $taskProcess.CreationDate){return $null}
  $taskCimTicks=$taskProcess.CreationDate.ToUniversalTime().Ticks
  if(($taskTicks-($taskTicks%10)) -ne ($taskCimTicks-($taskCimTicks%10))){return $null}
  return [pscustomobject]@{pid=$ProcessId;started=$taskTicks.ToString();exe=$taskProcess.ExecutablePath;command=$taskProcess.CommandLine}
 }catch{return $null}
}
function Stop-BiblioteczkaOwnedProcess($Expected) {
 if(-not (Test-BiblioteczkaProcessFingerprint (Get-BiblioteczkaProcessRecord $Expected.pid) $Expected)){return $false}
 if(-not ('Biblioteczka.RuntimeProcess' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
namespace Biblioteczka {public static class RuntimeProcess {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exit,out long kernel,out long user);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder name,ref int size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint exit);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static bool Stop(int pid,long ticks,string exe){var h=OpenProcess(0x1001,false,pid);if(h==IntPtr.Zero)return false;try{long c,e,k,u;var n=new StringBuilder(32768);int size=n.Capacity;
  if(!GetProcessTimes(h,out c,out e,out k,out u)||DateTime.FromFileTimeUtc(c).Ticks!=ticks||!QueryFullProcessImageName(h,0,n,ref size)||!String.Equals(n.ToString(),exe,StringComparison.OrdinalIgnoreCase))return false;
  return TerminateProcess(h,1);
 }finally{CloseHandle(h);}}
}}
'@}
 return [Biblioteczka.RuntimeProcess]::Stop($Expected.pid,[long]$Expected.started,$Expected.exe)
}
function Get-BiblioteczkaRecoveryLeasePath([string]$Data,[string]$Nonce) {
 if($Nonce -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'){throw 'Invalid recovery lease.'}
 return Join-Path $Data ('.runtime-recovery-'+$Nonce+'.json')
}
function New-BiblioteczkaRecoveryLease([string]$Data,[string]$Identity) {
 $taskLease=[pscustomobject]@{version=1;nonce=[guid]::NewGuid().ToString();installationId=$Identity;ownerPid=$PID;ownerStarted=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString();state='active'}
 Write-BiblioteczkaAtomicJson (Get-BiblioteczkaRecoveryLeasePath $Data $taskLease.nonce) $taskLease
 return $taskLease
}
function Test-BiblioteczkaRecoveryLease([string]$Data,[string]$Nonce,[string]$Identity) {
 try{
  $taskFile=Get-Item -LiteralPath (Get-BiblioteczkaRecoveryLeasePath $Data $Nonce) -Force -ErrorAction Stop
  if($taskFile.PSIsContainer -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskFile.Length -gt 4096){return $false}
  $taskLease=[IO.File]::ReadAllText($taskFile.FullName)|ConvertFrom-Json -ErrorAction Stop
  if($taskLease.version -ne 1 -or $taskLease.nonce -cne $Nonce -or $taskLease.installationId -cne $Identity -or $taskLease.state -cne 'active'){return $false}
  return (Get-Process -Id $taskLease.ownerPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString() -ceq $taskLease.ownerStarted
 }catch{return $false}
}
function Cancel-BiblioteczkaRecoveryLease([string]$Data,[string]$Nonce) {
 $taskPath=Get-BiblioteczkaRecoveryLeasePath $Data $Nonce
 if(-not [IO.File]::Exists($taskPath)){return}
 $taskLease=[IO.File]::ReadAllText($taskPath)|ConvertFrom-Json
 if($taskLease.ownerPid -ne $PID -or $taskLease.ownerStarted -cne (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString()){throw 'Recovery lease has another owner.'}
 if($taskLease.state -ne 'cancelled'){$taskLease.state='cancelled';Write-BiblioteczkaAtomicJson $taskPath $taskLease}
}
function Test-BiblioteczkaProcessFingerprint($Actual,$Expected) {
 return [bool]($Actual -and $Expected -and $Actual.pid -eq $Expected.pid -and $Actual.started -ceq $Expected.started -and $Actual.exe -ieq $Expected.exe -and $Actual.command -ceq $Expected.command)
}
function Get-BiblioteczkaOwnedFingerprint([string]$Root,[int]$Port,$Health) {
 if(-not $Health -or $Health.appId -ne 'bookshelf-wallpaper' -or $Health.installationId -cne (Get-BiblioteczkaIdentity $Root) -or -not $Health.sessionId){return $null}
 $taskRecord=Get-BiblioteczkaProcessRecord $Health.pid
 if(-not $taskRecord -or $taskRecord.exe -ine (Join-Path $Root 'runtime/node.exe')){return $null}
 $taskEntry=[regex]::Escape((Join-Path $Root 'src/main.mjs'))
 $taskExe=[regex]::Escape($taskRecord.exe)
 $taskShape='^(?:"'+$taskExe+'"|'+$taskExe+')\s+"'+$taskEntry+'"\s+--port\s+'+$Port+'(?:\s+--recovery-nonce\s+(?<nonce>[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}))?\s*$'
 if($taskRecord.command -notmatch $taskShape){return $null}
 $taskRecord|Add-Member NoteProperty recoveryNonce ([string]$Matches['nonce'])
 return $taskRecord
}
function Read-BiblioteczkaRecoveryLedger([string]$Data,[string]$Identity) {
 $taskEmpty=[pscustomobject]@{version=1;installationId=$Identity;serverAttempts=@();wallpapers=@{}}
 $taskPath=Join-Path $Data 'runtime-recovery.json'
 if(-not (Test-Path -LiteralPath $taskPath)){return $taskEmpty}
 $taskFile=Get-Item -LiteralPath $taskPath -Force -ErrorAction Stop
 if($taskFile.PSIsContainer -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskFile.Length -gt 65536){throw 'Invalid recovery ledger.'}
 $taskLedger=[IO.File]::ReadAllText($taskPath)|ConvertFrom-Json -ErrorAction Stop
 if($taskLedger.version -ne 1 -or -not $taskLedger.installationId){throw 'Invalid recovery ledger.'}
 if($taskLedger.installationId -cne $Identity){return $taskEmpty}
 if($null -eq $taskLedger.serverAttempts -or $taskLedger.serverAttempts -isnot [array] -or $taskLedger.serverAttempts.Count -gt 3 -or $null -eq $taskLedger.wallpapers){throw 'Invalid recovery budget.'}
 foreach($taskStamp in $taskLedger.serverAttempts){if($taskStamp -is [string] -or [double]$taskStamp -lt 0 -or [double]$taskStamp -ne [Math]::Floor([double]$taskStamp)){throw 'Invalid recovery timestamp.'}}
 $taskDisplays=@{}
 foreach($taskProperty in $taskLedger.wallpapers.PSObject.Properties){
  if($taskProperty.Name -notmatch '^[a-f0-9]{64}$' -or $taskProperty.Value -isnot [array] -or $taskProperty.Value.Count -gt 3){throw 'Invalid wallpaper budget.'}
  foreach($taskStamp in $taskProperty.Value){if($taskStamp -is [string] -or [double]$taskStamp -lt 0 -or [double]$taskStamp -ne [Math]::Floor([double]$taskStamp)){throw 'Invalid wallpaper timestamp.'}}
  $taskDisplays[$taskProperty.Name]=@($taskProperty.Value)
 }
 return [pscustomobject]@{version=1;installationId=$Identity;serverAttempts=@($taskLedger.serverAttempts);wallpapers=$taskDisplays}
}
function Write-BiblioteczkaRecoveryLedger([string]$Data,$Ledger) {Write-BiblioteczkaAtomicJson (Join-Path $Data 'runtime-recovery.json') $Ledger}
function Write-BiblioteczkaRuntimeEvent([string]$Data,[string]$Event,[hashtable]$Details=@{}) {
 try{
  if($Event -notmatch '^[A-Z_]{1,64}$'){return $false}
  $taskEntry=[ordered]@{time=[DateTime]::UtcNow.ToString('o');event=$Event}
  foreach($taskKey in @('pid','attempt','monitor')){if($Details.ContainsKey($taskKey) -and $Details[$taskKey] -is [ValueType]){$taskEntry[$taskKey]=$Details[$taskKey]}}
  $taskPath=Join-Path $Data 'runtime-events.log'
  $taskFile=Get-Item -LiteralPath $taskPath -Force -ErrorAction SilentlyContinue
  if($taskFile -and ($taskFile.PSIsContainer -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint))){return $false}
  if($taskFile -and $taskFile.Length -ge 131072){
   $taskOld=Join-Path $Data 'runtime-events.previous.log'
   $taskExisting=Get-Item -LiteralPath $taskOld -Force -ErrorAction SilentlyContinue
   if($taskExisting -and ($taskExisting.PSIsContainer -or ($taskExisting.Attributes -band [IO.FileAttributes]::ReparsePoint))){return $false}
   [IO.File]::Copy($taskPath,$taskOld,$true);[IO.File]::WriteAllText($taskPath,'',(New-Object Text.UTF8Encoding($false)))
  }
  [IO.File]::AppendAllText($taskPath,($taskEntry|ConvertTo-Json -Compress)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)));return $true
 }catch{return $false}
}
function Get-BiblioteczkaJobState {
 if(-not ('Biblioteczka.RuntimeJob' -as [type])){
  Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
namespace Biblioteczka {public static class RuntimeJob {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool IsProcessInJob(IntPtr p,IntPtr j,out bool inside);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr j,int c,IntPtr p,uint l,IntPtr r);
}}
'@
 }
 $taskInside=$false
 if(-not [Biblioteczka.RuntimeJob]::IsProcessInJob([IntPtr](-1),[IntPtr]::Zero,[ref]$taskInside)){throw 'Cannot verify launcher job.'}
 if(-not $taskInside){return [pscustomobject]@{inJob=$false;killOnClose=$false}}
 $taskBuffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(144)
 try{
  if(-not [Biblioteczka.RuntimeJob]::QueryInformationJobObject([IntPtr]::Zero,9,$taskBuffer,144,[IntPtr]::Zero)){throw 'Cannot verify launcher lifetime.'}
  $taskFlags=[Runtime.InteropServices.Marshal]::ReadInt32($taskBuffer,16)
  return [pscustomobject]@{inJob=$true;killOnClose=[bool]($taskFlags -band 0x2000)}
 }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($taskBuffer)}
}
function Get-BiblioteczkaHandoffPath([string]$Root,[string]$Nonce) {
 if($Nonce -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'){throw 'Invalid launcher handoff.'}
 return Join-Path $Root ('data/.runtime-start-'+$Nonce+'.json')
}
function Read-BiblioteczkaHandoff([string]$Root,[string]$Nonce,[int]$Port,[bool]$NoBrowser,[bool]$NoTray,[string]$RecoveryNonce='') {
 $taskPath=Get-BiblioteczkaHandoffPath $Root $Nonce
 $taskFile=Get-Item -LiteralPath $taskPath -Force -ErrorAction Stop
 if($taskFile.PSIsContainer -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskFile.Length -gt 16384){throw 'Invalid launcher request.'}
 $taskRequest=[IO.File]::ReadAllText($taskPath)|ConvertFrom-Json -ErrorAction Stop
 if($taskRequest.version -ne 1 -or $taskRequest.phase -ne 'request' -or $taskRequest.nonce -cne $Nonce -or $taskRequest.installationId -cne (Get-BiblioteczkaIdentity $Root) -or $taskRequest.port -ne $Port -or $taskRequest.noBrowser -isnot [bool] -or $taskRequest.noTray -isnot [bool] -or $taskRequest.noBrowser -ne $NoBrowser -or $taskRequest.noTray -ne $NoTray){throw 'Launcher request does not match this installation.'}
 if([string]$taskRequest.recoveryNonce -cne $RecoveryNonce){throw 'Recovery request does not match.'}
 $taskParent=Get-Process -Id $taskRequest.parentPid -ErrorAction Stop
 if($taskParent.StartTime.ToUniversalTime().Ticks.ToString() -cne $taskRequest.parentStarted -or [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $taskRequest.expiresAt){throw 'Launcher request expired.'}
 return $taskRequest
}
function Complete-BiblioteczkaHandoff([string]$Root,[string]$Nonce,[bool]$Success,$Health,[string]$FailureCode='') {
 $taskProof=[pscustomobject]@{version=1;phase='complete';nonce=$Nonce;installationId=(Get-BiblioteczkaIdentity $Root);launcherPid=$PID;success=$Success;health=$Health;failureCode=$FailureCode}
 Write-BiblioteczkaAtomicJson (Get-BiblioteczkaHandoffPath $Root $Nonce) $taskProof
}
function Invoke-BiblioteczkaIndependentStart([string]$Root,[int]$Port,[bool]$NoBrowser,[bool]$NoTray,[string]$RecoveryNonce='') {
 $taskNonce=[guid]::NewGuid().ToString();$taskPath=Get-BiblioteczkaHandoffPath $Root $taskNonce
 $taskIdentity=Get-BiblioteczkaIdentity $Root
 $taskRequest=[pscustomobject]@{version=1;phase='request';nonce=$taskNonce;installationId=$taskIdentity;port=$Port;noBrowser=$NoBrowser;noTray=$NoTray;parentPid=$PID;parentStarted=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString();expiresAt=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+115000);recoveryNonce=$RecoveryNonce}
 Write-BiblioteczkaAtomicJson $taskPath $taskRequest
 $taskChild=$null;$taskComplete=$false
 try{
  $taskPowerShell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $taskCommand='"'+$taskPowerShell+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $Root 'scripts/start.ps1')+'" -AppRoot "'+$Root+'" -Port '+$Port+' -Handoff '+$taskNonce
  if($NoBrowser){$taskCommand+=' -NoBrowser'};if($NoTray){$taskCommand+=' -NoTray'}
  if($RecoveryNonce){$null=Get-BiblioteczkaRecoveryLeasePath (Join-Path $Root 'data') $RecoveryNonce;$taskCommand+=' -RecoveryNonce '+$RecoveryNonce}
  $taskStartup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0;CreateFlags=[uint32]16777216}
  $taskChild=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$taskCommand;CurrentDirectory=$Root;ProcessStartupInformation=$taskStartup} -ErrorAction Stop
  if($taskChild.ReturnValue -ne 0){throw 'Windows could not start an independent launcher.'}
  $taskWatch=[Diagnostics.Stopwatch]::StartNew()
  while($taskWatch.ElapsedMilliseconds -lt 120000){
   $taskResult=$null
   try{$taskResult=[IO.File]::ReadAllText($taskPath)|ConvertFrom-Json -ErrorAction Stop}catch{}
   if($taskResult -and $taskResult.phase -eq 'complete'){
    if($taskResult.nonce -cne $taskNonce -or $taskResult.installationId -cne $taskIdentity -or $taskResult.launcherPid -ne $taskChild.ProcessId){throw 'Independent launcher proof does not match.'}
    $taskComplete=$true
    if(-not $taskResult.success){
     if($taskResult.failureCode -ceq 'PACKAGE_INTEGRITY'){throw 'Uszkodzony pakiet. Napraw Biblioteczke instalatorem.'}
     throw 'Nie udalo sie uruchomic Biblioteczki. Sprawdz data/server-error.log i data/tray-error.log.'
    }
    $taskHealth=Invoke-RestMethod ('http://127.0.0.1:'+$Port+'/api/health') -TimeoutSec 2
    if($taskHealth.appId -ne 'bookshelf-wallpaper' -or $taskHealth.installationId -cne $taskIdentity -or $taskHealth.pid -ne $taskResult.health.pid -or $taskHealth.sessionId -cne $taskResult.health.sessionId){throw 'Independent runtime did not confirm readiness.'}
    return $taskHealth
   }
   if(-not (Get-Process -Id $taskChild.ProcessId -ErrorAction SilentlyContinue)){throw 'Independent launcher exited before confirming readiness.'}
   Start-Sleep -Milliseconds 100
  }
  throw 'BOOKSHELF_LAUNCH_UNCERTAIN: Independent launcher did not confirm readiness in time.'
 }finally{if($taskComplete -or -not $taskChild -or -not (Get-Process -Id $taskChild.ProcessId -ErrorAction SilentlyContinue)){if([IO.File]::Exists($taskPath)){[IO.File]::Delete($taskPath)}}}
}
