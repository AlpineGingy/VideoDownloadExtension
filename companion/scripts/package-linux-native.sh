#!/usr/bin/env sh
set -eu

# Builds double-clickable DEB and RPM packages around one Linux companion executable.
if [ "$#" -ne 4 ]; then
  echo "Usage: package-linux-native.sh <runtime> <published-executable> <output-directory> <version>" >&2
  exit 1
fi

RUNTIME=$1
PUBLISHED_EXECUTABLE=$2
OUTPUT_DIRECTORY=$3
VERSION=$4
case "$RUNTIME" in
  linux-x64)
    DEB_ARCHITECTURE=amd64
    RPM_ARCHITECTURE=x86_64
    ;;
  linux-arm64)
    DEB_ARCHITECTURE=arm64
    RPM_ARCHITECTURE=aarch64
    ;;
  *) echo "Unsupported Linux runtime: $RUNTIME" >&2; exit 1 ;;
esac

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/../.." && pwd)
INSTALLER_ROOT="$REPOSITORY_ROOT/companion/installer"
STAGING_ROOT=$(mktemp -d)
trap 'rm -rf -- "$STAGING_ROOT"' EXIT HUP INT TERM
mkdir -p "$OUTPUT_DIRECTORY"

DEB_ROOT="$STAGING_ROOT/deb"
mkdir -p "$DEB_ROOT/DEBIAN" "$DEB_ROOT/opt/media-finder/companion" "$DEB_ROOT/opt/media-finder/installer"
install -m 755 "$PUBLISHED_EXECUTABLE" "$DEB_ROOT/opt/media-finder/companion/media-finder-companion"
install -m 755 "$INSTALLER_ROOT/install-system-unix.sh" "$DEB_ROOT/opt/media-finder/installer/install-system-unix.sh"
install -m 755 "$INSTALLER_ROOT/uninstall-system-unix.sh" "$DEB_ROOT/opt/media-finder/installer/uninstall-system-unix.sh"
install -m 755 "$INSTALLER_ROOT/linux/postinst" "$DEB_ROOT/DEBIAN/postinst"
install -m 755 "$INSTALLER_ROOT/linux/postrm" "$DEB_ROOT/DEBIAN/postrm"
cat > "$DEB_ROOT/DEBIAN/control" <<EOF
Package: media-finder-companion
Version: $VERSION
Section: utils
Priority: optional
Architecture: $DEB_ARCHITECTURE
Depends: curl, unzip
Maintainer: Media Finder <noreply@example.com>
Description: Native download companion for the Media Finder Chrome extension
 Installs the local native messaging host used by Media Finder.
EOF
dpkg-deb --build --root-owner-group "$DEB_ROOT" "$OUTPUT_DIRECTORY/media-finder-companion-$RUNTIME.deb"

RPM_TOP_DIRECTORY="$STAGING_ROOT/rpmbuild"
RPM_SOURCE_DIRECTORY="$STAGING_ROOT/media-finder-companion-$VERSION"
mkdir -p "$RPM_TOP_DIRECTORY/BUILD" "$RPM_TOP_DIRECTORY/BUILDROOT" "$RPM_TOP_DIRECTORY/RPMS" \
  "$RPM_TOP_DIRECTORY/SOURCES" "$RPM_TOP_DIRECTORY/SPECS" "$RPM_TOP_DIRECTORY/SRPMS" "$RPM_SOURCE_DIRECTORY"
cp "$PUBLISHED_EXECUTABLE" "$RPM_SOURCE_DIRECTORY/media-finder-companion"
cp "$INSTALLER_ROOT/install-system-unix.sh" "$RPM_SOURCE_DIRECTORY/install-system-unix.sh"
cp "$INSTALLER_ROOT/uninstall-system-unix.sh" "$RPM_SOURCE_DIRECTORY/uninstall-system-unix.sh"
tar -C "$STAGING_ROOT" -czf "$RPM_TOP_DIRECTORY/SOURCES/media-finder-companion-$VERSION.tar.gz" \
  "media-finder-companion-$VERSION"
cp "$INSTALLER_ROOT/linux/media-finder.spec" "$RPM_TOP_DIRECTORY/SPECS/media-finder.spec"
rpmbuild -bb \
  --define "_topdir $RPM_TOP_DIRECTORY" \
  --define "media_finder_version $VERSION" \
  --define "media_finder_arch $RPM_ARCHITECTURE" \
  "$RPM_TOP_DIRECTORY/SPECS/media-finder.spec"
RPM_PACKAGE=$(find "$RPM_TOP_DIRECTORY/RPMS" -type f -name '*.rpm' -print -quit)
if [ -z "$RPM_PACKAGE" ]; then
  echo "rpmbuild did not create an RPM package." >&2
  exit 1
fi
cp "$RPM_PACKAGE" "$OUTPUT_DIRECTORY/media-finder-companion-$RUNTIME.rpm"
