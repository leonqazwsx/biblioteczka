param([Parameter(Mandatory=$true)][string]$PayloadPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskPayload=(Resolve-Path -LiteralPath $PayloadPath).Path;$taskOutput=[IO.Path]::GetFullPath($OutputPath);$taskParent=Split-Path -Parent $taskOutput
New-Item -ItemType Directory -Path $taskParent -Force | Out-Null
$taskBuild=[IO.Path]::GetFullPath((Join-Path $taskParent ('.bookshelf-build-'+[Guid]::NewGuid().ToString())))
if (-not $taskBuild.StartsWith($taskParent+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Nieprawidłowa ścieżka budowania.' }
try {
 if (Test-Path -LiteralPath (Join-Path $taskPayload 'payload-manifest.json')) {
  & (Join-Path $taskPayload 'runtime/node.exe') (Join-Path $taskPayload 'scripts/payload-manifest.mjs') --verify $taskPayload
  if ($LASTEXITCODE -ne 0) { throw 'Uszkodzony pakiet źródłowy.' }
 }
 $taskStage=Join-Path $taskBuild 'payload';New-Item -ItemType Directory -Path (Join-Path $taskStage 'scripts') -Force | Out-Null
 foreach ($taskFile in @('src','public','Start-Bookshelf.cmd','package.json','README.md','THIRD-PARTY-NOTICES.md')) { Copy-Item -LiteralPath (Join-Path $taskPayload $taskFile) -Destination $taskStage -Recurse }
 foreach ($taskFile in @('start.ps1','desktop-functions.ps1','windows.ps1','tray.ps1','publish.mjs','update-transaction.mjs','payload-manifest.mjs','install.mjs','install.ps1','runtime-functions.ps1','runtime-policy.ps1','lively-functions.ps1','lively-repair.ps1')) { Copy-Item -LiteralPath (Join-Path $taskPayload ('scripts/'+$taskFile)) -Destination (Join-Path $taskStage ('scripts/'+$taskFile)) }
 New-Item -ItemType Directory -Path (Join-Path $taskStage 'runtime') | Out-Null
 foreach ($taskFile in @('node.exe','LICENSE')) { Copy-Item -LiteralPath (Join-Path $taskPayload ('runtime/'+$taskFile)) -Destination (Join-Path $taskStage ('runtime/'+$taskFile)) }
 & (Join-Path $taskStage 'runtime/node.exe') (Join-Path $taskStage 'scripts/payload-manifest.mjs') --write $taskStage
 if ($LASTEXITCODE -ne 0) { throw 'Nie udało się utworzyć manifestu pakietu.' }
 $taskZip=Join-Path $taskBuild 'payload.zip';[IO.Compression.ZipFile]::CreateFromDirectory($taskStage,$taskZip,[IO.Compression.CompressionLevel]::Optimal,$false)
 $taskCompiler=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe';$taskExe=Join-Path $taskBuild 'setup.exe'
 & $taskCompiler /nologo /target:winexe /platform:x64 ('/out:'+$taskExe) ('/resource:'+ $taskZip +',payload.zip') /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll (Join-Path $PSScriptRoot 'setup.cs')
 if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $taskExe)) { throw 'Nie udało się skompilować instalatora.' }
 Move-Item -LiteralPath $taskExe -Destination $taskOutput -Force
 Write-Output $taskOutput
}finally{if(Test-Path -LiteralPath $taskBuild){Remove-Item -LiteralPath $taskBuild -Recurse -Force}}
