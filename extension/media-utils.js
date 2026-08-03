(function exposeMediaUtils(root) {
  "use strict";

  const DIRECT_EXTENSIONS = new Set([
    "3gp",
    "avi",
    "m4v",
    "mkv",
    "mov",
    "mp4",
    "mpeg",
    "mpg",
    "ogv",
    "webm"
  ]);

  const AUDIO_EXTENSIONS = new Set([
    "aac",
    "flac",
    "m4a",
    "mp3",
    "oga",
    "ogg",
    "opus",
    "wav",
    "wma"
  ]);

  const MANIFEST_EXTENSIONS = new Set(["m3u8", "mpd"]);

  const MIME_EXTENSIONS = new Map([
    ["application/dash+xml", "mpd"],
    ["application/vnd.apple.mpegurl", "m3u8"],
    ["application/x-mpegurl", "m3u8"],
    ["audio/aac", "aac"],
    ["audio/flac", "flac"],
    ["audio/mp3", "mp3"],
    ["audio/mp4", "m4a"],
    ["audio/mpeg", "mp3"],
    ["audio/ogg", "ogg"],
    ["audio/opus", "opus"],
    ["audio/wav", "wav"],
    ["audio/webm", "webm"],
    ["audio/x-m4a", "m4a"],
    ["audio/x-wav", "wav"],
    ["video/mp4", "mp4"],
    ["video/quicktime", "mov"],
    ["video/webm", "webm"],
    ["video/x-matroska", "mkv"],
    ["video/x-msvideo", "avi"]
  ]);

  /** Returns the lowercase file extension from a URL without query-string noise. */
  function getExtension(url) {
    try {
      const pathname = new URL(url, "https://media-finder.invalid/").pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      return match ? match[1].toLowerCase() : "";
    } catch {
      return "";
    }
  }

  /** Reads a media MIME hint embedded in a CDN URL's query parameters. */
  function getUrlMimeType(url) {
    try {
      const parsedUrl = new URL(url);
      const mimeType = parsedUrl.searchParams.get("mime") || parsedUrl.searchParams.get("type");
      return mimeType?.includes("/") ? mimeType.toLowerCase().split(";", 1)[0].trim() : "";
    } catch {
      return "";
    }
  }

  /** Normalizes a response MIME type and falls back to a MIME hint in the URL. */
  function getEffectiveContentType(url, contentType = "") {
    const normalizedType = contentType.toLowerCase().split(";", 1)[0].trim();
    return normalizedType || getUrlMimeType(url);
  }

  /** Reports a URL extension or infers the likely format from its MIME type. */
  function inferMediaExtension(url, contentType = "") {
    return getExtension(url) || MIME_EXTENSIONS.get(getEffectiveContentType(url, contentType)) || "";
  }

  /** Classifies a media candidate so the UI can offer only valid actions. */
  function classifyMedia(url, contentType = "") {
    const normalizedType = getEffectiveContentType(url, contentType);
    const extension = getExtension(url);

    if (url.startsWith("blob:")) {
      return "blob";
    }

    if (
      MANIFEST_EXTENSIONS.has(extension) ||
      normalizedType.includes("mpegurl") ||
      normalizedType.includes("dash+xml")
    ) {
      return "manifest";
    }

    if (normalizedType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) {
      return "audio";
    }

    if (DIRECT_EXTENSIONS.has(extension) || normalizedType.startsWith("video/")) {
      return "direct";
    }

    return "unknown";
  }

  /** Identifies small stream chunks that are not useful standalone downloads. */
  function isStreamSegment(url) {
    return ["m4s", "ts"].includes(getExtension(url));
  }

  /** Maps detailed detector sources into the two user-facing discovery methods. */
  function getDiscoveryGroup(source) {
    return source === "page" ? "page" : "network";
  }

  /** Creates a PowerShell-safe yt-dlp command from a fixed set of supported options. */
  function buildYtDlpCommand(url, options = {}, pageTitle = "") {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || normalizedUrl.startsWith("blob:")) {
      return "";
    }

    const args = ["yt-dlp", "--continue", "--no-overwrites"];
    const allowedBrowsers = new Set(["chrome", "edge", "firefox"]);
    const allowedContainers = new Set(["mp4", "mkv"]);
    const allowedFragmentCounts = new Set([1, 4, 8]);
    const allowedFilenameStyles = new Set(["pageTitle", "mediaTitle", "titleQuality", "titleId"]);

    if (allowedFilenameStyles.has(options.filenameStyle)) {
      let outputTemplate = "%(title)s.%(ext)s";
      if (options.filenameStyle === "pageTitle" && pageTitle.trim()) {
        outputTemplate = options.quality === "audio"
          ? `${sanitizeTemplateTitle(pageTitle)} [audio].%(ext)s`
          : `${sanitizeTemplateTitle(pageTitle)} [%(resolution)s].%(ext)s`;
      } else if (options.filenameStyle === "titleQuality") {
        outputTemplate = options.quality === "audio"
          ? "%(title)s [audio].%(ext)s"
          : "%(title)s [%(resolution)s].%(ext)s";
      } else if (options.filenameStyle === "titleId") {
        outputTemplate = "%(title)s [%(id)s].%(ext)s";
      }
      args.push("--windows-filenames", "--trim-filenames", "180", "--output", outputTemplate);
    }

    if (allowedBrowsers.has(options.cookiesBrowser)) {
      args.push("--cookies-from-browser", options.cookiesBrowser);
    }

    if (options.quality === "1080p") {
      args.push("-f", "bestvideo*[height<=1080]+bestaudio/best[height<=1080]");
    } else if (options.quality === "720p") {
      args.push("-f", "bestvideo*[height<=720]+bestaudio/best[height<=720]");
    } else if (options.quality === "audio") {
      args.push("-x", "--audio-format", "mp3");
    }

    if (options.quality !== "audio" && allowedContainers.has(options.container)) {
      args.push("--merge-output-format", options.container);
    }

    if (options.embedMetadata) {
      args.push("--embed-metadata");
    }
    if (options.embedThumbnail) {
      args.push("--embed-thumbnail");
    }
    if (options.embedEnglishSubtitles && options.quality !== "audio") {
      args.push(
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en.*",
        "--embed-subs"
      );
    }

    const concurrentFragments = Number(options.concurrentFragments);
    if (allowedFragmentCounts.has(concurrentFragments) && concurrentFragments > 1) {
      args.push("--concurrent-fragments", String(concurrentFragments));
    }

    args.push(normalizedUrl);
    return args.map((argument) => quoteShellArgument(argument, options.shell)).join(" ");
  }

  /** Sanitizes an untrusted page title before using it as a literal yt-dlp filename. */
  function sanitizeTemplateTitle(title) {
    const normalized = title
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 120)
      .replace(/\.+$/g, "") || "media";
    return normalized.replace(/%/g, "%%");
  }

  /** Quotes one command argument for PowerShell or a macOS/Linux POSIX shell. */
  function quoteShellArgument(argument, shell = "powershell") {
    if (/^[a-zA-Z0-9._/-]+$/.test(argument)) {
      return argument;
    }

    if (shell === "posix") {
      return `'${argument.replace(/'/g, `'"'"'`)}'`;
    }
    return `'${argument.replace(/'/g, "''")}'`;
  }

  /** Applies the popup's text, media-type, and request-source network filters. */
  function filterNetworkItems(items, filters) {
    const query = (filters.query || "").trim().toLowerCase();
    return items.filter((item) => {
      const extension = inferMediaExtension(item.url, item.contentType);
      const searchableText = `${item.url} ${item.contentType || ""} ${extension}`.toLowerCase();
      const matchesQuery = !query || searchableText.includes(query);
      const matchesKind = filters.kind === "all" || item.kind === filters.kind;
      const matchesSource = filters.source === "all" || item.source === filters.source;
      return matchesQuery && matchesKind && matchesSource;
    });
  }

  /** Removes URL fragments so the same resource has one stable identity. */
  function normalizeUrl(url, baseUrl) {
    if (!url || typeof url !== "string") {
      return "";
    }

    try {
      const parsedUrl = new URL(url, baseUrl);
      if (!["http:", "https:", "blob:"].includes(parsedUrl.protocol)) {
        return "";
      }
      parsedUrl.hash = "";
      return parsedUrl.href;
    } catch {
      return "";
    }
  }

  /** Builds a safe, readable download filename from a media URL. */
  function suggestFilename(url, pageTitle = "media", contentType = "") {
    let filename = "";
    try {
      filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    } catch {
      filename = "";
    }

    const sanitizedTitle = pageTitle
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "video";

    if (!filename || !getExtension(filename)) {
      const extension = inferMediaExtension(url, contentType) || "mp4";
      filename = `${sanitizedTitle}.${extension}`;
    }

    return filename
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .slice(0, 140);
  }

  const api = {
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
  };

  root.MediaUtils = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
