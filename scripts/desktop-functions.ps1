function Get-BiblioteczkaIdentity([string]$AppRoot) {
 $taskRoot=[IO.Path]::GetFullPath($AppRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
 $taskData=Join-Path $taskRoot 'data'
 $taskSha=[Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($taskSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($taskRoot.ToLowerInvariant()+"`n"+$taskData.ToLowerInvariant())))).Replace('-','').ToLowerInvariant() } finally { $taskSha.Dispose() }
}
function Get-BiblioteczkaRunCommand([string]$AppRoot,[int]$Port) {
 if ($Port -lt 1 -or $Port -gt 65535) { throw 'Nieprawidłowy port.' }
 $taskScript=Join-Path ([IO.Path]::GetFullPath($AppRoot)) 'scripts/start.ps1'
 $taskPowerShell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
 return '"'+$taskPowerShell+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$taskScript+'" -NoBrowser -Port '+$Port
}
function Get-BiblioteczkaStartupShortcut([string]$AppRoot,[int]$Port,[string]$StartupDirectory=[Environment]::GetFolderPath('Startup')) {
 # A shortcut uses separate executable/argument fields, with no shell interpolation.
 $taskCommand=Get-BiblioteczkaRunCommand $AppRoot $Port
 if (-not $StartupDirectory) { throw 'Nie mozna odnalezc folderu Autostart Windows.' }
 $taskPowerShell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
 $taskArguments=$taskCommand.Substring($taskPowerShell.Length+3)
 $taskLinkPath=Join-Path $StartupDirectory ('Biblioteczka-'+(Get-BiblioteczkaIdentity $AppRoot)+'.lnk')
 $taskExists=Test-Path -LiteralPath $taskLinkPath
 $taskMatches=$false;$taskShell=$null;$taskLink=$null
 if ($taskExists) {
  try {
   $taskItem=Get-Item -LiteralPath $taskLinkPath -Force
   if (-not $taskItem.PSIsContainer -and -not ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    $taskShell=New-Object -ComObject WScript.Shell
    $taskLink=$taskShell.CreateShortcut($taskLinkPath)
    $taskMatches=$taskLink.TargetPath -ieq $taskPowerShell -and $taskLink.Arguments -ceq $taskArguments -and $taskLink.WorkingDirectory -ieq [IO.Path]::GetFullPath($AppRoot)
   }
  } catch { $taskMatches=$false }
  finally {
   if ($taskLink) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskLink) }
   if ($taskShell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell) }
  }
 }
 return [pscustomobject]@{path=$taskLinkPath;target=$taskPowerShell;arguments=$taskArguments;workingDirectory=[IO.Path]::GetFullPath($AppRoot);exists=$taskExists;matches=$taskMatches}
}
function Get-BiblioteczkaAutostart([string]$AppRoot,[int]$Port,[string]$KeyPath='Software\Microsoft\Windows\CurrentVersion\Run',[string]$StartupDirectory=[Environment]::GetFolderPath('Startup')) {
 $taskName='Biblioteczka-'+(Get-BiblioteczkaIdentity $AppRoot)
 $taskCommand=Get-BiblioteczkaRunCommand $AppRoot $Port
 $taskKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($KeyPath)
 $taskValue=$null
 if ($taskKey) { try { $taskValue=$taskKey.GetValue($taskName,$null) } finally { $taskKey.Dispose() } }
 $taskShortcut=Get-BiblioteczkaStartupShortcut $AppRoot $Port $StartupDirectory
 $taskConflict=($null -ne $taskValue -and $taskValue -cne $taskCommand) -or ($taskShortcut.exists -and -not $taskShortcut.matches)
 $taskMessage=if ($taskConflict) {'Wpis autostartu ma inną wartość. Nie zostanie zmieniony.'} elseif ($taskCommand.Length -gt 260) {'Ścieżka jest za długa dla autostartu Windows. Wybierz krótszy folder instalacji.'} else {''}
 return [pscustomobject]@{supported=$true;autostart=($taskValue -ceq $taskCommand -or $taskShortcut.matches);conflict=$taskConflict;canEnable=($taskCommand.Length -le 260 -and -not $taskConflict);message=$taskMessage}
}
function Set-BiblioteczkaAutostart([string]$AppRoot,[int]$Port,[bool]$Enabled,[string]$KeyPath='Software\Microsoft\Windows\CurrentVersion\Run',[string]$StartupDirectory=[Environment]::GetFolderPath('Startup')) {
 $taskStatus=Get-BiblioteczkaAutostart $AppRoot $Port $KeyPath $StartupDirectory
 if ($taskStatus.conflict -or ($Enabled -and -not $taskStatus.canEnable)) { throw $taskStatus.message }
 $taskName='Biblioteczka-'+(Get-BiblioteczkaIdentity $AppRoot)
 $taskShortcut=Get-BiblioteczkaStartupShortcut $AppRoot $Port $StartupDirectory
 if ($Enabled -and -not $taskShortcut.matches) {
  $taskShell=$null;$taskLink=$null
  # Retain any owned legacy registration until saving and reading the replacement succeeds.
  try {
   New-Item -ItemType Directory -Path $StartupDirectory -Force -ErrorAction Stop | Out-Null
   $taskShell=New-Object -ComObject WScript.Shell
   $taskLink=$taskShell.CreateShortcut($taskShortcut.path)
   $taskLink.TargetPath=$taskShortcut.target;$taskLink.Arguments=$taskShortcut.arguments
   $taskLink.WorkingDirectory=$taskShortcut.workingDirectory;$taskLink.WindowStyle=7
   $taskLink.Description='Biblioteczka - uruchomienie po zalogowaniu';$taskLink.Save()
  } finally {
   if ($taskLink) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskLink) }
   if ($taskShell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell) }
  }
  if (-not (Get-BiblioteczkaStartupShortcut $AppRoot $Port $StartupDirectory).matches) { throw 'Nie udalo sie potwierdzic skrotu Autostart. Poprzedni wpis zostal zachowany.' }
 } elseif (-not $Enabled -and $taskShortcut.matches) { Remove-Item -LiteralPath $taskShortcut.path -Force -ErrorAction Stop }
 $taskKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($KeyPath,$true)
 if ($taskKey) {
  try {
   $taskLegacy=$taskKey.GetValue($taskName,$null)
   if ($null -ne $taskLegacy) {
    if ($taskLegacy -cne (Get-BiblioteczkaRunCommand $AppRoot $Port)) { throw 'Wpis autostartu ma inna wartosc. Nie zostanie zmieniony.' }
    $taskKey.DeleteValue($taskName,$false)
   }
  } finally { $taskKey.Dispose() }
 }
 return Get-BiblioteczkaAutostart $AppRoot $Port $KeyPath $StartupDirectory
}

function Confirm-BiblioteczkaQuit([string]$Origin,[string]$Identity,[int]$ExpectedPid) {
 $taskCurrent=Invoke-RestMethod ($Origin+'/api/health') -TimeoutSec 1
 if ($taskCurrent.appId -ne 'bookshelf-wallpaper' -or $taskCurrent.installationId -ne $Identity -or $taskCurrent.pid -ne $ExpectedPid) { throw 'Nie można potwierdzić serwera do zamknięcia.' }
 $taskBootstrap=Invoke-RestMethod ($Origin+'/api/bootstrap') -TimeoutSec 2
 $taskBefore=Get-Process -Id $ExpectedPid -ErrorAction SilentlyContinue
 $taskStarted=if($taskBefore){try{$taskBefore.StartTime.ToUniversalTime().Ticks}catch{}}
 Invoke-RestMethod ($Origin+'/api/shutdown') -Method Post -ContentType 'application/json' -Headers @{Origin=$Origin;'X-Bookshelf-Token'=$taskBootstrap.token} -Body (@{expectedPid=$ExpectedPid}|ConvertTo-Json -Compress) -TimeoutSec 2 | Out-Null
 $taskUnavailable=0
 for ($taskQuitAttempt=0;$taskQuitAttempt -lt 10;$taskQuitAttempt++) {
  Start-Sleep -Milliseconds 200
  try {
   $taskCurrent=Invoke-RestMethod ($Origin+'/api/health') -TimeoutSec 1
   $taskUnavailable=0
   if ($taskCurrent.appId -ne 'bookshelf-wallpaper' -or $taskCurrent.installationId -ne $Identity -or $taskCurrent.pid -ne $ExpectedPid) { return $true }
  } catch {
   $taskAfter=Get-Process -Id $ExpectedPid -ErrorAction SilentlyContinue
   if(-not $taskAfter){return $true}
   if($taskStarted){try{if($taskAfter.StartTime.ToUniversalTime().Ticks -ne $taskStarted){return $true}}catch{}}
   if ($_.Exception -is [Net.WebException] -and $_.Exception.Status -eq [Net.WebExceptionStatus]::ConnectFailure) { $taskUnavailable++;if ($taskUnavailable -ge 2) { return $true } } else { $taskUnavailable=0 }
  }
 }
 throw 'Serwer nadal pracuje. Nie potwierdzono zamknięcia. Spróbuj ponownie.'
}

function Open-BiblioteczkaSettings([int]$Port) {
 if ($Port -lt 1 -or $Port -gt 65535) { throw 'Nieprawidlowy port.' }
 $taskSettingsUrl='http://127.0.0.1:'+$Port+'/manager#settings?group=appearance'
 Start-Process -FilePath $taskSettingsUrl | Out-Null
 return [pscustomobject]@{opened=$true}
}
