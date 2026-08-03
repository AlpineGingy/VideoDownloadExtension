"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** Converts a Chrome manifest public key into its deterministic extension ID. */
function extensionIdFromKey(base64Key) {
  const publicKey = Buffer.from(base64Key, "base64");
  const digest = crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16);
  const alphabet = "abcdefghijklmnop";
  return Array.from(digest, (byte) => alphabet[byte >> 4] + alphabet[byte & 15]).join("");
}

test("manifest uses the native companion's stable authorized extension ID", () => {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(extensionIdFromKey(manifest.key), "nagidlmhdnnodcicinldienofcjnpeoi");
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.ok(manifest.optional_permissions.includes("cookies"));
});

/** Proves Chrome's extension and toolbar icon mappings point to packaged PNG files. */
test("manifest references every required extension icon size", () => {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedIcons = {
    "16": "assets/icons/icon-16.png",
    "32": "assets/icons/icon-32.png",
    "48": "assets/icons/icon-48.png",
    "128": "assets/icons/icon-128.png"
  };

  assert.deepEqual(manifest.icons, expectedIcons);
  assert.deepEqual(manifest.action.default_icon, {
    "16": expectedIcons["16"],
    "32": expectedIcons["32"]
  });
  Object.values(expectedIcons).forEach((iconPath) => {
    assert.ok(fs.existsSync(path.join(__dirname, "..", iconPath)), `${iconPath} does not exist.`);
  });
});
