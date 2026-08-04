importScripts("media-utils.js");

"use strict";

const MAX_ITEMS_PER_TAB = 200;
const MAX_DOWNLOAD_JOBS = 50;
const NATIVE_HOST_NAME = "com.media_finder.companion";
const DOWNLOAD_JOBS_KEY = "companionDownloadJobs";
const CLEAR_NETWORK_ON_NAVIGATION_KEY = "clearNetworkOnNavigation";
const FINISHED_STATUSES = new Set(["completed", "error", "cancelled"]);
const VISIBLE_UPDATE_INTERVAL_MS = 250;

let nativePort;
const downloadTabs = new Map();
const downloadBadgeText = new Map();
const pendingLogRequests = new Map();
const pendingProgressStorage = new Map();
const pendingVisibleUpdates = new Map();
let jobStorageQueue = Promise.resolve();
let nativeProtocolVersion = 0;

/** Reads the persistent download history shown by every popup instance. */
async function getDownloadJobs() {
  const stored = await chrome.storage.local.get(DOWNLOAD_JOBS_KEY);
  return stored[DOWNLOAD_JOBS_KEY] || [];
}

/** Stores a bounded, newest-first download history. */
async function saveDownloadJobs(jobs) {
  const sorted = [...jobs]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_DOWNLOAD_JOBS);
  await chrome.storage.local.set({ [DOWNLOAD_JOBS_KEY]: sorted });
  return sorted;
}

/** Creates or merges one download job without discarding existing metadata. */
async function upsertDownloadJob(jobId, changes) {
  const jobs = await getDownloadJobs();
  const existing = jobs.find((job) => job.jobId === jobId) || { jobId, createdAt: Date.now() };
  const definedChanges = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined)
  );
  const updated = {
    ...existing,
    ...definedChanges,
    jobId,
    updatedAt: Date.now()
  };
  await saveDownloadJobs([updated, ...jobs.filter((job) => job.jobId !== jobId)]);
  return updated;
}

/** Serializes rapid native progress events so an older storage write cannot replace a newer one. */
function queueDownloadJobUpdate(jobId, changes) {
  jobStorageQueue = jobStorageQueue
    .catch(() => undefined)
    .then(() => upsertDownloadJob(jobId, changes));
  return jobStorageQueue;
}

/** Coalesces frequent progress writes while allowing lifecycle changes to persist immediately. */
function persistNativeJobUpdate(jobId, changes, immediate) {
  const pending = pendingProgressStorage.get(jobId);
  const mergedChanges = { ...(pending?.changes || {}), ...changes };
  if (immediate) {
    if (pending) clearTimeout(pending.timeoutId);
    pendingProgressStorage.delete(jobId);
    return queueDownloadJobUpdate(jobId, mergedChanges);
  }
  if (pending) {
    pending.changes = mergedChanges;
    return Promise.resolve();
  }
  const entry = { changes: mergedChanges, timeoutId: undefined };
  entry.timeoutId = setTimeout(() => {
    pendingProgressStorage.delete(jobId);
    void queueDownloadJobUpdate(jobId, entry.changes);
  }, 750);
  pendingProgressStorage.set(jobId, entry);
  return Promise.resolve();
}

/** Coalesces progress broadcasts so an open popup cannot overwhelm native messaging. */
function broadcastNativeJobUpdate(update, immediate) {
  const pending = update.jobId ? pendingVisibleUpdates.get(update.jobId) : undefined;
  const mergedUpdate = { ...(pending?.update || {}), ...update };
  if (immediate || !update.jobId) {
    if (pending) clearTimeout(pending.timeoutId);
    if (update.jobId) pendingVisibleUpdates.delete(update.jobId);
    void broadcastCompanionUpdate(mergedUpdate);
    return;
  }
  if (pending) {
    pending.update = mergedUpdate;
    return;
  }
  const entry = { update: mergedUpdate, timeoutId: undefined };
  entry.timeoutId = setTimeout(() => {
    pendingVisibleUpdates.delete(update.jobId);
    void broadcastCompanionUpdate(entry.update);
  }, VISIBLE_UPDATE_INTERVAL_MS);
  pendingVisibleUpdates.set(update.jobId, entry);
}

/** Connects to the installed companion and wires its lifecycle to extension updates. */
function getNativePort() {
  if (nativePort) {
    return nativePort;
  }

  nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  nativePort.onMessage.addListener((message) => {
    void handleNativeMessage(message);
  });
  nativePort.onDisconnect.addListener(() => {
    const errorMessage = chrome.runtime.lastError?.message || "The local companion disconnected.";
    nativePort = undefined;
    pendingLogRequests.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.resolve({ error: errorMessage });
    });
    pendingLogRequests.clear();
    downloadTabs.forEach((tabId, jobId) => {
      void chrome.action.setBadgeText({ tabId, text: "!" });
      void chrome.action.setBadgeBackgroundColor({ tabId, color: "#dc2626" });
      void handleNativeMessage({
        type: "downloadUpdate",
        jobId,
        status: "error",
        message: errorMessage
      });
    });
    downloadTabs.clear();
    void broadcastCompanionUpdate({
      type: "companionStatus",
      status: "disconnected",
      message: errorMessage
    });
  });
  return nativePort;
}

/** Broadcasts companion progress immediately, then persists it without blocking the visible UI. */
async function handleNativeMessage(update) {
  if (update.type === "downloadLog") {
    const pending = pendingLogRequests.get(update.jobId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingLogRequests.delete(update.jobId);
      pending.resolve(update.status === "ready"
        ? { logText: update.logText, logPath: update.logPath }
        : { error: update.message });
    }
    return;
  }
  if (update.type === "companionStatus") {
    nativeProtocolVersion = update.protocolVersion || 0;
  }
  const tabId = downloadTabs.get(update.jobId);
  const frequentUpdate = Boolean(update.jobId) &&
    (["downloading", "preparing", "processing"].includes(update.status) || !update.status);
  broadcastNativeJobUpdate(update, !frequentUpdate);
  if (update.jobId) {
    await persistNativeJobUpdate(update.jobId, {
      status: update.status || undefined,
      percent: Number.isFinite(update.percent) ? update.percent : undefined,
      message: update.message,
      outputDirectory: update.outputDirectory,
      title: update.title || undefined,
      thumbnailUrl: update.thumbnailUrl || undefined,
      duration: update.duration || undefined,
      logPath: update.logPath || undefined
    }, !frequentUpdate);
  }

  if (tabId !== undefined) {
    let badgeText = "";
    if (update.status === "downloading" && Number.isFinite(update.percent)) {
      badgeText = `${Math.round(update.percent)}%`;
    } else if (["queued", "started", "metadata"].includes(update.status)) {
      badgeText = "...";
    } else if (update.status === "completed") {
      badgeText = "OK";
      downloadTabs.delete(update.jobId);
    } else if (["error", "cancelled"].includes(update.status)) {
      badgeText = "!";
      downloadTabs.delete(update.jobId);
    }

    // Avoid repeating extension API calls until the user-visible badge text changes.
    if (downloadBadgeText.get(update.jobId) !== badgeText) {
      downloadBadgeText.set(update.jobId, badgeText);
      await chrome.action.setBadgeText({ tabId, text: badgeText });
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: update.status === "error" ? "#dc2626" : "#2563eb"
      });
    }
    if (FINISHED_STATUSES.has(update.status)) downloadBadgeText.delete(update.jobId);
  }
}

/** Sends a companion update to extension pages without failing when no popup is open. */
async function broadcastCompanionUpdate(update) {
  try {
    await chrome.runtime.sendMessage({ type: "COMPANION_UPDATE", update });
  } catch {
    // Runtime messages have no recipient while the popup is closed.
  }
}

/** Starts a direct Chrome download and registers it in the shared download manager. */
async function startBrowserDownload(message) {
  const downloadId = await chrome.downloads.download({
    url: message.url,
    filename: message.filename,
    saveAs: true
  });
  const jobId = `browser-${downloadId}`;
  await queueDownloadJobUpdate(jobId, {
    source: "browser",
    downloadId,
    tabId: message.tabId,
    url: message.url,
    title: message.title || message.filename || "Direct media file",
    thumbnailUrl: message.thumbnailUrl || "",
    status: "downloading",
    message: "Chrome is downloading this file.",
    percent: 0,
    outputDirectory: ""
  });
  await updateBrowserDownload(downloadId);
  return { downloadId, jobId };
}

/** Converts Chrome download changes into the same persistent lifecycle used by yt-dlp jobs. */
async function updateBrowserDownload(downloadId) {
  const jobs = await getDownloadJobs();
  const job = jobs.find((candidate) => candidate.downloadId === downloadId);
  if (!job) return;
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (!download) return;
  const percent = download.totalBytes > 0
    ? Math.min(100, (download.bytesReceived / download.totalBytes) * 100)
    : job.percent;
  const status = download.state === "complete"
    ? "completed"
    : download.state === "interrupted" ? "error" : "downloading";
  const message = status === "completed"
    ? `Saved ${download.filename.split(/[\\/]/).pop()}`
    : status === "error" ? (download.error || "Chrome download was interrupted.") : "Chrome is downloading this file.";
  await queueDownloadJobUpdate(job.jobId, {
    status,
    percent: status === "completed" ? 100 : percent,
    message,
    outputDirectory: download.filename || job.outputDirectory
  });
  await broadcastCompanionUpdate({ type: "downloadUpdate", jobId: job.jobId, status, percent, message });
}

/** Polls active direct downloads because Chrome omits byte-only changes from onChanged events. */
async function refreshActiveBrowserDownloads() {
  const jobs = await getDownloadJobs();
  const activeDownloadIds = jobs
    .filter((job) => job.source === "browser" && !FINISHED_STATUSES.has(job.status))
    .map((job) => job.downloadId)
    .filter(Number.isInteger);
  for (const downloadId of activeDownloadIds) {
    await updateBrowserDownload(downloadId);
  }
}

/** Posts a structured message to the native host and returns a readable connection error. */
function postNativeMessage(message) {
  try {
    getNativePort().postMessage(message);
    return "";
  } catch (error) {
    nativePort = undefined;
    return error.message;
  }
}

/** Requests a bounded diagnostic log from the companion and times out if it stops responding. */
function requestDownloadLog(jobId) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingLogRequests.delete(jobId);
      resolve({ error: "The companion did not return the diagnostic log within 10 seconds." });
    }, 10000);
    pendingLogRequests.set(jobId, { resolve, timeoutId });
    const error = postNativeMessage({ type: "getLog", jobId });
    if (error) {
      clearTimeout(timeoutId);
      pendingLogRequests.delete(jobId);
      resolve({ error });
    }
  });
}

/** Recovers a companion job's latest state from its durable diagnostic log. */
function inferCompanionJobUpdate(logText) {
  const completedMatches = Array.from(logText.matchAll(/Job completed\. File=([^\r\n]+)/g));
  if (completedMatches.length) {
    const filePath = completedMatches.at(-1)[1].trim();
    const fileName = filePath.split(/[\\/]/).pop();
    return { status: "completed", percent: 100, message: fileName ? `Saved ${fileName}` : "Download completed." };
  }
  if (/Job cancelled by the user or Chrome\./i.test(logText)) {
    return { status: "cancelled", message: "Download cancelled." };
  }
  if (/yt-dlp exited with code [1-9]\d*\./i.test(logText) || /\[error\]/i.test(logText)) {
    return { status: "error", message: "Download failed. Copy the diagnostic log for details." };
  }
  const progressMatches = Array.from(logText.matchAll(/\[MediaFinder\]\s*([\d.]+)%\|([^\r\n]*)/g));
  if (progressMatches.length) {
    const latest = progressMatches.at(-1);
    return {
      status: "downloading",
      percent: Number(latest[1]),
      message: `Downloading ${latest[1]}% • ${latest[2].replaceAll("|", " • ").trim()}`
    };
  }
  if (/yt-dlp process started\. PID=/i.test(logText)) {
    return { status: "started", message: "yt-dlp is running; waiting for media details." };
  }
  return undefined;
}

/** Reconciles jobs after popup or service-worker sleep by reading companion-owned logs. */
async function reconcileCompanionDownloadJobs() {
  const jobs = await getDownloadJobs();
  const activeJobs = jobs
    .filter((job) => job.source === "companion" && !FINISHED_STATUSES.has(job.status))
    .slice(0, 10);
  await Promise.all(activeJobs.map(async (job) => {
    const response = await requestDownloadLog(job.jobId);
    if (!response.logText) return;
    const changes = inferCompanionJobUpdate(response.logText);
    if (changes) await queueDownloadJobUpdate(job.jobId, changes);
  }));
}

/** Reads only cookies Chrome would send to the requested media or page URLs. */
async function getChromeSessionCookies(urls) {
  const byIdentity = new Map();
  const validUrls = Array.from(new Set(
    urls.filter((candidate) => /^https?:/i.test(candidate || ""))
  ));
  const validHosts = validUrls.map((url) => new URL(url).hostname.toLowerCase());
  const domainQueries = new Set(validHosts);
  validHosts.forEach((host) => {
    const labels = host.split(".");
    if (labels.length > 2) domainQueries.add(labels.slice(-2).join("."));
  });

  const cookieGroups = [];
  for (const url of validUrls) {
    cookieGroups.push(await chrome.cookies.getAll({ url }));
  }
  for (const domain of domainQueries) {
    cookieGroups.push(await chrome.cookies.getAll({ domain }));
  }

  cookieGroups.flat().forEach((cookie) => {
    const cookieDomain = cookie.domain.replace(/^\./, "").toLowerCase();
    const domainMatches = validHosts.some(
      (host) => host === cookieDomain || host.endsWith(`.${cookieDomain}`)
    );
    if (domainMatches) {
      const identity = `${cookie.storeId}:${cookie.domain}:${cookie.path}:${cookie.name}`;
      byIdentity.set(identity, {
        domain: cookie.domain,
        hostOnly: cookie.hostOnly,
        path: cookie.path,
        secure: cookie.secure,
        expirationDate: cookie.expirationDate || 0,
        name: cookie.name,
        value: cookie.value
      });
    }
  });
  const selected = [];
  let characterCount = 0;
  for (const cookie of byIdentity.values()) {
    const cookieSize = cookie.domain.length + cookie.path.length + cookie.name.length + cookie.value.length;
    if (selected.length >= 300 || characterCount + cookieSize > 250000) break;
    selected.push(cookie);
    characterCount += cookieSize;
  }
  return selected;
}

/** Returns the session-storage key used for a browser tab's discoveries. */
function storageKey(tabId) {
  return `media:${tabId}`;
}

/** Reads all media candidates currently associated with a browser tab. */
async function getTabMedia(tabId) {
  const key = storageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] || [];
}

/** Merges candidates by discovery method and URL, preserving page/network separation and network occurrence counts. */
async function saveTabMedia(tabId, incomingItems) {
  if (tabId < 0 || !incomingItems.length) {
    return getTabMedia(tabId);
  }

  const existingItems = await getTabMedia(tabId);
  const candidateKey = (item) => `${MediaUtils.getDiscoveryGroup(item.source)}:${item.url}`;
  const byKey = new Map(existingItems.map((item) => [candidateKey(item), item]));

  incomingItems.forEach((incoming) => {
    const url = MediaUtils.normalizeUrl(incoming.url);
    if (!url) {
      return;
    }

    const key = `${MediaUtils.getDiscoveryGroup(incoming.source)}:${url}`;
    const existing = byKey.get(key) || {};
    const isRepeatedNetworkUrl = MediaUtils.getDiscoveryGroup(incoming.source) === "network" && byKey.has(key);
    const contentType = incoming.contentType || existing.contentType || "";
    byKey.set(key, {
      ...existing,
      ...incoming,
      url,
      contentType,
      kind: MediaUtils.classifyMedia(url, contentType),
      discoveredAt: incoming.discoveredAt || Date.now(),
      occurrences: isRepeatedNetworkUrl ? (existing.occurrences || 1) + 1 : (existing.occurrences || 1)
    });
  });

  const mergedItems = Array.from(byKey.values())
    .sort((a, b) => b.discoveredAt - a.discoveredAt)
    .slice(0, MAX_ITEMS_PER_TAB);

  await chrome.storage.session.set({ [storageKey(tabId)]: mergedItems });
  await chrome.action.setBadgeText({
    tabId,
    text: mergedItems.length ? String(Math.min(mergedItems.length, 99)) : ""
  });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  return mergedItems;
}

/** Clears page discoveries on every top-level navigation and optionally preserves network captures when the user requested it. */
async function clearTabMediaOnNavigation(tabId) {
  const stored = await chrome.storage.local.get(CLEAR_NETWORK_ON_NAVIGATION_KEY);
  const shouldClearNetwork = stored[CLEAR_NETWORK_ON_NAVIGATION_KEY] !== false;
  const remainingItems = (await getTabMedia(tabId)).filter(
    (item) => !shouldClearNetwork && MediaUtils.getDiscoveryGroup(item.source) === "network"
  );
  if (remainingItems.length) {
    await chrome.storage.session.set({ [storageKey(tabId)]: remainingItems });
  } else {
    await chrome.storage.session.remove(storageKey(tabId));
  }
  await chrome.action.setBadgeText({
    tabId,
    text: remainingItems.length ? String(Math.min(remainingItems.length, 99)) : ""
  });
}

/** Clears stale tab discoveries only for a top-level browser navigation event. */
function handleTopLevelNavigation(details) {
  if (details.frameId === 0) void clearTabMediaOnNavigation(details.tabId);
}

/** Finds a response Content-Type header regardless of header-name casing. */
function readContentType(responseHeaders = []) {
  const header = responseHeaders.find(
    (candidate) => candidate.name.toLowerCase() === "content-type"
  );
  return header?.value || "";
}

/** Records request/response metadata when it represents recognizable media. */
function recordNetworkCandidate(details, contentType = "") {
  if (details.tabId < 0 || MediaUtils.isStreamSegment(details.url)) {
    return;
  }

  const kind = MediaUtils.classifyMedia(details.url, contentType);
  if (details.type !== "media" && kind === "unknown") {
    return;
  }

  void saveTabMedia(details.tabId, [{
    url: details.url,
    contentType,
    kind,
    source: "network",
    discoveredAt: Date.now()
  }]);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => recordNetworkCandidate(details),
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => recordNetworkCandidate(details, readContentType(details.responseHeaders)),
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clears before a full page load and when a single-page app changes its top-level route.
chrome.webNavigation.onBeforeNavigate.addListener(handleTopLevelNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(handleTopLevelNavigation);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "MEDIA_FOUND" && sender.tab?.id !== undefined) {
    saveTabMedia(sender.tab.id, message.items).then((items) => sendResponse({ items }));
    return true;
  }

  if (message.type === "GET_MEDIA") {
    getTabMedia(message.tabId).then((items) => sendResponse({ items }));
    return true;
  }

  if (message.type === "CLEAR_MEDIA") {
    chrome.storage.session.remove(storageKey(message.tabId)).then(async () => {
      await chrome.action.setBadgeText({ tabId: message.tabId, text: "" });
      sendResponse({ items: [] });
    });
    return true;
  }

  if (message.type === "DOWNLOAD_MEDIA") {
    startBrowserDownload(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ error: error.message })
    );
    return true;
  }

  if (message.type === "CHECK_COMPANION") {
    const error = postNativeMessage({ type: "ping" });
    sendResponse({ connected: !error, error });
    return false;
  }

  if (message.type === "GET_DOWNLOAD_JOBS") {
    Promise.all([refreshActiveBrowserDownloads(), reconcileCompanionDownloadJobs()])
      .then(() => getDownloadJobs())
      .then((jobs) => sendResponse({ jobs }));
    return true;
  }

  if (message.type === "CLEAR_FINISHED_DOWNLOADS") {
    getDownloadJobs().then((jobs) => saveDownloadJobs(
      jobs.filter((job) => !FINISHED_STATUSES.has(job.status))
    )).then((remaining) => sendResponse({ jobs: remaining }));
    return true;
  }

  if (message.type === "GET_DOWNLOAD_LOG") {
    requestDownloadLog(message.jobId).then(sendResponse);
    return true;
  }

  if (message.type === "START_COMPANION_DOWNLOAD") {
    if (nativeProtocolVersion > 0 && nativeProtocolVersion < 6) {
      sendResponse({
        jobId: "",
        error: "Update the local companion before starting a download with this extension version."
      });
      return false;
    }
    const jobId = crypto.randomUUID();
    queueDownloadJobUpdate(jobId, {
      source: "companion",
      tabId: message.tabId,
      url: message.url,
      title: message.title || "Untitled media",
      thumbnailUrl: message.thumbnailUrl || "",
      status: "queued",
      message: "Waiting for yt-dlp...",
      percent: 0,
      outputDirectory: ""
    }).then(async () => {
      let cookies = [];
      let resolvedCookieSourceUrl = message.cookieSourceUrl || "";
      const platform = await chrome.runtime.getPlatformInfo();
      const useChromeSessionCookies =
        message.options?.cookiesBrowser === "chrome" && platform.os === "win";
      if (useChromeSessionCookies) {
        try {
          let liveTabUrl = "";
          try {
            liveTabUrl = (await chrome.tabs.get(message.tabId)).url || "";
          } catch {
            // The tab may have closed after the user started the download.
          }
          resolvedCookieSourceUrl = resolvedCookieSourceUrl || liveTabUrl;
          const cookieUrls = [message.url, resolvedCookieSourceUrl, liveTabUrl];
          cookies = await getChromeSessionCookies(cookieUrls);
          if (!cookies.length) {
            const hostnames = Array.from(new Set(
              cookieUrls
                .filter((url) => /^https?:/i.test(url || ""))
                .map((url) => new URL(url).hostname)
            ));
            throw new Error(
              `No Chrome session cookies matched ${hostnames.join(" or ") || "this page"}. ` +
              "Reload the extension after accepting its Cookies permission, then retry."
            );
          }
        } catch (error) {
          await handleNativeMessage({
            type: "downloadUpdate",
            jobId,
            status: "error",
            message: error.message
          });
          sendResponse({ jobId: "", error: error.message });
          return;
        }
      }

      const error = postNativeMessage({
        type: "download",
        jobId,
        url: message.url,
        title: message.title || "",
        cookieSourceUrl: resolvedCookieSourceUrl,
        useChromeSessionCookies,
        cookies,
        options: message.options
      });
      if (!error) {
        downloadTabs.set(jobId, message.tabId);
        await handleNativeMessage({
          type: "downloadUpdate",
          jobId,
          status: "started",
          message: "Download handed to the local companion.",
          title: message.title || undefined
        });
      } else {
        void handleNativeMessage({ type: "downloadUpdate", jobId, status: "error", message: error });
      }
      sendResponse({ jobId: error ? "" : jobId, error });
    });
    return true;
  }

  if (message.type === "CANCEL_COMPANION_DOWNLOAD") {
    const error = postNativeMessage({ type: "cancel", jobId: message.jobId });
    sendResponse({ cancelled: !error, error });
    return false;
  }

  if (message.type === "CANCEL_DOWNLOAD_JOB") {
    getDownloadJobs().then(async (jobs) => {
      const job = jobs.find((candidate) => candidate.jobId === message.jobId);
      if (job?.source === "browser" && Number.isInteger(job.downloadId)) {
        await chrome.downloads.cancel(job.downloadId);
        await queueDownloadJobUpdate(job.jobId, { status: "cancelled", message: "Download cancelled." });
        await broadcastCompanionUpdate({
          type: "downloadUpdate",
          jobId: job.jobId,
          status: "cancelled",
          message: "Download cancelled."
        });
        sendResponse({ cancelled: true });
        return;
      }
      const error = postNativeMessage({ type: "cancel", jobId: message.jobId });
      sendResponse({ cancelled: !error, error });
    }).catch((error) => sendResponse({ cancelled: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(storageKey(tabId));
});

chrome.downloads.onChanged.addListener((delta) => {
  void updateBrowserDownload(delta.id);
});
