(function discoverPageMedia() {
  "use strict";

  let scanTimer;

  /** Converts one raw URL into the candidate shape shared with the service worker. */
  function createCandidate(rawUrl, source, thumbnailUrl = "") {
    const url = MediaUtils.normalizeUrl(rawUrl, document.baseURI);
    if (!url) {
      return null;
    }

    return {
      url,
      kind: MediaUtils.classifyMedia(url),
      source,
      thumbnailUrl: MediaUtils.normalizeUrl(thumbnailUrl, document.baseURI),
      pageTitle: document.title,
      discoveredAt: Date.now()
    };
  }

  /** Scans audio/video elements, their sources, and already-recorded media requests. */
  function scanPage() {
    const candidates = [];
    const seen = new Set();

    const addCandidate = (rawUrl, source, thumbnailUrl = "") => {
      const candidate = createCandidate(rawUrl, source, thumbnailUrl);
      if (candidate && !seen.has(candidate.url)) {
        seen.add(candidate.url);
        candidates.push(candidate);
      }
    };

    document.querySelectorAll("video, audio").forEach((mediaElement) => {
      const thumbnailUrl = mediaElement instanceof HTMLVideoElement ? mediaElement.poster : "";
      addCandidate(mediaElement.currentSrc, "page", thumbnailUrl);
      addCandidate(mediaElement.src, "page", thumbnailUrl);
    });

    document.querySelectorAll("video source, audio source").forEach((source) => {
      addCandidate(source.src, "page");
    });

    performance.getEntriesByType("resource").forEach((entry) => {
      const kind = MediaUtils.classifyMedia(entry.name);
      if (kind !== "unknown") {
        addCandidate(entry.name, "performance");
      }
    });

    return candidates;
  }

  /** Sends the latest page scan to the extension and responds to popup requests. */
  function reportMedia() {
    const items = scanPage();
    chrome.runtime.sendMessage({ type: "MEDIA_FOUND", items }).catch(() => {
      // The extension may have reloaded while this older content script was alive.
    });
    return items;
  }

  /** Debounces DOM mutations so media players can attach sources dynamically. */
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(reportMedia, 350);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SCAN_MEDIA") {
      sendResponse({ items: reportMedia() });
    }
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });

  reportMedia();
})();
