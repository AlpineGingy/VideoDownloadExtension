"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildYtDlpCommand,
  classifyMedia,
  filterNetworkItems,
  getExtension,
  getDiscoveryGroup,
  getEffectiveContentType,
  inferMediaExtension,
  isStreamSegment,
  normalizeUrl,
  quoteShellArgument,
  suggestFilename
} = require("../extension/media-utils.js");

test("getExtension ignores query strings and normalizes case", () => {
  assert.equal(getExtension("https://cdn.example/video.MP4?token=abc"), "mp4");
});

test("classifyMedia recognizes direct video URLs", () => {
  assert.equal(classifyMedia("https://cdn.example/movie.webm"), "direct");
  assert.equal(classifyMedia("https://cdn.example/resource", "video/mp4"), "direct");
});

test("classifyMedia recognizes audio extensions and response MIME types", () => {
  assert.equal(classifyMedia("https://cdn.example/podcast.mp3"), "audio");
  assert.equal(classifyMedia("https://cdn.example/playback", "audio/mpeg"), "audio");
  assert.equal(classifyMedia("https://cdn.example/song.m4a"), "audio");
});

test("classifyMedia reads MIME hints from extensionless CDN URLs", () => {
  const audioUrl = "https://cdn.example/videoplayback?mime=audio%2Fwebm%3B+codecs%3Dopus";
  const videoUrl = "https://cdn.example/videoplayback?mime=video%2Fmp4";

  assert.equal(getEffectiveContentType(audioUrl), "audio/webm");
  assert.equal(classifyMedia(audioUrl), "audio");
  assert.equal(classifyMedia(videoUrl), "direct");
});

test("inferMediaExtension reports URL extensions and MIME-derived formats", () => {
  assert.equal(inferMediaExtension("https://cdn.example/song.mp3?token=abc"), "mp3");
  assert.equal(inferMediaExtension("https://cdn.example/playback", "audio/mp4"), "m4a");
  assert.equal(
    inferMediaExtension("https://cdn.example/manifest", "application/vnd.apple.mpegurl"),
    "m3u8"
  );
});

test("classifyMedia recognizes HLS and DASH manifests", () => {
  assert.equal(classifyMedia("https://cdn.example/master.m3u8"), "manifest");
  assert.equal(
    classifyMedia("https://cdn.example/stream", "application/dash+xml"),
    "manifest"
  );
});

test("classifyMedia keeps blob URLs separate from downloadable files", () => {
  assert.equal(classifyMedia("blob:https://example.com/1234"), "blob");
});

test("isStreamSegment filters HLS and DASH chunks from standalone results", () => {
  assert.equal(isStreamSegment("https://cdn.example/chunk-15.ts?token=abc"), true);
  assert.equal(isStreamSegment("https://cdn.example/chunk-15.m4s"), true);
  assert.equal(isStreamSegment("https://cdn.example/movie.mp4"), false);
});

test("getDiscoveryGroup keeps HTML separate from both network sources", () => {
  assert.equal(getDiscoveryGroup("page"), "page");
  assert.equal(getDiscoveryGroup("network"), "network");
  assert.equal(getDiscoveryGroup("performance"), "network");
});

test("buildYtDlpCommand creates a PowerShell-safe command", () => {
  assert.equal(
    buildYtDlpCommand("https://cdn.example/teacher's/master.m3u8"),
    "yt-dlp --continue --no-overwrites 'https://cdn.example/teacher''s/master.m3u8'"
  );
  assert.equal(buildYtDlpCommand("blob:https://example.com/1234"), "");
  assert.equal(
    buildYtDlpCommand("https://example.com/watch?v=123", { quality: "best" }),
    "yt-dlp --continue --no-overwrites 'https://example.com/watch?v=123'"
  );
});

test("buildYtDlpCommand supports macOS and Linux POSIX shell quoting", () => {
  assert.equal(
    buildYtDlpCommand("https://cdn.example/teacher's/master.m3u8", { shell: "posix" }),
    "yt-dlp --continue --no-overwrites 'https://cdn.example/teacher'\"'\"'s/master.m3u8'"
  );
  assert.equal(quoteShellArgument("plain-value", "posix"), "plain-value");
});

test("buildYtDlpCommand creates a predictable sanitized page-title filename", () => {
  assert.equal(
    buildYtDlpCommand(
      "https://cdn.example/master.m3u8",
      { filenameStyle: "pageTitle" },
      "Course: Lesson 1 / Intro?"
    ),
    "yt-dlp --continue --no-overwrites --windows-filenames --trim-filenames 180 " +
      "--output 'Course Lesson 1 Intro [%(resolution)s].%(ext)s' 'https://cdn.example/master.m3u8'"
  );
});

test("buildYtDlpCommand adds validated cookie, format, and processing options", () => {
  assert.equal(
    buildYtDlpCommand("https://cdn.example/master.m3u8", {
      cookiesBrowser: "chrome",
      quality: "1080p",
      container: "mp4",
      embedMetadata: true,
      embedThumbnail: true,
      embedEnglishSubtitles: true,
      concurrentFragments: 4
    }),
    "yt-dlp --continue --no-overwrites --cookies-from-browser chrome " +
      "-f 'bestvideo*[height<=1080]+bestaudio/best[height<=1080]' " +
      "--merge-output-format mp4 --embed-metadata --embed-thumbnail " +
      "--write-subs --write-auto-subs --sub-langs 'en.*' --embed-subs " +
      "--concurrent-fragments 4 'https://cdn.example/master.m3u8'"
  );
});

test("buildYtDlpCommand ignores unsupported option values and audio container conflicts", () => {
  assert.equal(
    buildYtDlpCommand("https://cdn.example/audio", {
      cookiesBrowser: "unsupported-browser",
      quality: "audio",
      container: "mp4",
      embedEnglishSubtitles: true,
      concurrentFragments: 999
    }),
    "yt-dlp --continue --no-overwrites -x --audio-format mp3 'https://cdn.example/audio'"
  );
});

test("filterNetworkItems combines search, type, and capture-source filters", () => {
  const items = [
    {
      url: "https://video.example/lesson.mp4",
      contentType: "video/mp4",
      kind: "direct",
      source: "network"
    },
    {
      url: "https://stream.example/master.m3u8",
      contentType: "application/vnd.apple.mpegurl",
      kind: "manifest",
      source: "performance"
    },
    {
      url: "https://audio.example/playback",
      contentType: "audio/mpeg",
      kind: "audio",
      source: "network"
    }
  ];

  assert.deepEqual(
    filterNetworkItems(items, { query: "stream.example", kind: "manifest", source: "performance" }),
    [items[1]]
  );
  assert.deepEqual(
    filterNetworkItems(items, { query: "video/mp4", kind: "all", source: "all" }),
    [items[0]]
  );
  assert.deepEqual(
    filterNetworkItems(items, { query: "mp3", kind: "audio", source: "all" }),
    [items[2]]
  );
});

test("normalizeUrl resolves relative URLs, removes fragments, and rejects scripts", () => {
  assert.equal(
    normalizeUrl("/movie.mp4#chapter", "https://example.com/watch"),
    "https://example.com/movie.mp4"
  );
  assert.equal(normalizeUrl("javascript:alert(1)"), "");
});

test("suggestFilename uses a safe page title when a URL has no filename", () => {
  assert.equal(
    suggestFilename("https://cdn.example/media?id=4", "Lesson: One / Intro"),
    "Lesson- One - Intro.mp4"
  );
});

test("suggestFilename uses an inferred audio extension for an extensionless URL", () => {
  assert.equal(
    suggestFilename("https://cdn.example/playback?id=4", "Podcast Episode", "audio/mpeg"),
    "Podcast Episode.mp3"
  );
});

test("suggestFilename preserves an existing audio filename", () => {
  assert.equal(
    suggestFilename("https://cdn.example/episode-12.mp3?token=abc", "Podcast Episode"),
    "episode-12.mp3"
  );
});
