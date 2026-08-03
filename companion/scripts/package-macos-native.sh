#!/usr/bin/env sh
set -eu

# Builds a double-clickable macOS PKG around one published companion executable.
if [ "$#" -ne 4 ]; then
  echo "Usage: package-macos-native.sh <runtime> <published-executable> <output-directory> <version>" >&2
  exit 1
fi

RUNTIME=$1
PUBLISHED_EXECUTABLE=$2
OUTPUT_DIRECTORY=$3
VERSION=$4
case "$RUNTIME" in
  osx-x64|osx-arm64) ;;
  *) echo "Unsupported macOS runtime: $RUNTIME" >&2; exit 1 ;;
esac

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/../.." && pwd)
INSTALLER_ROOT="$REPOSITORY_ROOT/companion/installer"
STAGING_ROOT=$(mktemp -d)
trap 'rm -rf -- "$STAGING_ROOT"' EXIT HUP INT TERM

PAYLOAD_ROOT="$STAGING_ROOT/payload"
SCRIPTS_ROOT="$STAGING_ROOT/scripts"
INSTALL_DIRECTORY="$PAYLOAD_ROOT/Library/Application Support/Media Finder/Companion"
mkdir -p "$INSTALL_DIRECTORY" "$SCRIPTS_ROOT" "$OUTPUT_DIRECTORY"

cp "$PUBLISHED_EXECUTABLE" "$INSTALL_DIRECTORY/media-finder-companion"
cp "$INSTALLER_ROOT/install-system-unix.sh" "$INSTALL_DIRECTORY/install-system-unix.sh"
cp "$INSTALLER_ROOT/uninstall-system-unix.sh" "$INSTALL_DIRECTORY/uninstall-system-unix.sh"
cp "$INSTALLER_ROOT/macos/uninstall-media-finder.sh" "$INSTALL_DIRECTORY/uninstall-media-finder.sh"
cp "$INSTALLER_ROOT/install-system-unix.sh" "$SCRIPTS_ROOT/install-system-unix.sh"
cp "$INSTALLER_ROOT/macos/postinstall" "$SCRIPTS_ROOT/postinstall"
chmod 755 "$INSTALL_DIRECTORY"/* "$SCRIPTS_ROOT"/*

pkgbuild \
  --root "$PAYLOAD_ROOT" \
  --scripts "$SCRIPTS_ROOT" \
  --identifier "com.media-finder.companion" \
  --version "$VERSION" \
  --install-location / \
  "$OUTPUT_DIRECTORY/media-finder-companion-$RUNTIME.pkg"
