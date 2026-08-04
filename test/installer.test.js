"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const windowsInstaller = fs.readFileSync(
  path.join(__dirname, "..", "companion", "installer", "install-windows.ps1"),
  "utf8"
);
const systemUnixInstaller = fs.readFileSync(
  path.join(__dirname, "..", "companion", "installer", "install-system-unix.sh"),
  "utf8"
);
const setupScript = fs.readFileSync(
  path.join(__dirname, "..", "extension", "setup.js"),
  "utf8"
);
const releaseWorkflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "release-companion.yml"),
  "utf8"
);
const windowsPackager = fs.readFileSync(
  path.join(__dirname, "..", "companion", "scripts", "package-windows-native.ps1"),
  "utf8"
);

/** Proves Windows installs the fast unpackaged yt-dlp build and protects active downloads. */
test("Windows installer uses unpackaged yt-dlp and detects running Media Finder processes", () => {
  assert.match(windowsInstaller, /yt-dlp_win\.zip/);
  assert.match(windowsInstaller, /_internal/);
  assert.match(windowsInstaller, /Get-Process -Name "media-finder-companion", "yt-dlp"/);
  assert.match(windowsInstaller, /fully exit Chrome/);
});

/** Proves native Unix packages register manifests in Chrome's system host directories. */
test("macOS and Linux native packages use system Chrome manifest locations", () => {
  assert.match(systemUnixInstaller, /\/Library\/Google\/Chrome\/NativeMessagingHosts/);
  assert.match(systemUnixInstaller, /\/etc\/opt\/chrome\/native-messaging-hosts/);
  assert.match(systemUnixInstaller, /\/etc\/chromium\/native-messaging-hosts/);
});

/** Proves the setup page offers native double-click installers instead of archive-first setup. */
test("setup page selects EXE, PKG, DEB, and RPM release assets", () => {
  assert.match(setupScript, /-setup\.exe/);
  assert.match(setupScript, /\.pkg/);
  assert.match(setupScript, /\.deb/);
  assert.match(setupScript, /\.rpm/);
});

/** Proves tagged releases build each native installer family as well as fallback archives. */
test("release workflow builds Windows, macOS, and Linux native packages", () => {
  assert.match(releaseWorkflow, /MediaFinder\.iss/);
  assert.match(releaseWorkflow, /package-macos-native\.sh/);
  assert.match(releaseWorkflow, /package-linux-native\.sh/);
});

/** Proves release publication identifies the repository without relying on a checkout. */
test("release publication supplies its GitHub repository explicitly", () => {
  assert.match(releaseWorkflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
});

/** Proves CI gives each native packager the files, runner, and architecture it expects. */
test("release packaging uses assembled Windows files and native Linux ARM64 hardware", () => {
  assert.match(releaseWorkflow, /Resolve-Path "media-finder-companion-\$\{\{ matrix\.runtime \}\}"/);
  assert.match(
    releaseWorkflow,
    /runner: ubuntu-24\.04-arm\s+runtime: linux-arm64/
  );
  assert.match(windowsPackager, /MediaFinder\.iss/);
  const linuxPackager = fs.readFileSync(
    path.join(__dirname, "..", "companion", "scripts", "package-linux-native.sh"),
    "utf8"
  );
  assert.match(
    linuxPackager,
    /rpmbuild -bb \\\r?\n\s+--target "\$RPM_ARCHITECTURE"/
  );
});

/** Proves a local Windows build can reproduce both architecture-specific Setup executables. */
test("Windows native packager publishes x64 and ARM64 installers", () => {
  assert.match(windowsPackager, /"win-x64", "win-arm64"/);
  assert.match(windowsPackager, /MediaFinder\.iss/);
  assert.match(windowsPackager, /companion\\artifacts/);
});
