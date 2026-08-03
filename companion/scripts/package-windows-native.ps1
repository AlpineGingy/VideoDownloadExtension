param(
    [string]$CompilerPath = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$projectPath = Join-Path $repositoryRoot "companion\MediaFinder.Companion\MediaFinder.Companion.csproj"
$configPath = Join-Path $repositoryRoot "companion\NuGet.Config"
$installerPath = Join-Path $repositoryRoot "companion\installer\windows\MediaFinder.iss"
$artifactRoot = Join-Path $repositoryRoot "companion\artifacts"
$manifestPath = Join-Path $repositoryRoot "extension\manifest.json"
$version = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version

# Locates an explicit compiler, a repository-local compiler, or an installed ISCC command.
if (-not $CompilerPath) {
    $localCompiler = Join-Path $repositoryRoot ".tools\Inno Setup 6\ISCC.exe"
    if (Test-Path -LiteralPath $localCompiler) {
        $CompilerPath = $localCompiler
    }
    else {
        $compilerCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if ($compilerCommand) {
            $CompilerPath = $compilerCommand.Source
        }
    }
}
if (-not $CompilerPath -or -not (Test-Path -LiteralPath $CompilerPath)) {
    throw "Inno Setup 6 is required. Install it, or pass -CompilerPath with the path to ISCC.exe."
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "media-finder-windows-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null

try {
    # Publishes both Windows architectures and wraps each one in a double-clickable Setup executable.
    foreach ($runtime in @("win-x64", "win-arm64")) {
        dotnet restore $projectPath -r $runtime --configfile $configPath
        if ($LASTEXITCODE -ne 0) {
            throw "dotnet restore failed for $runtime."
        }
        $packageRoot = Join-Path $temporaryRoot $runtime
        dotnet publish $projectPath `
            -c Release `
            -r $runtime `
            --self-contained true `
            --no-restore `
            -p:PublishSingleFile=true `
            -p:IncludeNativeLibrariesForSelfExtract=true `
            -o $packageRoot
        if ($LASTEXITCODE -ne 0) {
            throw "dotnet publish failed for $runtime."
        }
        Copy-Item (Join-Path $repositoryRoot "companion\installer\install-windows.ps1") $packageRoot
        Copy-Item (Join-Path $repositoryRoot "companion\installer\uninstall-windows.ps1") $packageRoot
        & $CompilerPath `
            "/DPackageRoot=$packageRoot" `
            "/DRuntime=$runtime" `
            "/DAppVersion=$version" `
            "/DOutputDirectory=$artifactRoot" `
            $installerPath
        if ($LASTEXITCODE -ne 0) {
            throw "Inno Setup failed for $runtime."
        }
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

Write-Host "Windows Setup executables created under companion\artifacts."
