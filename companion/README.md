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

## Install from a release package

### Windows

1. Extract the correct Windows zip.
2. Double-click `install-windows.cmd`.
3. Restart Chrome.
4. Open the extension setup page and choose **Verify companion**.

The installer copies files to `%LOCALAPPDATA%\MediaFinder\Companion`, registers the host under `HKCU`, and downloads yt-dlp, Deno, and a portable FFmpeg build beside the host.

### macOS

1. Extract the package for Intel or Apple Silicon.
2. Open Terminal in the extracted directory.
3. Run `sh install-unix.sh`.
4. Restart Chrome and verify the connection.

The installer uses `~/Library/Application Support/Media Finder/Companion` and Chrome's per-user Native Messaging host directory. Unsigned development builds may trigger Gatekeeper; a public one-click distribution should be signed and notarized using an Apple Developer certificate.

### Linux

1. Extract the x64 or ARM64 package.
2. Open a terminal in the extracted directory.
3. Run `sh install-unix.sh`.
4. Restart Chrome and verify the connection.

The installer uses `~/.local/share/media-finder/companion` and the current user's Google Chrome Native Messaging host directory.

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

To create every self-contained release zip on a machine that can restore all runtime packs:

```powershell
companion/scripts/package-release.ps1
```

## Configure release downloads

After adding a GitHub remote, set `MEDIA_FINDER_RELEASE_BASE_URL` in `setup-config.js`. For a repository at `https://github.com/example/media-finder`, use:

```javascript
globalThis.MEDIA_FINDER_RELEASE_BASE_URL =
  "https://github.com/example/media-finder/releases/latest/download";
```

Pushing a tag such as `v0.8.3` triggers `.github/workflows/release-companion.yml`, which builds all six self-contained packages and attaches them to a GitHub Release.

## Security boundaries

- Only HTTP and HTTPS URLs are accepted.
- Job identifiers and every option are allow-listed.
- Arguments are passed through `ProcessStartInfo.ArgumentList`; no command shell is used.
- The native host manifest authorizes only extension ID `nagidlmhdnnodcicinldienofcjnpeoi`.
- Cookies remain on the local machine and are read by yt-dlp only when the user opts into a browser-cookie option.
- DRM bypass is not implemented.
