param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Target,[int]$Port=47831,[switch]$Quiet)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
try {
 $taskSource=[IO.Path]::GetFullPath($Source);$taskTarget=[IO.Path]::GetFullPath($Target)
 $taskInstallOutput = & (Join-Path $taskSource 'runtime/node.exe') (Join-Path $taskSource 'scripts/install.mjs') --source $taskSource --target $taskTarget --port $Port
 $taskInstallExitCode=$LASTEXITCODE
 $taskInstallOutput | Write-Output
 if ($taskInstallExitCode -ne 0) { exit $taskInstallExitCode }
 $taskInstallResult=($taskInstallOutput -join [Environment]::NewLine)|ConvertFrom-Json
 $taskInstallWarning=''
 if ($taskInstallResult.cleanupWarning) { $taskInstallWarning=$taskInstallResult.cleanupWarning+'; zachowano: '+($taskInstallResult.preserved -join ', ');Write-Output ('BOOKSHELF_CLEANUP_WARNING: '+$taskInstallWarning) }
 if ($taskInstallWarning) { [IO.File]::WriteAllText((Join-Path $taskSource 'install-warning.txt'),$taskInstallWarning,(New-Object Text.UTF8Encoding($false))) }
 $taskStartArgs=@{AppRoot=$taskTarget;Port=$Port}
 if ($Quiet) { $taskStartArgs.NoBrowser=$true;$taskStartArgs.NoTray=$true }
 & (Join-Path $taskTarget 'scripts/start.ps1') @taskStartArgs
 if ($LASTEXITCODE -ne 0) {
  $taskStartWarning='Biblioteczka została zainstalowana, ale uruchomienie ikony lub panelu nie zakończyło się. Uruchom Start-Bookshelf.cmd z folderu '+$taskTarget+'; szczegóły: data/tray-error.log i data/server-error.log.'
  Write-Output ('BOOKSHELF_START_WARNING: '+$taskStartWarning)
  [IO.File]::WriteAllText((Join-Path $taskSource 'install-warning.txt'),($taskInstallWarning+' '+$taskStartWarning).Trim(),(New-Object Text.UTF8Encoding($false)))
 }
 exit 0
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
