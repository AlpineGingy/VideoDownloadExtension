# Media Finder Chrome Extension

Media Finder is a small Manifest V3 Chrome extension that discovers audio and video associated with the current page.

## Repository layout

- `extension/` is the complete unpacked Chrome extension. Select this folder in `chrome://extensions`.
- `companion/` contains the cross-platform .NET native host and its tests.
- `companion/installer/` contains native Windows, macOS, and Linux installer definitions and fallback scripts.
- `companion/artifacts/` contains locally generated release outputs and fallback ZIPs.

It currently finds:

- Direct URLs from `<video>`, `<audio>`, and their `<source>` elements.
- Previously loaded audio/video resources visible through the page Performance API.
- Media requests and response content types visible through Chrome's `webRequest` API.
- HLS (`.m3u8`) and DASH (`.mpd`) stream manifests.
- Common audio types including MP3, M4A, AAC, FLAC, OGG/Opus, WAV, and audio WebM.

The popup has two main views: **Find media** and **Downloads**. Find media keeps **Page** and **Network** results separate. Network results can be searched by URL or content type and filtered by media type or whether they came from a live request versus the page's already-loaded performance history.

## What each result means

- **Direct**: a normal media file such as MP4 or WebM. The popup can send this URL to Chrome's download manager.
- **Audio**: a directly downloadable audio resource such as MP3, M4A, or audio WebM.
- **Manifest**: an HLS or DASH playlist. It points to many media segments, so the MVP lets you copy the URL for use in a compatible tool; it does not assemble segments yet.
- **Blob**: a temporary URL owned by the page. It is not a reusable network address. Playing the video may reveal the underlying requests.
- **Unknown**: Chrome identified the request as media, but its URL and response headers did not reveal a supported format.

## Download choices

- **Download** sends the selected result to the installed local companion using remembered defaults. The companion runs yt-dlp without opening a terminal.
- **Save as-is** uses Chrome's download manager for direct video or audio files without conversion and tracks that job in the Downloads view.
- Companion downloads can use the readable browser page title, yt-dlp's media title, title plus resolution, or the original title-plus-source-ID naming style.
- Concurrent companion jobs use isolated temporary fragment directories, and duplicate clicks for the same media URL are rejected while that URL is active.
- **Download from this page** sends the webpage URL to the companion. This is useful for sites that expose separate or temporary audio/video requests.
- **Options** lets one download change quality, cookies, container, speed, subtitles, metadata, thumbnail embedding, and destination.
- **Copy command** remains available as a fallback and supports PowerShell or a macOS/Linux terminal.
- **Copy URL** copies the discovered address for use in another tool.

HTTP/HTTPS result URLs are clickable and open in a new tab for optional confirmation. Opening the URL is not required before downloading through the companion.

Selecting **Settings** or a result's **Options** button opens the remembered download preferences:

- Browser cookies: none, Chrome, Edge, or Firefox.
- Quality: best available, up to 1080p, up to 720p, or audio-only MP3.
- Merge container: automatic, MP4, or MKV.
- Concurrent fragments: compatible (1), balanced (4), or faster/recommended (8) for segmented streams.
- Destination: `Downloads/Media Finder`, `Downloads`, `Videos`, or `Desktop`.
- Optional embedded metadata, thumbnail, and English subtitles.

The full Settings view also includes **Download companion**, which always opens the platform-aware setup page. This remains available after the automatic missing-companion prompt has been dismissed or is no longer visible.

The 760-by-600 popup gives discovery and download cards more room. The Downloads view stores up to 50 recent companion or direct Chrome jobs in extension storage. Multiple downloads can run at once, each job has a horizontal percentage bar, yt-dlp progress is pushed to an open popup before persistence, and frequent storage writes are coalesced to prevent an update backlog. Direct Chrome downloads are polled while the popup is visible because Chrome does not emit events for byte-only changes. Reopening the popup restores title, thumbnail, duration, status, progress, and destination details.

Every companion download creates a timestamped diagnostic log with elapsed timing, lifecycle phases, the sanitized yt-dlp command, stdout/stderr, exit code, completion, cancellation, and errors. Use **Copy log** on a download card to copy the newest portion. The companion retains the newest 20 logs in the current user's local application-data `MediaFinder/Logs` folder. Cookie values are never written, and signed query values are removed from the logged command; yt-dlp's own raw output can still contain media URLs, so review a copied log before sharing it.

Cookie access is disabled by default. Cookie handling is hybrid: macOS and Linux use yt-dlp's built-in `--cookies-from-browser chrome`, while Windows requests the optional Chrome `cookies` permission and passes only cookies matching the current page and media URL through Native Messaging. The companion deletes its temporary Netscape cookie file after the Windows job. Edge and Firefox continue to use yt-dlp's built-in browser-cookie reader. Chrome session cookies cannot be included in a copied terminal command on Windows, so that button is disabled only there.

On Windows, Chrome asks for the optional `cookies` permission only when the user starts a download with Chrome cookies selected. The companion protocol is versioned; reinstall the current companion package when the popup reports that an older host is connected.

Download startup uses single-video mode, a 20-second socket timeout, bounded extractor/download retries, and progress reporting every 0.2 seconds. Transfer updates include percentage, speed, ETA, and downloaded/total bytes. When yt-dlp produces no output for two seconds, the companion sends an honest heartbeat without inventing percentage progress. Extraction and FFmpeg work are labeled with stages such as checking formats, merging audio/video, converting audio, and embedding metadata. The 1080p and 720p choices are preferences: when a generic URL has no height metadata, the companion falls back to the best available format instead of failing with “Requested format is not available.”

Current yt-dlp releases require an external JavaScript runtime for full YouTube support. The companion installer now refreshes yt-dlp on every install and downloads the official Deno runtime beside it. YouTube jobs fail immediately with setup guidance when Deno is missing rather than remaining in Preparing.

FFmpeg may be required for merging separate audio/video formats, embedding content, and audio conversion. The installer downloads a private FFmpeg binary beside the companion on Windows, macOS, and Linux and passes its location directly to yt-dlp. No global FFmpeg install or package manager is required. More concurrent fragments can speed up HLS/DASH downloads, but a server may throttle or reject excessive parallel requests.

On Windows, the installer uses yt-dlp's official unpackaged release and refuses to upgrade while a Media Finder companion or yt-dlp process is active. Cancel downloads and fully exit Chrome before reinstalling.

The extension does not bypass DRM, decrypt protected video, or send browsing data to an external service. Only download media you own or are authorized to save.

Each result shows a format badge. The format comes from the URL extension when present and otherwise from the response MIME type or a MIME hint embedded in the URL. This is useful for extensionless CDN requests such as separate `audio/webm` and `video/mp4` tracks.

The **Download from this page** button gives the current webpage URL to yt-dlp. This is more useful than one temporary network-track URL on sites that expose separate audio/video formats, because yt-dlp can choose and merge compatible tracks when the site is supported.

Site support can change independently of this extension. Signed URLs may expire, authenticated formats may require cookies, and some sites may require additional yt-dlp configuration. The extension does not bypass DRM or access controls.

## Load the extension locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `extension` folder inside this project.
5. Open a page containing a video, play it, and select the Media Finder toolbar icon.

Chrome blocks extensions from scanning internal pages such as `chrome://extensions` and the Chrome Web Store.

## Install the local companion

The extension shows one focused setup prompt when the native host is unavailable. Release installers are self-contained; users do not need .NET installed.

For a fresh installation:

1. Install the unpacked Chrome extension from the `extension/` folder, or install its published Chrome package when one is available.
2. Open Media Finder and select **Download companion** on the setup page.
3. Double-click the downloaded installer and follow the operating-system prompts.
4. Restart Chrome and select **Verify companion**.

The setup page chooses `Setup.exe` for Windows, `.pkg` for macOS, and `.deb` for Ubuntu/Debian. Linux users on Fedora, RHEL, or openSUSE can select the RPM link instead. Packages are available for Windows x64/ARM64, macOS Intel/Apple Silicon, and Linux x64/ARM64.

The installer registers the Chrome Native Messaging host and downloads the matching yt-dlp, Deno, and FFmpeg tools beside the companion. An internet connection is required during installation. See [`companion/README.md`](companion/README.md) for uninstalling, fallback ZIPs, local builds, release configuration, and platform details.

The setup-page download button points at this repository's latest GitHub Release through `extension/setup-config.js`. A tagged release automatically builds native installers and fallback ZIPs through `.github/workflows/release-companion.yml`.

## Development checks

The project intentionally has no package dependencies. With Node.js installed, run:

```powershell
npm test
npm run check
npm run test:companion
```

If PowerShell blocks the `npm.ps1` wrapper, use `npm.cmd test` and `npm.cmd run check`, or run `node --test` directly.

The JavaScript tests cover media classification, command quoting, filters, and filenames. The companion smoke tests cover request validation, safe argument construction, and Chrome Native Messaging framing.
