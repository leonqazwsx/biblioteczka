param([Parameter(Mandatory=$true)][string]$AppRoot,[int]$Port=47831,[ValidateSet('status','enable','disable','open-settings')][string]$Action='status')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
try {
 . (Join-Path $PSScriptRoot 'desktop-functions.ps1')
 if ($Action -eq 'open-settings') { $taskStatus=Open-BiblioteczkaSettings $Port }
 elseif ($Action -eq 'status') { $taskStatus=Get-BiblioteczkaAutostart $AppRoot $Port }
 else { $taskStatus=Set-BiblioteczkaAutostart $AppRoot $Port ($Action -eq 'enable') }
 $taskStatus | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message);exit 1 }
