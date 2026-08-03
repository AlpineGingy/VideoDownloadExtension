#!/usr/bin/env sh
set -eu

# Completes a native macOS or Linux package installation from its system payload.
PLATFORM=${1:-}
SYSTEM_NAME=$(uname -s)
MACHINE_NAME=$(uname -m)

if [ "$PLATFORM" = "macos" ] && [ "$SYSTEM_NAME" = "Darwin" ]; then
  INSTALL_DIRECTORY="/Library/Application Support/Media Finder/Companion"
  YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
  if [ "$MACHINE_NAME" = "arm64" ]; then
    DENO_TARGET="aarch64-apple-darwin"
    FFMPEG_TARGET="darwin-arm64"
  else
    DENO_TARGET="x86_64-apple-darwin"
    FFMPEG_TARGET="darwin-x64"
  fi
  MANIFEST_DIRECTORIES="
/Library/Google/Chrome/NativeMessagingHosts
/Library/Google/ChromeForTesting/NativeMessagingHosts
/Library/Application Support/Chromium/NativeMessagingHosts"
elif [ "$PLATFORM" = "linux" ] && [ "$SYSTEM_NAME" = "Linux" ]; then
  INSTALL_DIRECTORY="/opt/media-finder/companion"
  if [ "$MACHINE_NAME" = "aarch64" ] || [ "$MACHINE_NAME" = "arm64" ]; then
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
    DENO_TARGET="aarch64-unknown-linux-gnu"
    FFMPEG_TARGET="linux-arm64"
  else
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    DENO_TARGET="x86_64-unknown-linux-gnu"
    FFMPEG_TARGET="linux-x64"
  fi
  MANIFEST_DIRECTORIES="
/etc/opt/chrome/native-messaging-hosts
/etc/opt/chrome_for_testing/native-messaging-hosts
/etc/chromium/native-messaging-hosts"
else
  echo "The installer platform '$PLATFORM' does not match $SYSTEM_NAME." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "This native package setup step must run with administrator privileges." >&2
  exit 1
fi
if [ ! -x "$INSTALL_DIRECTORY/media-finder-companion" ]; then
  echo "The native package did not install media-finder-companion in the expected location." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
  echo "curl and unzip are required to finish installing Media Finder." >&2
  exit 1
fi

echo "Downloading the latest official yt-dlp binary..."
curl --fail --location "$YT_DLP_URL" --output "$INSTALL_DIRECTORY/yt-dlp"
chmod 755 "$INSTALL_DIRECTORY/yt-dlp"

DENO_ARCHIVE="$INSTALL_DIRECTORY/deno-download.zip"
echo "Downloading the official Deno runtime for YouTube support..."
curl --fail --location \
  "https://github.com/denoland/deno/releases/latest/download/deno-$DENO_TARGET.zip" \
  --output "$DENO_ARCHIVE"
unzip -jo "$DENO_ARCHIVE" deno -d "$INSTALL_DIRECTORY"
rm -f -- "$DENO_ARCHIVE"
chmod 755 "$INSTALL_DIRECTORY/deno"

FFMPEG_DOWNLOAD="$INSTALL_DIRECTORY/ffmpeg.download"
echo "Downloading a private FFmpeg build for audio/video merging..."
if curl --fail --location \
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-$FFMPEG_TARGET" \
    --output "$FFMPEG_DOWNLOAD"; then
  chmod 755 "$FFMPEG_DOWNLOAD"
  mv -f "$FFMPEG_DOWNLOAD" "$INSTALL_DIRECTORY/ffmpeg"
elif command -v ffmpeg >/dev/null 2>&1; then
  rm -f -- "$FFMPEG_DOWNLOAD"
  echo "Warning: using the existing system FFmpeg because the private download failed." >&2
else
  rm -f -- "$FFMPEG_DOWNLOAD"
  echo "FFmpeg could not be downloaded and no system FFmpeg was found." >&2
  exit 1
fi

HOST_MANIFEST="$INSTALL_DIRECTORY/com.media_finder.companion.json"
cat > "$HOST_MANIFEST" <<EOF
{
  "name": "com.media_finder.companion",
  "description": "Media Finder local yt-dlp companion",
  "path": "$INSTALL_DIRECTORY/media-finder-companion",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://nagidlmhdnnodcicinldienofcjnpeoi/"
  ]
}
EOF
chmod 644 "$HOST_MANIFEST"

# Installs the same manifest for each supported Chrome-family system location.
printf '%s\n' "$MANIFEST_DIRECTORIES" | while IFS= read -r manifestDirectory; do
  if [ -n "$manifestDirectory" ]; then
    mkdir -p "$manifestDirectory"
    cp "$HOST_MANIFEST" "$manifestDirectory/com.media_finder.companion.json"
    chmod 644 "$manifestDirectory/com.media_finder.companion.json"
  fi
done

echo "Media Finder companion installed successfully. Restart Chrome to connect."
