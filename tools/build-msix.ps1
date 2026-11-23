<#
.SYNOPSIS
  Packs the release folder (from tools\build-release.ps1) into an MSIX for the Microsoft Store.

.DESCRIPTION
  The package is not signed: the Store signs it after certification. For a local test of the package
  layout, enable Developer Mode yourself and register the layout folder (see docs\wydanie.md).
  makeappx.exe comes from the Microsoft.Windows.SDK.BuildTools NuGet package; restore it with
  `dotnet restore tools\sdk-tools` if it is not found.

.PARAMETER IdentityName
  Package/Identity/Name from Partner Center → Product identity. The default is a local placeholder.

.PARAMETER Publisher
  Package/Identity/Publisher from Partner Center (CN=…). The default is a local placeholder.
#>
param(
  [string]$IdentityName = 'Biblioteczka.Local',
  [string]$Publisher = 'CN=Biblioteczka Local',
  [string]$PublisherDisplayName = 'Biblioteczka',
  [string]$Version,
  [string]$MakeAppx
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Version) { $Version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3, got '$Version'." }
$release = Join-Path $root 'dist\release\Biblioteczka'
if (-not (Test-Path (Join-Path $release 'Biblioteczka.exe'))) { throw 'Run tools\build-release.ps1 first.' }

if (-not $MakeAppx) {
  $MakeAppx = Get-ChildItem (Join-Path $env:USERPROFILE '.nuget\packages\microsoft.windows.sdk.buildtools') -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $MakeAppx -or -not (Test-Path $MakeAppx)) { throw 'makeappx.exe not found. Run: dotnet restore tools\sdk-tools' }

$layout = Join-Path $root 'dist\msix\layout'
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
Copy-Item -Recurse $release $layout
Copy-Item -Recurse (Join-Path $root 'host\package\Assets') (Join-Path $layout 'Assets')

$manifest = Get-Content (Join-Path $root 'host\package\AppxManifest.template.xml') -Raw -Encoding UTF8
$values = @{ IdentityName = $IdentityName; Publisher = $Publisher; PublisherDisplayName = $PublisherDisplayName; Version = "$Version.0" }
foreach ($key in $values.Keys) { $manifest = $manifest.Replace("{{$key}}", [Security.SecurityElement]::Escape($values[$key])) }
if ($manifest -match '\{\{') { throw 'Unfilled manifest value.' }
[IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest, (New-Object Text.UTF8Encoding $false))

$msix = Join-Path $root "dist\Biblioteczka-$Version-x64.msix"
& $MakeAppx pack /d $layout /p $msix /o /h SHA256 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { throw 'makeappx failed.' }
$size = [math]::Round((Get-Item $msix).Length / 1MB, 1)
Write-Host "Done: $msix ($size MB, identity $IdentityName, not signed)"
