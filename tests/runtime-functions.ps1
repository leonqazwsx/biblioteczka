$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/desktop-functions.ps1')
. (Join-Path $PSScriptRoot '../scripts/runtime-functions.ps1')
function Assert-Runtime($Value,$Message){if(-not $Value){throw $Message}}
$taskFixture=Join-Path $env:TEMP ('Bookshelf runtime helpers '+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $taskFixture|Out-Null
try {
 $taskHealth=[pscustomobject]@{installationId='fixture-installation';pid=123;sessionId='fixture-session'}
 Assert-Runtime ((Read-BiblioteczkaStopIntent $taskFixture $taskHealth) -eq 'none') 'Missing intent is not a stop.'
 $taskStop=[pscustomobject]@{version=1;appId='bookshelf-wallpaper';installationId='fixture-installation';pid=123;sessionId='old-session';createdAt='2026-11-03T00:00:00Z'}
 Write-BiblioteczkaAtomicJson (Join-Path $taskFixture 'runtime-stop.json') $taskStop
 Assert-Runtime ((Read-BiblioteczkaStopIntent $taskFixture $taskHealth) -eq 'none') 'Old session must not stop current runtime.'
 $taskStop.sessionId='fixture-session';Write-BiblioteczkaAtomicJson (Join-Path $taskFixture 'runtime-stop.json') $taskStop
 Assert-Runtime ((Read-BiblioteczkaStopIntent $taskFixture $taskHealth) -eq 'stop') 'Matching intent must stop recovery.'
 $taskNonce=[guid]::NewGuid().ToString();$taskStop.pid=456;$taskStop.sessionId='not-yet-observed';$taskStop|Add-Member NoteProperty recoveryNonce $taskNonce
 Write-BiblioteczkaAtomicJson (Join-Path $taskFixture 'runtime-stop.json') $taskStop
 Assert-Runtime ((Read-BiblioteczkaStopIntent $taskFixture $taskHealth $taskNonce) -eq 'stop') 'Stop before adoption must match the active recovery lease.'
 Assert-Runtime ((Read-BiblioteczkaStopIntent $taskFixture $taskHealth ([guid]::NewGuid().ToString())) -eq 'none') 'Old recovery lease must not stop current runtime.'
 [IO.File]::WriteAllText((Join-Path $taskFixture 'runtime-stop.json'),'{broken')
 Assert-Runtime ((Read-BiblioteczkaStopIntent $taskFixture $taskHealth) -eq 'invalid') 'Corrupted intent must fail closed.'
 $taskUnsafe=Join-Path $taskFixture 'directory';New-Item -ItemType Directory -Path $taskUnsafe|Out-Null
 $taskRejected=$false;try{Write-BiblioteczkaAtomicJson $taskUnsafe @{keep='no'}}catch{$taskRejected=$true}
 Assert-Runtime $taskRejected 'Atomic writer must not replace a directory.'

 $taskExpected=[pscustomobject]@{pid=123;started='123000';exe='C:\Books\runtime\node.exe';command='"C:\Books\runtime\node.exe" "C:\Books\src\main.mjs" --port 47831'}
 $taskActual=$taskExpected.PSObject.Copy()
 Assert-Runtime (Test-BiblioteczkaProcessFingerprint $taskActual $taskExpected) 'Equal owned fingerprint should match.'
 $taskActual.started='124000'
 Assert-Runtime (-not (Test-BiblioteczkaProcessFingerprint $taskActual $taskExpected)) 'Reused PID must not match.'
 $taskActual=$taskExpected.PSObject.Copy();$taskActual.command='node another.mjs'
 Assert-Runtime (-not (Test-BiblioteczkaProcessFingerprint $taskActual $taskExpected)) 'Different arguments must not match.'
 Assert-Runtime (-not (Test-BiblioteczkaProcessFingerprint $null $taskExpected)) 'Unknown process must not match.'

 $taskLedger=Read-BiblioteczkaRecoveryLedger $taskFixture 'fixture-installation'
 Assert-Runtime ($taskLedger.serverAttempts.Count -eq 0) 'New ledger must be empty.'
 $taskLedger.serverAttempts=@(1000,2000,3000);$taskLedger.wallpapers['a'*64]=@(1000)
 Write-BiblioteczkaRecoveryLedger $taskFixture $taskLedger
 $taskLoaded=Read-BiblioteczkaRecoveryLedger $taskFixture 'fixture-installation'
 Assert-Runtime ($taskLoaded.serverAttempts.Count -eq 3 -and $taskLoaded.wallpapers['a'*64].Count -eq 1) 'Attempt budget must survive reload.'
 $taskOther=Read-BiblioteczkaRecoveryLedger $taskFixture 'different-installation'
 Assert-Runtime ($taskOther.serverAttempts.Count -eq 0) 'Different installation must not inherit control intent.'
 [IO.File]::WriteAllText((Join-Path $taskFixture 'runtime-recovery.json'),'{broken')
 $taskRejected=$false;try{Read-BiblioteczkaRecoveryLedger $taskFixture 'fixture-installation'|Out-Null}catch{$taskRejected=$true}
 Assert-Runtime $taskRejected 'Corrupt budget must not silently reset.'
 Write-BiblioteczkaRuntimeEvent $taskFixture 'RECOVERING' @{attempt=2;token='DO_NOT_LOG_SECRET';title='DO_NOT_LOG_TITLE'}|Out-Null
 $taskLog=[IO.File]::ReadAllText((Join-Path $taskFixture 'runtime-events.log'))
 Assert-Runtime ($taskLog.Contains('RECOVERING') -and -not $taskLog.Contains('DO_NOT_LOG')) 'Logger must retain event but exclude arbitrary details.'
 [IO.File]::WriteAllText((Join-Path $taskFixture 'runtime-events.log'),('x'*131073))
 Write-BiblioteczkaRuntimeEvent $taskFixture 'RECOVERED' @{pid=123}|Out-Null
 Assert-Runtime ((Get-Item -LiteralPath (Join-Path $taskFixture 'runtime-events.log')).Length -lt 1024) 'Active diagnostic log must rotate.'
 $taskLease=New-BiblioteczkaRecoveryLease $taskFixture 'fixture-installation'
 Assert-Runtime (Test-BiblioteczkaRecoveryLease $taskFixture $taskLease.nonce 'fixture-installation') 'Live owner must authorize its recovery start.'
 Assert-Runtime (-not (Test-BiblioteczkaRecoveryLease $taskFixture $taskLease.nonce 'foreign-installation')) 'Foreign owner must not authorize recovery.'
 Cancel-BiblioteczkaRecoveryLease $taskFixture $taskLease.nonce
 Assert-Runtime (-not (Test-BiblioteczkaRecoveryLease $taskFixture $taskLease.nonce 'fixture-installation')) 'Cancelled start must never launch a server.'
 Write-Output 'RUNTIME_FUNCTIONS_OK'
}finally{if($taskFixture.StartsWith([IO.Path]::GetFullPath($env:TEMP)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $taskFixture -Recurse -Force}}
