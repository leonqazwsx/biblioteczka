# Pure policy; all clocks and observations come from the caller.
function New-BiblioteczkaRecoveryState([long]$NowMs,[object[]]$Attempts=@()) {
 return [pscustomobject]@{lastProbeMs=$NowMs;failures=0;attempts=@($Attempts);phase='healthy';retryAtMs=[long]0}
}
function Update-BiblioteczkaRecoveryWindow($State,[long]$NowMs) {
 # Future timestamps remain charged after a wall-clock adjustment.
 $State.attempts=@($State.attempts|Where-Object{($NowMs-[long]$_) -lt 600000})
}
function Get-BiblioteczkaRecoveryDecision($State,[string]$Observation,[long]$NowMs,[bool]$Owned=$true) {
 if(($NowMs-$State.lastProbeMs) -gt 10000 -or $NowMs -lt $State.lastProbeMs){$State.failures=0}
 $State.lastProbeMs=$NowMs
 Update-BiblioteczkaRecoveryWindow $State $NowMs
 if($Observation -eq 'intent'){$State.phase='stopped';return [pscustomobject]@{kind='stop';terminate=$false}}
 if($Observation -in @('foreign','blocked') -or ($Observation -eq 'hung' -and -not $Owned)){$State.phase='blocked';return [pscustomobject]@{kind='blocked';terminate=$false}}
 if($Observation -eq 'ok'){$State.phase='healthy';$State.failures=0;$State.retryAtMs=0;return [pscustomobject]@{kind='steady';terminate=$false}}
 if($State.phase -eq 'starting'){return [pscustomobject]@{kind='wait';terminate=$false}}
 if($Observation -notin @('dead','hung')){throw 'Unknown runtime observation.'}
 $State.failures++
 if($State.attempts.Count -ge 3){$State.phase='limited';return [pscustomobject]@{kind='limited';terminate=$false}}
 $taskThreshold=if($Observation -eq 'dead'){3}else{15}
 if($State.failures -lt $taskThreshold -or $NowMs -lt $State.retryAtMs){return [pscustomobject]@{kind='wait';terminate=$false}}
 return [pscustomobject]@{kind='recover';terminate=($Observation -eq 'hung')}
}
function Start-BiblioteczkaRecoveryAttempt($State,[long]$NowMs) {
 Update-BiblioteczkaRecoveryWindow $State $NowMs
 if($State.attempts.Count -ge 3 -or $State.phase -eq 'starting'){throw 'Recovery attempt is not available.'}
 $State.attempts=@($State.attempts)+@($NowMs);$State.phase='starting'
}
function Complete-BiblioteczkaRecoveryAttempt($State,[bool]$Success,[long]$NowMs) {
 if($Success){$State.phase='healthy';$State.failures=0;$State.retryAtMs=0;return}
 $taskIndex=[Math]::Max(0,[Math]::Min(2,$State.attempts.Count-1))
 $State.phase='waiting';$State.retryAtMs=$NowMs+(@(5000,15000,60000)[$taskIndex])
}
function Reset-BiblioteczkaRecoveryState($State,[long]$NowMs) {
 $State.attempts=@();$State.phase='waiting';$State.retryAtMs=0;$State.failures=0;$State.lastProbeMs=$NowMs
}
