# Generates host/Biblioteczka.Host/Assets/biblioteczka.ico (placeholder app icon: three book spines).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File host/tools/make-icon.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '..\Biblioteczka.Host\Assets\biblioteczka.ico'
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null

function New-IconPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 256.0
  $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 48 * $s; $w = 240 * $s; $o = 8 * $s
  $bg.AddArc($o, $o, $r, $r, 180, 90); $bg.AddArc($o + $w - $r, $o, $r, $r, 270, 90)
  $bg.AddArc($o + $w - $r, $o + $w - $r, $r, $r, 0, 90); $bg.AddArc($o, $o + $w - $r, $r, $r, 90, 90)
  $bg.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 92, 58, 36))), $bg)
  # Shelf
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 196, 150, 104))), 36 * $s, 196 * $s, 184 * $s, 18 * $s)
  $books = @(
    @{ x = 52; w = 42; h = 136; c = @(255, 120, 150, 112) },
    @{ x = 100; w = 36; h = 150; c = @(255, 236, 222, 196) },
    @{ x = 142; w = 44; h = 124; c = @(255, 184, 92, 64) }
  )
  foreach ($b in $books) {
    $c = $b.c
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($c[0], $c[1], $c[2], $c[3]))
    $g.FillRectangle($brush, $b.x * $s, (196 - $b.h) * $s, $b.w * $s, $b.h * $s)
    $band = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 0, 0, 0))
    $g.FillRectangle($band, $b.x * $s, (196 - $b.h + 18) * $s, $b.w * $s, 8 * $s)
  }
  # Leaning fourth book
  $g.TranslateTransform(204 * $s, 196 * $s); $g.RotateTransform(-14)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 84, 110, 150))), -30 * $s, -112 * $s, 30 * $s, 112 * $s)
  $g.ResetTransform()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return ,$ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 256
$images = foreach ($size in $sizes) { ,(New-IconPng $size) }
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $writer.Write([byte]$dim); $writer.Write([byte]$dim); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($img in $images) { $writer.Write($img) }
$writer.Flush()
[System.IO.File]::WriteAllBytes($out, $stream.ToArray())
"wrote $out"
