param([string]$NodeRuntimePath, [string]$PreviousAppPath, [int]$LegacyProcessId, [int]$Port = 47831, [switch]$CreateZip)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$taskRuntime = if ($NodeRuntimePath) { (Resolve-Path -LiteralPath $NodeRuntimePath).Path } else { Join-Path $taskRoot 'Biblioteczka/runtime' }
foreach ($taskRequired in @('node.exe','LICENSE')) { if (-not (Test-Path -LiteralPath (Join-Path $taskRuntime $taskRequired))) { throw "Brakuje $taskRequired w runtime. Przy pierwszym wydaniu podaj -NodeRuntimePath." } }
# Run the publisher from a temporary runtime so Windows does not lock the app being replaced.
$taskRunner = [IO.Path]::GetFullPath((Join-Path $taskRoot ('.bookshelf-runner-' + [Guid]::NewGuid().ToString())))
if (-not $taskRunner.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Nieprawidłowy folder pomocniczy.' }
$taskArchive = $null
try {
  New-Item -ItemType Directory -Path $taskRunner | Out-Null
  Copy-Item -LiteralPath (Join-Path $taskRuntime 'node.exe') -Destination (Join-Path $taskRunner 'node.exe')
  $taskArguments = @((Join-Path $taskRoot 'scripts/publish.mjs'), '--runtime', $taskRuntime, '--port', [string]$Port)
  if ($PreviousAppPath) { $taskArguments += @('--previous', (Resolve-Path -LiteralPath $PreviousAppPath).Path) }
  if ($LegacyProcessId) { $taskArguments += @('--legacy-pid', [string]$LegacyProcessId) }
  & (Join-Path $taskRunner 'node.exe') @taskArguments
  if ($LASTEXITCODE -ne 0) { throw 'Aktualizacja nie zakończyła się. Szczegóły powyżej.' }
  if ($CreateZip) {
    $taskArchive = [IO.Path]::GetFullPath((Join-Path $taskRoot ('.bookshelf-archive-' + [Guid]::NewGuid().ToString())))
    if (-not $taskArchive.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Nieprawidłowy folder archiwum.' }
    $taskApp = Join-Path $taskRoot 'Biblioteczka'
    $taskArchiveApp = Join-Path $taskArchive 'Biblioteczka'
    New-Item -ItemType Directory -Path $taskArchiveApp -Force | Out-Null
    foreach ($taskItem in @('src','public','runtime','scripts','Start-Bookshelf.cmd','package.json','README.md','THIRD-PARTY-NOTICES.md','payload-manifest.json')) { Copy-Item -LiteralPath (Join-Path $taskApp $taskItem) -Destination $taskArchiveApp -Recurse }
    $taskDist = Join-Path $taskRoot 'dist'
    New-Item -ItemType Directory -Path $taskDist -Force | Out-Null
    $taskZip = Join-Path $taskDist 'Biblioteczka-current-win-x64.zip'
    $taskTempZip = Join-Path $taskArchive 'release.zip'
    Compress-Archive -LiteralPath $taskArchiveApp -DestinationPath $taskTempZip
    Move-Item -LiteralPath $taskTempZip -Destination $taskZip -Force
    Write-Output $taskZip
  }
} finally {
  if (Test-Path -LiteralPath $taskRunner) { Remove-Item -LiteralPath $taskRunner -Recurse -Force }
  if ($taskArchive -and (Test-Path -LiteralPath $taskArchive)) { Remove-Item -LiteralPath $taskArchive -Recurse -Force }
}
