#!/usr/bin/env sh
set -eu

# Removes only the current user's Media Finder host registration and application files.
SYSTEM_NAME=$(uname -s)
if [ "$SYSTEM_NAME" = "Darwin" ]; then
  INSTALL_DIRECTORY="$HOME/Library/Application Support/Media Finder/Companion"
  HOST_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.media_finder.companion.json"
else
  CONFIG_ROOT=${XDG_CONFIG_HOME:-"$HOME/.config"}
  INSTALL_DIRECTORY="$HOME/.local/share/media-finder/companion"
  HOST_MANIFEST="$CONFIG_ROOT/google-chrome/NativeMessagingHosts/com.media_finder.companion.json"
fi

rm -f "$HOST_MANIFEST"
rm -rf "$INSTALL_DIRECTORY"
echo "Media Finder companion removed. Restart Chrome to finish uninstalling."
