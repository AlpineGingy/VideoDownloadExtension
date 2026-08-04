"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const contentScript = fs.readFileSync(
  path.join(__dirname, "..", "extension", "content-script.js"),
  "utf8"
);

/** Proves Vimeo embeds are offered to yt-dlp as stable player-page URLs. */
test("page scanning recognizes Vimeo player iframes", () => {
  assert.match(contentScript, /document\.querySelectorAll\("iframe\[src\]"\)/);
  assert.match(contentScript, /frameUrl\.hostname === "player\.vimeo\.com"/);
  assert.match(contentScript, /\^\\\/video\\\/\\d\+\(\?:\\\/\|\$\)/);
  assert.match(contentScript, /addCandidate\(frameUrl\.href, "page"\)/);
});
