#!/usr/bin/env sh
set -eu

# Removes files created by the system-wide macOS or Linux native package.
PLATFORM=${1:-}
if [ "$(id -u)" -ne 0 ]; then
  echo "System package removal must run with administrator privileges." >&2
  exit 1
fi

if [ "$PLATFORM" = "macos" ]; then
  rm -f \
    "/Library/Google/Chrome/NativeMessagingHosts/com.media_finder.companion.json" \
    "/Library/Google/ChromeForTesting/NativeMessagingHosts/com.media_finder.companion.json" \
    "/Library/Application Support/Chromium/NativeMessagingHosts/com.media_finder.companion.json"
  rm -rf "/Library/Application Support/Media Finder/Companion"
elif [ "$PLATFORM" = "linux" ]; then
  rm -f \
    "/etc/opt/chrome/native-messaging-hosts/com.media_finder.companion.json" \
    "/etc/opt/chrome_for_testing/native-messaging-hosts/com.media_finder.companion.json" \
    "/etc/chromium/native-messaging-hosts/com.media_finder.companion.json"
  rm -rf "/opt/media-finder"
else
  echo "Specify macos or linux when removing the system package." >&2
  exit 1
fi

echo "Media Finder companion removed. Restart Chrome to finish uninstalling."
