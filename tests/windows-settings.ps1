$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/desktop-functions.ps1')
$script:entryCalls=@()
function Start-Process {param([string]$FilePath) $script:entryCalls+= $FilePath}
foreach($entryPort in @(47831,64019,65535)) {
 $entryResult=Open-BiblioteczkaSettings $entryPort
 if(-not $entryResult.opened){throw 'Missing opened confirmation'}
 if($script:entryCalls[-1] -cne ('http://127.0.0.1:'+$entryPort+'/manager#settings?group=appearance')){throw 'Wrong settings URL'}
}
foreach($entryPort in @(0,-1,65536)){try{Open-BiblioteczkaSettings $entryPort;throw 'INVALID_PORT_ACCEPTED'}catch{if($_.Exception.Message -eq 'INVALID_PORT_ACCEPTED'){throw}}}
if($script:entryCalls.Count -ne 3){throw 'Invalid input launched browser'}
'WINDOWS_SETTINGS_OK'
