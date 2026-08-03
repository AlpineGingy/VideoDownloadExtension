"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");

/** Proves the Chrome payload and companion installers remain in distinct installable folders. */
test("repository separates the unpacked extension from companion installers", () => {
  assert.ok(fs.existsSync(path.join(repositoryRoot, "extension", "manifest.json")));
  assert.ok(fs.existsSync(path.join(repositoryRoot, "companion", "installer", "install-windows.ps1")));
  assert.ok(fs.existsSync(path.join(repositoryRoot, "companion", "installer", "install-unix.sh")));
  assert.ok(fs.existsSync(path.join(repositoryRoot, "companion", "installer", "windows", "MediaFinder.iss")));
  assert.ok(fs.existsSync(path.join(repositoryRoot, "companion", "installer", "macos", "postinstall")));
  assert.ok(fs.existsSync(path.join(repositoryRoot, "companion", "installer", "linux", "media-finder.spec")));
  assert.equal(fs.existsSync(path.join(repositoryRoot, "manifest.json")), false);
});
