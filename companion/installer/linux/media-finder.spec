Name: media-finder-companion
Version: %{media_finder_version}
Release: 1%{?dist}
Summary: Native download companion for the Media Finder Chrome extension
License: Proprietary
URL: https://github.com/
Source0: media-finder-companion-%{media_finder_version}.tar.gz
BuildArch: %{media_finder_arch}
Requires: curl
Requires: unzip

%description
Installs the local native messaging host used by the Media Finder Chrome extension.

%prep
%setup -q

%build

%install
mkdir -p %{buildroot}/opt/media-finder/companion
mkdir -p %{buildroot}/opt/media-finder/installer
install -m 755 media-finder-companion %{buildroot}/opt/media-finder/companion/media-finder-companion
install -m 755 install-system-unix.sh %{buildroot}/opt/media-finder/installer/install-system-unix.sh
install -m 755 uninstall-system-unix.sh %{buildroot}/opt/media-finder/installer/uninstall-system-unix.sh

%post
/opt/media-finder/installer/install-system-unix.sh linux

%postun
if [ "$1" -eq 0 ]; then
  rm -f \
    /etc/opt/chrome/native-messaging-hosts/com.media_finder.companion.json \
    /etc/opt/chrome_for_testing/native-messaging-hosts/com.media_finder.companion.json \
    /etc/chromium/native-messaging-hosts/com.media_finder.companion.json
  rm -rf /opt/media-finder
fi

%files
/opt/media-finder/companion/media-finder-companion
/opt/media-finder/installer/install-system-unix.sh
/opt/media-finder/installer/uninstall-system-unix.sh

%changelog
* Mon Aug 03 2026 Media Finder <noreply@example.com> - %{media_finder_version}-1
- Build the native Chrome companion package.
