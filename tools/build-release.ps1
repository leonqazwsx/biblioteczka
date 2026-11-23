<#
.SYNOPSIS
  Builds the portable release: dist\release\Biblioteczka\ and dist\Biblioteczka-<version>-win-x64.zip.

.DESCRIPTION
  The host is published self-contained (no .NET runtime needed on the user's PC). The folder also gets the
  server (src, public, package.json), the official Node.js runtime and the license files.

.PARAMETER NodeRuntimeDir
  Folder with an official Windows x64 node.exe (version 24 or newer) and its LICENSE file.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-release.ps1 -NodeRuntimeDir C:\node-v24
#>
param(
  [Parameter(Mandatory = $true)][string]$NodeRuntimeDir,
  [string]$Version
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $package.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3, got '$Version'." }

$node = Join-Path $NodeRuntimeDir 'node.exe'
$nodeLicense = Join-Path $NodeRuntimeDir 'LICENSE'
if (-not (Test-Path $node) -or -not (Test-Path $nodeLicense)) { throw "NodeRuntimeDir must contain node.exe and LICENSE." }
$nodeVersion = (& $node --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw "Node.js 24 or newer required, found $nodeVersion." }
$signature = Get-AuthenticodeSignature $node
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') {
  throw "node.exe is not an official, validly signed Node.js build ($($signature.Status))."
}

$dist = Join-Path $root 'dist'
$out = Join-Path $dist 'release\Biblioteczka'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host "Publishing host $Version..."
& dotnet publish (Join-Path $root 'host\Biblioteczka.Host\Biblioteczka.Host.csproj') -c Release -r win-x64 --self-contained true `
  -p:Version=$Version -p:DebugType=none -o $out --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }

Write-Host 'Copying the server, pages and licenses...'
foreach ($dir in 'src', 'public') { Copy-Item -Recurse (Join-Path $root $dir) (Join-Path $out $dir) }
foreach ($file in 'package.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'PRIVACY.md', 'README.md', 'README.pl.md') {
  Copy-Item (Join-Path $root $file) (Join-Path $out $file)
}
$runtime = New-Item -ItemType Directory -Force -Path (Join-Path $out 'runtime')
Copy-Item $node, $nodeLicense $runtime
Set-Content -Path (Join-Path $runtime 'VERSION.txt') -Value $nodeVersion -Encoding ascii

# The release must not run in development mode or carry developer files.
foreach ($unwanted in '.git', 'node_modules', 'tests', 'output', 'data') {
  if (Test-Path (Join-Path $out $unwanted)) { throw "Unexpected '$unwanted' in the release folder." }
}

$zip = Join-Path $dist "Biblioteczka-$Version-win-x64.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $out -DestinationPath $zip -CompressionLevel Optimal
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Done: $zip ($size MB), Node $nodeVersion"
