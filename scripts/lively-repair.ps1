param([Parameter(Mandatory=$true)][string]$AppRoot,[int]$Port=47831,[Parameter(Mandatory=$true)][string]$DisplayKey)
$ErrorActionPreference='Stop'
try{
 . (Join-Path $PSScriptRoot 'desktop-functions.ps1');. (Join-Path $PSScriptRoot 'runtime-functions.ps1');. (Join-Path $PSScriptRoot 'lively-functions.ps1')
 $taskRoot=[IO.Path]::GetFullPath($AppRoot);$taskData=Join-Path $taskRoot 'data';$taskOrigin='http://127.0.0.1:'+$Port
 if($Port -lt 1 -or $Port -gt 65535 -or $DisplayKey -notmatch '^[a-f0-9]{64}$'){throw 'Invalid wallpaper repair request.'}
 $taskHealth=Invoke-RestMethod ($taskOrigin+'/api/health') -TimeoutSec 2
 if($taskHealth.appId -ne 'bookshelf-wallpaper' -or $taskHealth.installationId -cne (Get-BiblioteczkaIdentity $taskRoot) -or $taskHealth.recovery -eq 'unrecoverable'){throw 'Local runtime is not ready.'}
 $taskHost=Get-BiblioteczkaLivelyHost
 if(-not $taskHost){exit 0}
 $taskLivelyData=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Lively Wallpaper'
 $taskResult=Invoke-BiblioteczkaLivelyRepair $taskLivelyData $taskOrigin $DisplayKey $taskHost -Permit {
  param($data,$exe)
  (Read-BiblioteczkaStopIntent $taskData $taskHealth) -eq 'none' -and (Test-BiblioteczkaLivelyReload $data $exe)
 }
 Write-BiblioteczkaRuntimeEvent $taskData ('WALLPAPER_'+$taskResult)|Out-Null
}catch{if($taskData){Write-BiblioteczkaRuntimeEvent $taskData 'WALLPAPER_REPAIR_FAILED'|Out-Null};exit 1}
