$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/lively-functions.ps1')
function Assert-Lively($Value,$Message){if(-not $Value){throw $Message}}
$taskFixture=Join-Path $env:TEMP ('Bookshelf lively '+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path (Join-Path $taskFixture 'Library/mine') -Force|Out-Null
New-Item -ItemType Directory -Path (Join-Path $taskFixture 'Library/other') -Force|Out-Null
New-Item -ItemType Directory -Path (Join-Path $taskFixture 'logs') -Force|Out-Null
try {
 $taskMine=Join-Path $taskFixture 'Library/mine';$taskOther=Join-Path $taskFixture 'Library/other';$taskOrigin='http://127.0.0.1:47831'
 [IO.File]::WriteAllText((Join-Path $taskMine 'LivelyInfo.json'),'{"Type":3,"FileName":"http://127.0.0.1:47831/wallpaper"}')
 [IO.File]::WriteAllText((Join-Path $taskOther 'LivelyInfo.json'),'{"Type":3,"FileName":"http://127.0.0.1:47832/wallpaper"}')
 $taskLayout=@([pscustomobject]@{LivelyScreen=@{Index=1;DeviceId='mine-device';DeviceName='DISPLAY1';isStale=$false};LivelyInfoPath=$taskMine},[pscustomobject]@{LivelyScreen=@{Index=2;DeviceId='other-device';DeviceName='DISPLAY2';isStale=$false};LivelyInfoPath=$taskOther})
 [IO.File]::WriteAllText((Join-Path $taskFixture 'WallpaperLayout.json'),($taskLayout|ConvertTo-Json -Depth 5))
 $taskTargets=@(Get-BiblioteczkaLivelyTargets $taskFixture $taskOrigin)
 Assert-Lively ($taskTargets.Count -eq 1 -and $taskTargets[0].monitor -eq 1) 'Only exact current local wallpaper may be selected.'
 $taskLedger=[pscustomobject]@{wallpapers=@{}}
 Assert-Lively (Test-BiblioteczkaWallpaperBudget $taskLedger $taskTargets[0].key 1000 $true) 'First repair should reserve budget.'
 Assert-Lively (-not (Test-BiblioteczkaWallpaperBudget $taskLedger $taskTargets[0].key 60999 $true)) 'One minute cooldown must hold.'
 Assert-Lively (Test-BiblioteczkaWallpaperBudget $taskLedger $taskTargets[0].key 61000 $true) 'Exact cooldown boundary must allow.'
 Assert-Lively (Test-BiblioteczkaWallpaperBudget $taskLedger $taskTargets[0].key 121000 $true) 'Third repair should be available.'
 Assert-Lively (-not (Test-BiblioteczkaWallpaperBudget $taskLedger $taskTargets[0].key 181000 $true)) 'Three per ten minutes must be enforced.'
 Assert-Lively (Test-BiblioteczkaWallpaperBudget $taskLedger $taskTargets[0].key 601001 $true) 'Expired repair slot should be available.'

 $taskLog=Join-Path $taskFixture 'logs/active.txt'
 [IO.File]::WriteAllText($taskLog,"2026-11-03|INFO|Lively.Core|Wv1: Opening address: $taskOrigin/wallpaper`n2026-11-03|ERROR|Lively.Core|Wv1: WebView navigation failed: ConnectionAborted`n")
 $taskCursor=New-BiblioteczkaLivelyCursor
 Assert-Lively (@(Read-BiblioteczkaLivelyFailures $taskCursor (Join-Path $taskFixture 'logs') $taskOrigin $taskTargets).Count -eq 0) 'Existing errors must seed correlation but never trigger repairs.'
 [IO.File]::AppendAllText($taskLog,"2026-11-03|ERROR|Lively.Core|Wv99: WebView navigation failed: Unknown`n")
 Assert-Lively (@(Read-BiblioteczkaLivelyFailures $taskCursor (Join-Path $taskFixture 'logs') $taskOrigin $taskTargets).Count -eq 0) 'Uncorrelated errors must be ignored.'
 [IO.File]::AppendAllText($taskLog,"2026-11-03|ERROR|Lively.Core|Wv1: WebView navigation failed: Unknown`n")
 Assert-Lively (@(Read-BiblioteczkaLivelyFailures $taskCursor (Join-Path $taskFixture 'logs') $taskOrigin $taskTargets).Count -eq 1) 'Fresh correlated error must be detected.'
 [IO.File]::AppendAllText($taskLog,"2026-11-03|ERROR|Lively.Core|Wv1: WebView navigation failed: Unknown`n2026-11-03|INFO|Lively.Core|Wv1: {`"Type`":2,`"Success`":true}`n")
 Assert-Lively (@(Read-BiblioteczkaLivelyFailures $taskCursor (Join-Path $taskFixture 'logs') $taskOrigin $taskTargets).Count -eq 0) 'Already recovered navigation must not be restarted.'
 $taskAmbiguous=@($taskTargets[0],$taskTargets[0].PSObject.Copy());[IO.File]::AppendAllText($taskLog,"2026-11-03|ERROR|Lively.Core|Wv1: WebView navigation failed: Unknown`n")
 Assert-Lively (@(Read-BiblioteczkaLivelyFailures $taskCursor (Join-Path $taskFixture 'logs') $taskOrigin $taskAmbiguous).Count -eq 0) 'Ambiguous monitor must not be guessed.'
 [IO.File]::WriteAllText($taskLog,"2026-11-03|ERROR|Lively.Core|Wv1: WebView navigation failed: Unknown`n")
 Assert-Lively (@(Read-BiblioteczkaLivelyFailures $taskCursor (Join-Path $taskFixture 'logs') $taskOrigin $taskTargets).Count -eq 0) 'Truncated log must reset correlation safely.'

 $script:taskCurrent=@($taskTargets[0]);$script:taskCalls=@()
 $taskRead={param($data,$origin) return $script:taskCurrent}
 $taskTopology={return @('1|DISPLAY1|bounds|True','2|DISPLAY2|bounds|False')}
 $taskSend={param($exe,$command,$arguments) $script:taskCalls+=,[pscustomobject]@{command=$command;arguments=$arguments};return $true}
 $taskPermit={return $true}
 $taskResult=Invoke-BiblioteczkaLivelyRepair $taskFixture $taskOrigin $taskTargets[0].key 'C:\Lively\Lively.exe' $taskRead $taskTopology $taskSend $taskPermit
 Assert-Lively ($taskResult -eq 'RELOAD_REQUESTED' -and $script:taskCalls.Count -eq 1) 'Reload must never deselect a wallpaper.'
 Assert-Lively ($script:taskCalls[0].command -eq 'setwp' -and ($script:taskCalls[0].arguments -join ' ') -ceq '--file reload --monitor 1') 'Reload must target the exact monitor.'
 $script:taskCalls=@();$script:taskReads=0
 $taskSwitch={param($data,$origin) $script:taskReads++;if($script:taskReads -eq 1){return $script:taskCurrent};return [pscustomobject]@{monitor=1;deviceId='mine-device';key='foreign-key';project=$taskOther}}
 $taskResult=Invoke-BiblioteczkaLivelyRepair $taskFixture $taskOrigin $taskTargets[0].key 'C:\Lively\Lively.exe' $taskSwitch $taskTopology $taskSend $taskPermit
 Assert-Lively ($taskResult -eq 'SELECTION_CHANGED' -and $script:taskCalls.Count -eq 0) 'User wallpaper change must cancel restoration.'
 $taskSwapped={return @('1|DISPLAY2|bounds|True','2|DISPLAY1|bounds|False')}
 $taskResult=Invoke-BiblioteczkaLivelyRepair $taskFixture $taskOrigin $taskTargets[0].key 'C:\Lively\Lively.exe' $taskRead $taskSwapped $taskSend $taskPermit
 Assert-Lively ($taskResult -eq 'DISPLAY_CHANGED' -and $script:taskCalls.Count -eq 0) 'A live device at a different monitor index must not send any command.'
 $taskResult=Invoke-BiblioteczkaLivelyRepair $taskFixture $taskOrigin $taskTargets[0].key 'C:\Lively\Lively.exe' $taskRead $taskTopology $taskSend {return $false}
 Assert-Lively ($taskResult -eq 'UNAVAILABLE' -and $script:taskCalls.Count -eq 0) 'Unknown host or unsupported arrangement must not send a command.'
 foreach($taskMode in 0,1,2){[IO.File]::WriteAllText((Join-Path $taskFixture 'Settings.json'),('{"WallpaperArrangement":'+$taskMode+'}'));Assert-Lively ((Test-BiblioteczkaLivelyPerDisplay $taskFixture) -eq ($taskMode -eq 0)) 'Only separate wallpaper per display can be reloaded.'}
 Write-Output 'LIVELY_RECOVERY_OK'
}finally{if($taskFixture.StartsWith([IO.Path]::GetFullPath($env:TEMP)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $taskFixture -Recurse -Force}}
