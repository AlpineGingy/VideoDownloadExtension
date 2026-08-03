$ErrorActionPreference = "Stop"
$projectPath = Join-Path $PSScriptRoot "..\MediaFinder.Companion\MediaFinder.Companion.csproj"
$artifactRoot = Join-Path $PSScriptRoot "..\artifacts"
$runtimeIdentifiers = @("win-x64", "win-arm64", "osx-x64", "osx-arm64", "linux-x64", "linux-arm64")
$resolvedArtifactRoot = [IO.Path]::GetFullPath($artifactRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)

# Publishes a self-contained single-file host and creates one simple archive per platform.
foreach ($runtimeIdentifier in $runtimeIdentifiers) {
    $packageName = "media-finder-companion-$runtimeIdentifier"
    $publishDirectory = Join-Path $artifactRoot "$packageName\publish"
    $packageDirectory = Join-Path $artifactRoot $packageName
    $resolvedPackageDirectory = [IO.Path]::GetFullPath($packageDirectory)
    if (-not $resolvedPackageDirectory.StartsWith("$resolvedArtifactRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to package outside the companion artifacts directory."
    }
    dotnet publish $projectPath `
        -c Release `
        -r $runtimeIdentifier `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -o $publishDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed for $runtimeIdentifier."
    }

    if ($runtimeIdentifier.StartsWith("win-")) {
        Copy-Item "$publishDirectory\media-finder-companion.exe" $packageDirectory
        Copy-Item "$PSScriptRoot\install-windows.cmd" $packageDirectory
        Copy-Item "$PSScriptRoot\install-windows.ps1" $packageDirectory
        Copy-Item "$PSScriptRoot\uninstall-windows.ps1" $packageDirectory
    }
    else {
        Copy-Item "$publishDirectory\media-finder-companion" $packageDirectory
        Copy-Item "$PSScriptRoot\install-unix.sh" $packageDirectory
        Copy-Item "$PSScriptRoot\uninstall-unix.sh" $packageDirectory
    }

    Remove-Item -LiteralPath $publishDirectory -Recurse -Force
    Compress-Archive -Path "$packageDirectory\*" -DestinationPath "$artifactRoot\$packageName.zip" -Force
    Remove-Item -LiteralPath $packageDirectory -Recurse -Force
}
