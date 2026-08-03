"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const windowsInstaller = fs.readFileSync(
  path.join(__dirname, "..", "companion", "scripts", "install-windows.ps1"),
  "utf8"
);

/** Proves Windows installs the fast unpackaged yt-dlp build and protects active downloads. */
test("Windows installer uses unpackaged yt-dlp and detects running Media Finder processes", () => {
  assert.match(windowsInstaller, /yt-dlp_win\.zip/);
  assert.match(windowsInstaller, /_internal/);
  assert.match(windowsInstaller, /Get-Process -Name "media-finder-companion", "yt-dlp"/);
  assert.match(windowsInstaller, /fully exit Chrome/);
});
