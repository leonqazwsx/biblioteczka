param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
. (Join-Path $ProjectRoot 'scripts/desktop-functions.ps1')
function Assert-Task($Value,$Message) { if (-not $Value) { throw $Message } }
$taskTestKey='Software\Biblioteczka\Tests\'+[Guid]::NewGuid().ToString()
$taskFixture=Join-Path $env:TEMP ('Biblioteczka startup '+[Guid]::NewGuid().ToString())
$taskTestRoot="C:\Readers & books\Anna's room\Biblioteczka"
$taskStartup=Join-Path $taskFixture 'Startup'
$taskParams=@{AppRoot=$taskTestRoot;Port=47831;KeyPath=$taskTestKey;StartupDirectory=$taskStartup}
New-Item -ItemType Directory -Path $taskStartup -Force | Out-Null
$taskShell=New-Object -ComObject WScript.Shell
$taskName='Biblioteczka-'+(Get-BiblioteczkaIdentity $taskTestRoot)
$taskLinkPath=Join-Path $taskStartup ($taskName+'.lnk')
function Set-TestLegacy([string]$Value) {
 $taskKey=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($taskTestKey)
 try { $taskKey.SetValue($taskName,$Value) } finally { $taskKey.Dispose() }
}
function Get-TestLegacy {
 $taskKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($taskTestKey)
 if($taskKey){try{return $taskKey.GetValue($taskName,$null)}finally{$taskKey.Dispose()}}
 return $null
}
try {
 $taskInitial=Get-BiblioteczkaAutostart @taskParams
 Assert-Task (-not $taskInitial.autostart) 'Autostart powinien być wyłączony.'
 $taskEnabled=Set-BiblioteczkaAutostart @taskParams -Enabled $true
 Assert-Task ($taskEnabled.autostart) 'Nie zapisano własnej wartości.'
 Assert-Task (Test-Path -LiteralPath $taskLinkPath) 'Nie utworzono skrotu w folderze Startup.'
 $taskLink=$taskShell.CreateShortcut($taskLinkPath)
 Assert-Task ($taskLink.TargetPath -ieq (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')) 'Nieprawidlowy program skrotu.'
 Assert-Task ($taskLink.Arguments -ceq ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $taskTestRoot 'scripts\start.ps1')+'" -NoBrowser -Port 47831')) 'Nieprawidlowe argumenty skrotu.'
 Assert-Task ($taskLink.WorkingDirectory -ieq $taskTestRoot) 'Nieprawidlowy folder roboczy.'
 [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskLink)
 Assert-Task ($null -eq (Get-TestLegacy)) 'Nowa rejestracja nie powinna tworzyc wpisu Run.'
 Set-BiblioteczkaAutostart @taskParams -Enabled $true | Out-Null
 Assert-Task (@(Get-ChildItem -LiteralPath $taskStartup).Count -eq 1) 'Ponowne wlaczenie tworzy duplikat.'
 $taskCommand=Get-BiblioteczkaRunCommand -AppRoot $taskTestRoot -Port 47831
 Assert-Task ($taskCommand.Contains('"'+(Join-Path $taskTestRoot 'scripts/start.ps1')+'"')) 'Ścieżka nie jest cytowana.'
 $taskDisabled=Set-BiblioteczkaAutostart @taskParams -Enabled $false
 Assert-Task (-not $taskDisabled.autostart) 'Wartość pozostała.'
 Assert-Task (-not (Test-Path -LiteralPath $taskLinkPath)) 'Skrot pozostal po wylaczeniu.'
 Set-TestLegacy $taskCommand
 Assert-Task (Get-BiblioteczkaAutostart @taskParams).autostart 'Stary wlasny wpis nie jest rozpoznawany.'
 Set-BiblioteczkaAutostart @taskParams -Enabled $true | Out-Null
 Assert-Task ((Test-Path -LiteralPath $taskLinkPath) -and $null -eq (Get-TestLegacy)) 'Nie zmigrowano wpisu Run.'
 Set-BiblioteczkaAutostart @taskParams -Enabled $false | Out-Null
 Set-TestLegacy 'foreign-command'
 foreach ($taskValue in @($true,$false)) {
  $taskRejected=$false;try { Set-BiblioteczkaAutostart @taskParams -Enabled $taskValue | Out-Null } catch { $taskRejected=$true }
  Assert-Task $taskRejected 'Obca wartość została zaakceptowana.'
 }
 Assert-Task ((Get-TestLegacy) -eq 'foreign-command') 'Obca wartość uległa zmianie.'
 Set-TestLegacy $taskCommand
 $taskLink=$taskShell.CreateShortcut($taskLinkPath);$taskLink.TargetPath=Join-Path $env:SystemRoot 'System32\notepad.exe';$taskLink.Save();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskLink)
 $taskForeignBytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($taskLinkPath))
 foreach($taskValue in @($true,$false)) {
  $taskRejected=$false;try{Set-BiblioteczkaAutostart @taskParams -Enabled $taskValue | Out-Null}catch{$taskRejected=$true}
  Assert-Task $taskRejected 'Obcy skrot zostal zaakceptowany.'
  Assert-Task ([Convert]::ToBase64String([IO.File]::ReadAllBytes($taskLinkPath)) -ceq $taskForeignBytes) 'Obcy skrot ulegl zmianie.'
  Assert-Task ((Get-TestLegacy) -ceq $taskCommand) 'Przy konflikcie usunieto stary wpis.'
 }
 Remove-Item -LiteralPath $taskLinkPath
 $taskBlocked=Join-Path $taskFixture 'file-not-directory';[IO.File]::WriteAllText($taskBlocked,'fixture')
 $taskRejected=$false;try{Set-BiblioteczkaAutostart -AppRoot $taskTestRoot -Port 47831 -KeyPath $taskTestKey -StartupDirectory $taskBlocked -Enabled $true|Out-Null}catch{$taskRejected=$true}
 Assert-Task $taskRejected 'Nie zgloszono bledu zapisu skrotu.'
 Assert-Task ((Get-TestLegacy) -ceq $taskCommand) 'Awaria zapisu usunela stary wpis.'
 Set-BiblioteczkaAutostart @taskParams -Enabled $false|Out-Null
 Assert-Task ($null -eq (Get-TestLegacy)) 'Nie usunieto wlasnego starego wpisu.'
 $taskLongRoot='C:\'+('a'*240)+'\Biblioteczka';$taskRejected=$false
 try { Set-BiblioteczkaAutostart -AppRoot $taskLongRoot -Port 47831 -Enabled $true -KeyPath $taskTestKey -StartupDirectory $taskStartup | Out-Null } catch { $taskRejected=$true }
 Assert-Task $taskRejected 'Za długa komenda została zapisana.'
 $taskRejected=$false;try{Set-BiblioteczkaAutostart -AppRoot $taskTestRoot -Port 0 -Enabled $true -KeyPath $taskTestKey -StartupDirectory $taskStartup|Out-Null}catch{$taskRejected=$true}
 Assert-Task $taskRejected 'Nieprawidlowy port zaakceptowany.'
 Write-Output 'WINDOWS_STARTUP_OK: shortcut, migration, conflicts, failed-save preservation, idempotence, quoting, disable.'
} finally {
 [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell)
 [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($taskTestKey,$false)
 if($taskFixture.StartsWith([IO.Path]::GetFullPath($env:TEMP)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $taskFixture -Recurse -Force}
}
