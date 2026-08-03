param(
    [switch]$SkipYtDlpDownload,
    [switch]$SkipDenoDownload,
    [switch]$SkipFfmpegDownload,
    [switch]$SkipFfmpegInstall
)

$ErrorActionPreference = "Stop"

# Installs the self-contained host into the current user's local application data.
$sourceExecutable = Join-Path $PSScriptRoot "media-finder-companion.exe"
if (-not (Test-Path -LiteralPath $sourceExecutable)) {
    throw "media-finder-companion.exe must be in the same folder as this installer."
}

$installDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "MediaFinder\Companion"
$installedExecutable = Join-Path $installDirectory "media-finder-companion.exe"
$resolvedInstallDirectory = [IO.Path]::GetFullPath($installDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)

# Refuses to replace executables that are still running so an upgrade cannot silently retain old files.
$runningMediaFinderProcesses = Get-Process -Name "media-finder-companion", "yt-dlp" -ErrorAction SilentlyContinue |
    Where-Object {
        try {
            $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith(
                "$resolvedInstallDirectory$([IO.Path]::DirectorySeparatorChar)",
                [StringComparison]::OrdinalIgnoreCase)
        }
        catch {
            $false
        }
    }
if ($runningMediaFinderProcesses) {
    $processSummary = ($runningMediaFinderProcesses | ForEach-Object { "$($_.ProcessName) (PID $($_.Id))" }) -join ", "
    throw "Media Finder is still running: $processSummary. Cancel active downloads, fully exit Chrome, then run this installer again."
}

New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
Copy-Item -LiteralPath $sourceExecutable -Destination $installedExecutable -Force

# Downloads the official unpackaged Windows build to avoid slow or frozen single-file startup.
$ytDlpPath = Join-Path $installDirectory "yt-dlp.exe"
if (-not $SkipYtDlpDownload) {
    $ytDlpArchivePath = Join-Path $installDirectory "yt-dlp-win-download.zip"
    $ytDlpExtractDirectory = Join-Path $installDirectory "yt-dlp-win-download"
    $ytDlpInternalDirectory = Join-Path $installDirectory "_internal"
    Write-Host "Downloading the official unpackaged yt-dlp Windows build..."
    try {
        Invoke-WebRequest `
            -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win.zip" `
            -OutFile $ytDlpArchivePath
        Expand-Archive -LiteralPath $ytDlpArchivePath -DestinationPath $ytDlpExtractDirectory -Force
        $downloadedYtDlp = Join-Path $ytDlpExtractDirectory "yt-dlp.exe"
        $downloadedInternalDirectory = Join-Path $ytDlpExtractDirectory "_internal"
        if (-not (Test-Path -LiteralPath $downloadedYtDlp) -or
            -not (Test-Path -LiteralPath $downloadedInternalDirectory)) {
            throw "The downloaded yt-dlp archive did not contain the expected unpackaged Windows files."
        }
        Copy-Item -LiteralPath $downloadedYtDlp -Destination $ytDlpPath -Force
        Remove-Item -LiteralPath $ytDlpInternalDirectory -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $downloadedInternalDirectory -Destination $ytDlpInternalDirectory -Recurse -Force
    }
    finally {
        Remove-Item -LiteralPath $ytDlpArchivePath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $ytDlpExtractDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Downloads the recommended Deno runtime beside yt-dlp for current YouTube challenge support.
$denoPath = Join-Path $installDirectory "deno.exe"
if (-not $SkipDenoDownload) {
    $denoArchitecture = if (
        [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq
        [Runtime.InteropServices.Architecture]::Arm64
    ) { "aarch64" } else { "x86_64" }
    $denoArchivePath = Join-Path $installDirectory "deno-download.zip"
    Write-Host "Downloading the official Deno runtime for YouTube support..."
    Invoke-WebRequest `
        -Uri "https://github.com/denoland/deno/releases/latest/download/deno-$denoArchitecture-pc-windows-msvc.zip" `
        -OutFile $denoArchivePath
    Expand-Archive -LiteralPath $denoArchivePath -DestinationPath $installDirectory -Force
    Remove-Item -LiteralPath $denoArchivePath -Force
}

# Downloads a private FFmpeg build so merging works without WinGet or a system PATH change.
$ffmpegPath = Join-Path $installDirectory "ffmpeg.exe"
if (-not $SkipFfmpegDownload -and -not $SkipFfmpegInstall) {
    $ffmpegArchitecture = if (
        [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq
        [Runtime.InteropServices.Architecture]::Arm64
    ) { "winarm64" } else { "win64" }
    $ffmpegArchivePath = Join-Path $installDirectory "ffmpeg-download.zip"
    $ffmpegExtractDirectory = Join-Path $installDirectory "ffmpeg-download"
    Write-Host "Downloading a portable FFmpeg build for audio/video merging..."
    try {
        Invoke-WebRequest `
            -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-$ffmpegArchitecture-gpl.zip" `
            -OutFile $ffmpegArchivePath
        Expand-Archive -LiteralPath $ffmpegArchivePath -DestinationPath $ffmpegExtractDirectory -Force
        $downloadedFfmpeg = Get-ChildItem -LiteralPath $ffmpegExtractDirectory -Recurse -Filter "ffmpeg.exe" |
            Select-Object -First 1
        $downloadedFfprobe = Get-ChildItem -LiteralPath $ffmpegExtractDirectory -Recurse -Filter "ffprobe.exe" |
            Select-Object -First 1
        if (-not $downloadedFfmpeg) {
            throw "The downloaded FFmpeg archive did not contain ffmpeg.exe."
        }
        Copy-Item -LiteralPath $downloadedFfmpeg.FullName -Destination $ffmpegPath -Force
        if ($downloadedFfprobe) {
            Copy-Item -LiteralPath $downloadedFfprobe.FullName -Destination (Join-Path $installDirectory "ffprobe.exe") -Force
        }
    }
    catch {
        if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
            Write-Warning "The private FFmpeg download failed, so Media Finder will use the existing system FFmpeg. $($_.Exception.Message)"
        }
        else {
            throw
        }
    }
    finally {
        Remove-Item -LiteralPath $ffmpegArchivePath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $ffmpegExtractDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Registers the host for the stable Media Finder extension ID under the current user.
$hostManifestDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Google\Chrome\User Data\NativeMessagingHosts"
$hostManifestPath = Join-Path $hostManifestDirectory "com.media_finder.companion.json"
$hostManifest = @{
    name = "com.media_finder.companion"
    description = "Media Finder local yt-dlp companion"
    path = $installedExecutable
    type = "stdio"
    allowed_origins = @("chrome-extension://nagidlmhdnnodcicinldienofcjnpeoi/")
} | ConvertTo-Json -Depth 3
New-Item -ItemType Directory -Force -Path $hostManifestDirectory | Out-Null
[IO.File]::WriteAllText($hostManifestPath, $hostManifest, [Text.UTF8Encoding]::new($false))

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.media_finder.companion"
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifestPath

Write-Host ""
Write-Host "Media Finder companion installed successfully."
Write-Host "Unpacked yt-dlp, Deno, and FFmpeg are ready for supported downloads."
Write-Host "Downloads will be saved under your Downloads\Media Finder folder."
if (-not (Test-Path -LiteralPath $ffmpegPath) -and -not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "FFmpeg was not found. Run this installer again without the FFmpeg skip option."
}
Write-Host "Restart Chrome, then open Media Finder to verify the connection."
