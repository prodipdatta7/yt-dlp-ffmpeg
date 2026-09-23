# Convert the existing MediaForge Store artwork into the assets electron-builder consumes.
# Run from any directory; generated PNGs are committed so CI needs no image tools.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root 'build/appx'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'build/store-logo.png'))
$sizes = @{
    'StoreLogo.png' = @(50, 50)
    'Square44x44Logo.png' = @(44, 44)
    'Square150x150Logo.png' = @(150, 150)
    'Wide310x150Logo.png' = @(310, 150)
    'SmallTile.png' = @(71, 71)
    'LargeTile.png' = @(310, 310)
}
try {
    foreach ($name in $sizes.Keys) {
        $width, $height = $sizes[$name]
        $bitmap = [System.Drawing.Bitmap]::new($width, $height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::FromArgb(11, 18, 32))
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $side = [Math]::Min($width, $height)
            $graphics.DrawImage($source, [int](($width - $side) / 2), [int](($height - $side) / 2), $side, $side)
            $bitmap.Save((Join-Path $destination $name), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $source.Dispose()
}
Write-Host 'MediaForge Store tile assets generated in build/appx.'
