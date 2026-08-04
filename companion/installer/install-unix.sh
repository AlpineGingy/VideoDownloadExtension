#!/usr/bin/env sh
set -eu

# Installs the package's native host and a matching official yt-dlp binary per user.
SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_EXECUTABLE="$SCRIPT_DIRECTORY/media-finder-companion"
if [ ! -f "$SOURCE_EXECUTABLE" ]; then
  echo "media-finder-companion must be in the same folder as this installer." >&2
  exit 1
fi

SYSTEM_NAME=$(uname -s)
MACHINE_NAME=$(uname -m)
if [ "$SYSTEM_NAME" = "Darwin" ]; then
  INSTALL_DIRECTORY="$HOME/Library/Application Support/Media Finder/Companion"
  HOST_MANIFEST_DIRECTORY="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos.zip"
  if [ "$MACHINE_NAME" = "arm64" ]; then
    DENO_TARGET="aarch64-apple-darwin"
    FFMPEG_TARGET="darwin-arm64"
  else
    DENO_TARGET="x86_64-apple-darwin"
    FFMPEG_TARGET="darwin-x64"
  fi
elif [ "$SYSTEM_NAME" = "Linux" ]; then
  INSTALL_DIRECTORY="$HOME/.local/share/media-finder/companion"
  CONFIG_ROOT=${XDG_CONFIG_HOME:-"$HOME/.config"}
  HOST_MANIFEST_DIRECTORY="$CONFIG_ROOT/google-chrome/NativeMessagingHosts"
  if [ "$MACHINE_NAME" = "aarch64" ] || [ "$MACHINE_NAME" = "arm64" ]; then
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
    DENO_TARGET="aarch64-unknown-linux-gnu"
    FFMPEG_TARGET="linux-arm64"
  else
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    DENO_TARGET="x86_64-unknown-linux-gnu"
    FFMPEG_TARGET="linux-x64"
  fi
else
  echo "This installer supports macOS and Linux." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIRECTORY" "$HOST_MANIFEST_DIRECTORY"
cp "$SOURCE_EXECUTABLE" "$INSTALL_DIRECTORY/media-finder-companion"
chmod 755 "$INSTALL_DIRECTORY/media-finder-companion"

if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required to install the yt-dlp and Deno runtimes." >&2
  exit 1
fi

echo "Downloading the latest official yt-dlp binary..."
YT_DLP_ARCHIVE="$INSTALL_DIRECTORY/yt-dlp-macos.zip"
curl --fail --location "$YT_DLP_URL" --output "$YT_DLP_ARCHIVE"
if [ "$SYSTEM_NAME" = "Darwin" ]; then
  unzip -oq "$YT_DLP_ARCHIVE" -d "$INSTALL_DIRECTORY"
  rm -f -- "$YT_DLP_ARCHIVE"
else
  mv -f "$YT_DLP_ARCHIVE" "$INSTALL_DIRECTORY/yt-dlp"
fi
chmod 755 "$INSTALL_DIRECTORY/yt-dlp"

# Re-signs yt-dlp's extracted Python runtime so macOS accepts every native library it loads.
if [ "$SYSTEM_NAME" = "Darwin" ]; then
  find "$INSTALL_DIRECTORY/_internal" -type f | while IFS= read -r nativeFile; do
    if file -b "$nativeFile" | grep -q "Mach-O"; then
      codesign --force --sign - "$nativeFile"
    fi
  done
  codesign --force --sign - "$INSTALL_DIRECTORY/yt-dlp"
fi

DENO_ARCHIVE="$INSTALL_DIRECTORY/deno-download.zip"
echo "Downloading the official Deno runtime for YouTube support..."
curl --fail --location \
  "https://github.com/denoland/deno/releases/latest/download/deno-$DENO_TARGET.zip" \
  --output "$DENO_ARCHIVE"
unzip -jo "$DENO_ARCHIVE" deno -d "$INSTALL_DIRECTORY"
rm -- "$DENO_ARCHIVE"
chmod 755 "$INSTALL_DIRECTORY/deno"

# Downloads a private FFmpeg binary so merging works without sudo or a package manager.
FFMPEG_DOWNLOAD="$INSTALL_DIRECTORY/ffmpeg.download"
echo "Downloading a portable FFmpeg build for audio/video merging..."
if curl --fail --location \
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-$FFMPEG_TARGET" \
    --output "$FFMPEG_DOWNLOAD"; then
  chmod 755 "$FFMPEG_DOWNLOAD"
  mv -f "$FFMPEG_DOWNLOAD" "$INSTALL_DIRECTORY/ffmpeg"
elif command -v ffmpeg >/dev/null 2>&1; then
  rm -f -- "$FFMPEG_DOWNLOAD"
  echo "Warning: the private FFmpeg download failed; using the existing system FFmpeg." >&2
else
  rm -f -- "$FFMPEG_DOWNLOAD"
  echo "FFmpeg could not be downloaded and no system FFmpeg was found." >&2
  exit 1
fi

# Writes the exact absolute host path required by Chrome Native Messaging.
HOST_MANIFEST_PATH="$HOST_MANIFEST_DIRECTORY/com.media_finder.companion.json"
cat > "$HOST_MANIFEST_PATH" <<EOF
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

echo ""
echo "Media Finder companion installed successfully."
echo "yt-dlp, Deno, and FFmpeg are ready for supported downloads."
echo "Downloads will be saved under your Downloads/Media Finder folder."
echo "Restart Chrome, then open Media Finder to verify the connection."
