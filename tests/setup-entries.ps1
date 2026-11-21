param([string]$ExePath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression
$taskAssembly=[Reflection.Assembly]::LoadFile([IO.Path]::GetFullPath($ExePath));$taskStream=$taskAssembly.GetManifestResourceStream('payload.zip')
$taskZip=New-Object IO.Compression.ZipArchive($taskStream,[IO.Compression.ZipArchiveMode]::Read)
try { @($taskZip.Entries | ForEach-Object FullName) | ConvertTo-Json -Compress } finally { $taskZip.Dispose();$taskStream.Dispose() }
