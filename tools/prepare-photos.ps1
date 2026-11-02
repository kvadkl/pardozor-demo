param(
    [int]$MaxSide = 1600,
    [long]$JpegQuality = 82
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$photosDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets\photos'
$thumbsDir = Join-Path $photosDir 'thumbs'
New-Item -ItemType Directory -Path $thumbsDir -Force | Out-Null
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object MimeType -eq 'image/jpeg' |
    Select-Object -First 1
$encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
$encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
    [System.Drawing.Imaging.Encoder]::Quality, $JpegQuality)

try {
    Get-ChildItem -LiteralPath $photosDir -Filter '*.jpg' -File | ForEach-Object {
        $original = [System.Drawing.Image]::FromFile($_.FullName)
        try {
            $orientation = $original.PropertyItems |
                Where-Object Id -eq 274 |
                Select-Object -First 1
            if ($orientation) {
                switch ([BitConverter]::ToUInt16($orientation.Value, 0)) {
                    3 { $original.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
                    6 { $original.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
                    8 { $original.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
                }
            }

            $scale = [Math]::Min(1.0, $MaxSide / [double][Math]::Max($original.Width, $original.Height))
            $width = [Math]::Max(1, [int][Math]::Round($original.Width * $scale))
            $height = [Math]::Max(1, [int][Math]::Round($original.Height * $scale))
            $bitmap = [System.Drawing.Bitmap]::new($width, $height)
            try {
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                try {
                    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $graphics.DrawImage($original, 0, 0, $width, $height)
                } finally {
                    $graphics.Dispose()
                }
                $bitmap.Save((Join-Path $thumbsDir $_.Name), $jpegCodec, $encoderParams)
                Write-Output "$($_.Name): ${width}x${height}"
            } finally {
                $bitmap.Dispose()
            }
        } finally {
            $original.Dispose()
        }
    }
} finally {
    $encoderParams.Dispose()
}
