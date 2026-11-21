$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/runtime-policy.ps1')
function Assert-Policy($Value,$Message){if(-not $Value){throw $Message}}
function Decision($State,$Observation,$Now,[bool]$Owned=$true){return Get-BiblioteczkaRecoveryDecision $State $Observation $Now $Owned}
$taskState=New-BiblioteczkaRecoveryState 0
Assert-Policy ((Decision $taskState 'dead' 2000).kind -eq 'wait') 'First failure must wait.'
Assert-Policy ((Decision $taskState 'dead' 4000).kind -eq 'wait') 'Second failure must wait.'
$taskDecision=Decision $taskState 'dead' 6000
Assert-Policy ($taskDecision.kind -eq 'recover' -and -not $taskDecision.terminate) 'Third dead probe must recover without killing a process.'
Start-BiblioteczkaRecoveryAttempt $taskState 6000
Assert-Policy ((Decision $taskState 'dead' 8000).kind -eq 'wait') 'Concurrent launch must not happen.'
Complete-BiblioteczkaRecoveryAttempt $taskState $false 9000
Assert-Policy ((Decision $taskState 'dead' 13999).kind -eq 'wait') 'First failed start cooldown must be 5 seconds.'
Assert-Policy ((Decision $taskState 'dead' 14000).kind -eq 'recover') 'Cooldown boundary must allow another attempt.'
Start-BiblioteczkaRecoveryAttempt $taskState 14000
Complete-BiblioteczkaRecoveryAttempt $taskState $false 15000
Assert-Policy ($taskState.retryAtMs -eq 30000) 'Second failed start cooldown must be 15 seconds.'
Start-BiblioteczkaRecoveryAttempt $taskState 30000
Complete-BiblioteczkaRecoveryAttempt $taskState $false 31000
Assert-Policy ($taskState.retryAtMs -eq 91000) 'Third failed start cooldown must be 60 seconds.'
Assert-Policy ((Decision $taskState 'dead' 33000).kind -eq 'limited') 'Only three automatic attempts are allowed.'
Complete-BiblioteczkaRecoveryAttempt $taskState $true 34000
Assert-Policy ($taskState.attempts.Count -eq 3) 'Success must not erase rolling attempt history.'
Reset-BiblioteczkaRecoveryState $taskState 35000
Assert-Policy ($taskState.attempts.Count -eq 0 -and $taskState.failures -eq 0) 'Explicit retry must reset bounded series.'

$taskHung=New-BiblioteczkaRecoveryState 0
for($taskN=1;$taskN -lt 15;$taskN++){Assert-Policy ((Decision $taskHung 'hung' ($taskN*2000)).kind -eq 'wait') 'Hung process must receive 15 failed probes.'}
$taskDecision=Decision $taskHung 'hung' 30000
Assert-Policy ($taskDecision.kind -eq 'recover' -and $taskDecision.terminate) 'Verified hung process must become recoverable.'
$taskUnknown=New-BiblioteczkaRecoveryState 0
for($taskN=1;$taskN -le 16;$taskN++){Assert-Policy ((Decision $taskUnknown 'hung' ($taskN*2000) $false).kind -eq 'blocked') 'Unknown process must never be killed.'}
Assert-Policy ((Decision $taskUnknown 'foreign' 34000).kind -eq 'blocked') 'Foreign port must be protected.'
Assert-Policy ((Decision $taskUnknown 'intent' 36000).kind -eq 'stop') 'Intentional stop must take priority.'

$taskResume=New-BiblioteczkaRecoveryState 0
Decision $taskResume 'dead' 2000|Out-Null;Decision $taskResume 'dead' 4000|Out-Null
Assert-Policy ((Decision $taskResume 'dead' 20000).kind -eq 'wait' -and $taskResume.failures -eq 1) 'Resume gap must reset old failure streak.'
Decision $taskResume 'ok' 22000|Out-Null
Assert-Policy ($taskResume.failures -eq 0) 'Healthy response must clear a transient failure streak.'

$taskWindow=New-BiblioteczkaRecoveryState 0 @(0,2000,4000)
Decision $taskWindow 'ok' 6000|Out-Null
Decision $taskWindow 'dead' 8000|Out-Null;Decision $taskWindow 'dead' 10000|Out-Null
Assert-Policy ((Decision $taskWindow 'dead' 12000).kind -eq 'limited') 'Loaded history must enforce rolling limit.'
Decision $taskWindow 'dead' 604001|Out-Null;Decision $taskWindow 'dead' 606001|Out-Null
Assert-Policy ((Decision $taskWindow 'dead' 608001).kind -eq 'recover') 'Expired history must allow bounded recovery.'
$taskBackwards=New-BiblioteczkaRecoveryState 6000 @(2000,4000,6000)
Decision $taskBackwards 'dead' 0|Out-Null;Decision $taskBackwards 'dead' 2000|Out-Null
Assert-Policy ((Decision $taskBackwards 'dead' 4000).kind -eq 'limited') 'Clock rollback must not erase recent attempts.'
Write-Output 'RUNTIME_POLICY_OK'
