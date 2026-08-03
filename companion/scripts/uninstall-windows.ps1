$ErrorActionPreference = "Stop"

# Removes only the per-user files and registry entry created by the installer.
$installDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "MediaFinder\Companion"
$hostManifestPath = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Google\Chrome\User Data\NativeMessagingHosts\com.media_finder.companion.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.media_finder.companion"

if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force
}
if (Test-Path -LiteralPath $hostManifestPath) {
    Remove-Item -LiteralPath $hostManifestPath -Force
}
if (Test-Path -LiteralPath $installDirectory) {
    Remove-Item -LiteralPath $installDirectory -Recurse -Force
}

Write-Host "Media Finder companion removed. Restart Chrome to finish uninstalling."
