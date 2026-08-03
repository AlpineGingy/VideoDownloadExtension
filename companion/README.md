# Media Finder Companion

The companion is a self-contained .NET 8 native host that lets the Chrome extension run yt-dlp without opening a terminal. It communicates only through Chrome Native Messaging and accepts structured, allow-listed download options rather than raw command strings.

Cookie handling, diagnostic logs, detailed live progress, and filename styles use protocol version 6. On Windows, **Current Chrome session** sends only site-matching cookies to the companion, which writes a restricted temporary Netscape cookie file for yt-dlp and deletes it after the job. On macOS and Linux, the companion uses yt-dlp's built-in Chrome cookie reader.

Completed files are saved to the destination chosen in the extension: `Downloads/Media Finder`, `Downloads`, `Videos`, or `Desktop`.

## Supported platforms

- `win-x64`
- `win-arm64`
- `osx-x64`
- `osx-arm64`
- `linux-x64`
- `linux-arm64`

## Fresh installation

Download the installer matching the computer from the latest GitHub Release. The native installers contain the self-contained companion, so .NET is not required. Installation needs an internet connection to download current yt-dlp, Deno, and FFmpeg builds.

### Windows

1. Download `media-finder-companion-win-x64-setup.exe` for most PCs or `media-finder-companion-win-arm64-setup.exe` for Windows on ARM.
2. Double-click the Setup file and follow the prompts.
3. Restart Chrome.
4. Open the extension setup page and choose **Verify companion**.

The installer copies files to `%LOCALAPPDATA%\MediaFinder\Companion`, registers the host under `HKCU`, and downloads yt-dlp, Deno, and a portable FFmpeg build beside the host. Remove it later from **Settings > Apps > Installed apps > Media Finder Companion**. An unsigned development build can trigger Windows SmartScreen; public releases should be Authenticode-signed.

### macOS

1. Download `media-finder-companion-osx-arm64.pkg` for Apple Silicon or `media-finder-companion-osx-x64.pkg` for an Intel Mac.
2. Double-click the PKG and follow the macOS Installer prompts.
3. Restart Chrome and verify the connection.

The PKG uses `/Library/Application Support/Media Finder/Companion` and Chrome's system Native Messaging host directories. Unsigned development builds may trigger Gatekeeper; public releases should be signed and notarized using an Apple Developer certificate.

To uninstall a development PKG, run:

```bash
sudo "/Library/Application Support/Media Finder/Companion/uninstall-media-finder.sh"
```

### Linux

1. Download the x64 or ARM64 `.deb` for Ubuntu/Debian, or the matching `.rpm` for Fedora, RHEL, or openSUSE.
2. Double-click the package and approve it in the distribution's software installer.
3. Restart Chrome and verify the connection.

The package uses `/opt/media-finder` and Chrome's system Native Messaging host directories. If the desktop does not associate packages with a software installer, use `sudo apt install ./media-finder-companion-linux-x64.deb` or `sudo dnf install ./media-finder-companion-linux-x64.rpm`. Uninstall with the operating system's software manager or `sudo apt remove media-finder-companion` / `sudo dnf remove media-finder-companion`.

## Fallback archive installers

Every release still includes the previous platform ZIP. Extract it and run `install-windows.cmd` on Windows or `sh install-unix.sh` in a terminal on macOS/Linux. These fallback scripts install only for the current user and are useful when native package installation is restricted.

## FFmpeg

The installer automatically refreshes yt-dlp, installs the official Deno runtime, and downloads a private FFmpeg binary beside the companion. Windows uses yt-dlp's official unpackaged `yt-dlp_win.zip` distribution to avoid the single-file launcher's extraction/startup delay. This avoids WinGet, Homebrew, `sudo`, and system PATH changes. yt-dlp receives the companion directory through `--ffmpeg-location`, so merging separate video/audio streams, audio conversion, and embedding operations work immediately after installation.

Windows FFmpeg packages come from the BtbN FFmpeg Builds project. macOS and Linux binaries come from the ffmpeg-static project. Both are prebuilt distributions of FFmpeg, whose official download page links users to platform builds because the FFmpeg project itself publishes source code rather than ready-to-run executables.

Each download also creates a timestamped diagnostic file under the current user's local application-data `MediaFinder/Logs` directory. The newest 20 logs are retained. Download cards can copy the newest 180 KB even after Chrome reconnects to the companion.

Install FFmpeg through the operating system's trusted package manager, then restart Chrome. The setup page reports whether the companion can find it.

## Build locally

The repository pins .NET SDK 8.0.418 through `global.json` and has no external NuGet package dependencies.

```powershell
dotnet restore companion/MediaFinder.Companion/MediaFinder.Companion.csproj --configfile companion/NuGet.Config
dotnet build companion/MediaFinder.Companion/MediaFinder.Companion.csproj -c Release --no-restore
dotnet run --project companion/MediaFinder.Companion.SmokeTests/MediaFinder.Companion.SmokeTests.csproj -c Release
```

To create every self-contained fallback ZIP on a machine that can restore all runtime packs:

```powershell
companion/scripts/package-release.ps1
```

The GitHub release workflow creates the native installers on their matching operating systems: Inno Setup builds Windows EXEs, `pkgbuild` builds macOS PKGs, and `dpkg-deb`/`rpmbuild` build Linux packages. This avoids pretending that a Windows machine can produce and validate every native installer format.

Signing credentials are intentionally not stored in this repository. Before broad public distribution, add an Authenticode certificate for Windows, an Apple Developer Installer certificate plus notarization for macOS, and repository/package signing appropriate to the supported Linux distributions.

With Inno Setup 6 installed, create both Windows Setup executables locally with:

```powershell
companion/scripts/package-windows-native.ps1
```

## Configure release downloads

`MEDIA_FINDER_RELEASE_BASE_URL` in `extension/setup-config.js` points at this repository's latest GitHub Release:

```javascript
globalThis.MEDIA_FINDER_RELEASE_BASE_URL =
  "https://github.com/AlpineGingy/VideoDownloadExtension/releases/latest/download";
```

Pushing a tag such as `v0.9.1` triggers `.github/workflows/release-companion.yml`, which builds all native installers plus the six fallback ZIPs and attaches them to a GitHub Release.

## Security boundaries

- Only HTTP and HTTPS URLs are accepted.
- Job identifiers and every option are allow-listed.
- Arguments are passed through `ProcessStartInfo.ArgumentList`; no command shell is used.
- The native host manifest authorizes only extension ID `nagidlmhdnnodcicinldienofcjnpeoi`.
- Cookies remain on the local machine and are read by yt-dlp only when the user opts into a browser-cookie option.
- DRM bypass is not implemented.
