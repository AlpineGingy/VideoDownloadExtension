"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runnerSource = fs.readFileSync(
  path.join(__dirname, "..", "companion", "MediaFinder.Companion", "YtDlpRunner.cs"),
  "utf8"
);

/** Proves yt-dlp cannot inherit or consume Chrome's native-messaging input frames. */
test("companion isolates and closes yt-dlp standard input", () => {
  assert.match(runnerSource, /RedirectStandardInput = true/);
  assert.match(runnerSource, /process\.StandardInput\.Close\(\)/);
  assert.match(runnerSource, /RedirectStandardOutput = true/);
  assert.match(runnerSource, /RedirectStandardError = true/);
});
