#!/usr/bin/env sh
set -eu

# Provides the command-line uninstaller retained beside the installed companion.
SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$SCRIPT_DIRECTORY/uninstall-system-unix.sh" macos
