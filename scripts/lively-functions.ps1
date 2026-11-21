function Get-BiblioteczkaDisplayKey([string]$DeviceId) {
 $taskSha=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($taskSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($DeviceId)))).Replace('-','').ToLowerInvariant()}finally{$taskSha.Dispose()}
}
function Get-BiblioteczkaLivelyLayout([string]$DataRoot,[string]$Origin) {
 $taskPath=Join-Path $DataRoot 'WallpaperLayout.json';$taskFile=Get-Item -LiteralPath $taskPath -Force -ErrorAction Stop
 if($taskFile.PSIsContainer -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskFile.Length -gt 1048576){throw 'Invalid Lively layout.'}
 $taskText=[IO.File]::ReadAllText($taskPath);if(-not $taskText.Trim()){throw 'Incomplete Lively layout.'}
 $taskLayout=$taskText|ConvertFrom-Json -ErrorAction Stop;$taskLibrary=[IO.Path]::GetFullPath((Join-Path $DataRoot 'Library'))+[IO.Path]::DirectorySeparatorChar
 foreach($taskEntry in $taskLayout){
  $taskScreen=$taskEntry.LivelyScreen
  if(-not $taskScreen.DeviceId -or $taskScreen.Index -lt 1 -or $taskScreen.Index -gt 128 -or $taskScreen.isStale -eq $true){continue}
  $taskMatches=$false;$taskProject=[string]$taskEntry.LivelyInfoPath
  try{
   $taskProject=[IO.Path]::GetFullPath($taskProject).TrimEnd([IO.Path]::DirectorySeparatorChar)
   if($taskProject.StartsWith($taskLibrary,[StringComparison]::OrdinalIgnoreCase)){
    $taskInfoFile=Get-Item -LiteralPath (Join-Path $taskProject 'LivelyInfo.json') -Force -ErrorAction Stop
    if(-not $taskInfoFile.PSIsContainer -and -not ($taskInfoFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $taskInfoFile.Length -le 65536){
     $taskInfo=[IO.File]::ReadAllText($taskInfoFile.FullName)|ConvertFrom-Json -ErrorAction Stop
     $taskMatches=$taskInfo.Type -eq 3 -and $taskInfo.FileName -ceq ($Origin+'/wallpaper')
    }
   }
  }catch{$taskMatches=$false}
  [pscustomobject]@{key=(Get-BiblioteczkaDisplayKey $taskScreen.DeviceId);deviceId=[string]$taskScreen.DeviceId;deviceName=[string]$taskScreen.DeviceName;monitor=[int]$taskScreen.Index;project=$taskProject;matches=$taskMatches}
 }
}
function Get-BiblioteczkaLivelyTargets([string]$DataRoot,[string]$Origin) {Get-BiblioteczkaLivelyLayout $DataRoot $Origin|Where-Object{$_.matches}}
function Test-BiblioteczkaWallpaperBudget($Ledger,[string]$Key,[long]$NowMs,[bool]$Reserve=$false) {
 if($Key -notmatch '^[a-f0-9]{64}$'){return $false}
 $taskAttempts=@($Ledger.wallpapers[$Key]|Where-Object{$null -ne $_ -and ($NowMs-[long]$_) -lt 600000})
 if($taskAttempts.Count -ge 3 -or ($taskAttempts.Count -and ($NowMs-[long]$taskAttempts[-1]) -lt 60000)){return $false}
 if($Reserve){$Ledger.wallpapers[$Key]=@($taskAttempts)+@($NowMs)}
 return $true
}
function New-BiblioteczkaLivelyCursor {return [pscustomobject]@{path='';offset=[long]0;carry='';mapping=@{}}}
function Read-BiblioteczkaLivelyFailures($Cursor,[string]$LogRoot,[string]$Origin,[object[]]$Targets) {
 try{
  $taskLog=Get-ChildItem -LiteralPath $LogRoot -Filter '*.txt' -File -ErrorAction Stop|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1
  if(-not $taskLog){return}
  $taskInitial=$Cursor.path -cne $taskLog.FullName -or $taskLog.Length -lt $Cursor.offset
  if($taskInitial){$Cursor.path=$taskLog.FullName;$Cursor.offset=[Math]::Max(0,$taskLog.Length-65536);$Cursor.carry='';$Cursor.mapping=@{}}
  $taskStream=[IO.File]::Open($taskLog.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try{
   [void]$taskStream.Seek($Cursor.offset,[IO.SeekOrigin]::Begin)
   $taskBytes=New-Object byte[] 65536;$taskRead=$taskStream.Read($taskBytes,0,$taskBytes.Length);$Cursor.offset=$taskStream.Position
  }finally{$taskStream.Dispose()}
  if(-not $taskRead){return}
  $taskLines=($Cursor.carry+[Text.Encoding]::UTF8.GetString($taskBytes,0,$taskRead)) -split "`n"
  $Cursor.carry=$taskLines[-1];if($Cursor.carry.Length -gt 4096){$Cursor.carry=''}
  $taskPending=@{}
  for($taskN=0;$taskN -lt $taskLines.Length-1;$taskN++){
   $taskLine=$taskLines[$taskN].TrimEnd("`r")
   if($taskLine -match '\|Wv(\d+): Opening address:\s*(\S+)\s*$'){$Cursor.mapping[$Matches[1]]=$Matches[2];if($Cursor.mapping.Count -gt 64){$Cursor.mapping=@{}};continue}
   if($taskLine -notmatch '\|Wv(\d+):'){continue};$taskId=$Matches[1]
   if($Cursor.mapping[$taskId] -cne ($Origin+'/wallpaper')){continue}
   if($taskLine -match '"Success"\s*:\s*true'){$taskPending.Remove($taskId)}
   elseif($taskLine -match 'WebView navigation failed:'){$taskPending[$taskId]=$true}
  }
  if(-not $taskInitial -and $taskPending.Count -gt 0 -and $Targets.Count -eq 1){$Targets[0]}
 }catch{return}
}
function Get-BiblioteczkaLivelyHost {
 try{
  $taskSession=(Get-Process -Id $PID).SessionId
  $taskHosts=@(Get-Process -Name Lively -ErrorAction SilentlyContinue|Where-Object{$_.SessionId -eq $taskSession -and $_.Path})
  if($taskHosts.Count -eq 1 -and [IO.File]::Exists($taskHosts[0].Path)){return $taskHosts[0].Path}
 }catch{}
 return $null
}
function Test-BiblioteczkaLivelyPerDisplay([string]$DataRoot) {
 try{
  $taskSettings=Get-Item -LiteralPath (Join-Path $DataRoot 'Settings.json') -Force -ErrorAction Stop
  if($taskSettings.PSIsContainer -or ($taskSettings.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskSettings.Length -gt 1048576){return $false}
  $taskMode=([IO.File]::ReadAllText($taskSettings.FullName)|ConvertFrom-Json -ErrorAction Stop).WallpaperArrangement
  return ($taskMode -is [ValueType] -and $taskMode -isnot [bool] -and $taskMode -eq 0)
 }catch{return $false}
}
function Test-BiblioteczkaLivelyReload([string]$DataRoot,[string]$Exe) {
 try{return (Test-BiblioteczkaLivelyPerDisplay $DataRoot) -and (Get-BiblioteczkaLivelyHost) -ieq $Exe -and ([version][Diagnostics.FileVersionInfo]::GetVersionInfo($Exe).FileVersion -ge [version]'2.2.0.0')}catch{return $false}
}
function Get-BiblioteczkaDisplayTopology {
 # Lively assigns its one-based monitor index in EnumDisplayMonitors order.
 if(-not ('Biblioteczka.LiveDisplays' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;
namespace Biblioteczka {public static class LiveDisplays {
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Info {
  public int size;public Rect bounds,work;public uint flags;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string device;
 }
 delegate bool MonitorCallback(IntPtr monitor,IntPtr hdc,IntPtr rect,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc,IntPtr clip,MonitorCallback callback,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor,ref Info info);
 public static string[] Read(){var rows=new List<string>();
  if(!EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,(monitor,hdc,rect,data)=>{
   var info=new Info();info.size=Marshal.SizeOf(info);if(!GetMonitorInfo(monitor,ref info)||String.IsNullOrEmpty(info.device))return false;
   rows.Add((rows.Count+1)+"|"+info.device+"|"+info.bounds.left+","+info.bounds.top+","+info.bounds.right+","+info.bounds.bottom+"|"+info.flags);return true;
  },IntPtr.Zero))throw new InvalidOperationException("Cannot verify display order.");
  return rows.ToArray();
 }
}}
'@}
 return [Biblioteczka.LiveDisplays]::Read()
}
function Send-BiblioteczkaLivelyCommand([string]$Exe,[string]$Command,[string[]]$Arguments) {
 if($Command -cne 'setwp' -or ($Arguments -join ' ') -cnotmatch '^--file reload --monitor ([1-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$'){throw 'Unsupported Lively repair command.'}
 $taskLiteral=@($Command)+@($Arguments)
 foreach($taskValue in $taskLiteral){if($taskValue.Contains('"') -or $taskValue.Contains([char]0)){throw 'Invalid Lively argument.'}}
 $taskArgs=($taskLiteral|ForEach-Object{'"'+($_ -replace '(\\+)$','$1$1')+'"'})-join ' '
 # Keeping the existing singleton handle alive makes the invocation a relay even
 # if the user closes Lively between the last check and process creation.
 try{$taskSingleton=[Threading.Mutex]::OpenExisting('LIVELY:DESKTOPWALLPAPERSYSTEM')}catch{return $false}
 try{
  if((Get-BiblioteczkaLivelyHost) -ine $Exe){return $false}
  $taskRelay=Start-Process -FilePath $Exe -ArgumentList $taskArgs -WindowStyle Hidden -PassThru -ErrorAction Stop
  if(-not $taskRelay.WaitForExit(5000)){try{$taskRelay.Kill();$null=$taskRelay.WaitForExit(1000)}catch{};return $false}
  return $taskRelay.ExitCode -eq 0
 }finally{if($taskRelay){$taskRelay.Dispose()};$taskSingleton.Dispose()}
}
function Invoke-BiblioteczkaLivelyRepair([string]$DataRoot,[string]$Origin,[string]$Key,[string]$Exe,
 [scriptblock]$Read={param($data,$origin) Get-BiblioteczkaLivelyLayout $data $origin},
 [scriptblock]$Topology={Get-BiblioteczkaDisplayTopology},
 [scriptblock]$Send={param($exe,$command,$arguments) Send-BiblioteczkaLivelyCommand $exe $command $arguments},
 [scriptblock]$Permit={param($data,$exe) Test-BiblioteczkaLivelyReload $data $exe}) {
 if(-not (&$Permit $DataRoot $Exe)){return 'UNAVAILABLE'}
 $taskTargets=@(&$Read $DataRoot $Origin|Where-Object{$_.key -ceq $Key -and $_.matches})
 if($taskTargets.Count -ne 1){return 'SELECTION_CHANGED'}
 $taskTarget=$taskTargets[0];$taskTopology=@(&$Topology)
 $taskMapping=@($taskTopology|Where-Object{$taskParts=$_ -split '\|',3;$taskParts[0] -ceq [string]$taskTarget.monitor -and $taskParts[1] -ieq $taskTarget.deviceName})
 if(-not $taskTarget.deviceName -or $taskMapping.Count -ne 1){return 'DISPLAY_CHANGED'}
 if(-not (&$Permit $DataRoot $Exe)){return 'UNAVAILABLE'}
 $taskCurrent=@(&$Read $DataRoot $Origin|Where-Object{$_.deviceId -ceq $taskTarget.deviceId -or $_.monitor -eq $taskTarget.monitor})
 if($taskCurrent.Count -ne 1 -or -not $taskCurrent[0].matches -or $taskCurrent[0].project -cne $taskTarget.project -or $taskCurrent[0].deviceId -cne $taskTarget.deviceId -or $taskCurrent[0].deviceName -ine $taskTarget.deviceName -or $taskCurrent[0].monitor -ne $taskTarget.monitor){return 'SELECTION_CHANGED'}
 if((@(&$Topology)-join ';') -cne ($taskTopology-join ';')){return 'DISPLAY_CHANGED'}
 if(-not (&$Permit $DataRoot $Exe)){return 'UNAVAILABLE'}
 if(-not (&$Send $Exe 'setwp' @('--file','reload','--monitor',[string]$taskTarget.monitor))){return 'REPAIR_FAILED'}
 return 'RELOAD_REQUESTED'
}
