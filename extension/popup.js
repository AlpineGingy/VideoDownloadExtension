"use strict";

const listElement = document.querySelector("#media-list");
const emptyElement = document.querySelector("#empty-state");
const countElement = document.querySelector("#item-count");
const noticeElement = document.querySelector("#notice");
const companionHelpElement = document.querySelector("#companion-help");
const openSetupButton = document.querySelector("#open-setup");
const refreshButton = document.querySelector("#refresh");
const settingsButton = document.querySelector("#settings");
const pageYtDlpButton = document.querySelector("#page-yt-dlp");
const clearButton = document.querySelector("#clear");
const pageTitleElement = document.querySelector("#page-title");
const findPanel = document.querySelector("#find-panel");
const downloadsPanel = document.querySelector("#downloads-panel");
const findFooter = document.querySelector("#find-footer");
const downloadListElement = document.querySelector("#download-list");
const downloadsEmptyElement = document.querySelector("#downloads-empty");
const downloadCountElement = document.querySelector("#download-count");
const clearFinishedButton = document.querySelector("#clear-finished");
const networkFiltersElement = document.querySelector("#network-filters");
const networkSearchElement = document.querySelector("#network-search");
const kindFilterElement = document.querySelector("#kind-filter");
const sourceFilterElement = document.querySelector("#source-filter");
const pageCountElement = document.querySelector("#page-count");
const networkCountElement = document.querySelector("#network-count");
const mainTabElements = Array.from(document.querySelectorAll(".main-tab"));
const sourceTabElements = Array.from(document.querySelectorAll(".source-tab"));
const ytDlpDialog = document.querySelector("#yt-dlp-dialog");
const ytDlpForm = document.querySelector("#yt-dlp-form");
const dialogTitleElement = document.querySelector("#dialog-title");
const dialogDescriptionElement = document.querySelector("#dialog-description");
const submitOptionsButton = document.querySelector("#submit-options");
const shellOptionElement = document.querySelector("#shell-option");
const cookiesBrowserElement = document.querySelector("#cookies-browser");
const qualityOptionElement = document.querySelector("#quality-option");
const containerOptionElement = document.querySelector("#container-option");
const fragmentsOptionElement = document.querySelector("#fragments-option");
const filenameStyleElement = document.querySelector("#filename-style");
const outputFolderElement = document.querySelector("#output-folder");
const metadataOptionElement = document.querySelector("#metadata-option");
const thumbnailOptionElement = document.querySelector("#thumbnail-option");
const subtitlesOptionElement = document.querySelector("#subtitles-option");
const closeYtDlpButton = document.querySelector("#close-yt-dlp");
const cancelYtDlpButton = document.querySelector("#cancel-yt-dlp");
const copyCommandButton = document.querySelector("#copy-command");
const settingsCompanionElement = document.querySelector("#settings-companion");
const downloadCompanionButton = document.querySelector("#download-companion");
const settingsDiscoveryElement = document.querySelector("#settings-discovery");
const clearNetworkOnNavigationElement = document.querySelector("#clear-network-on-navigation");

const YT_DLP_SETTINGS_KEY = "ytDlpCommandOptions";
const CLEAR_NETWORK_ON_NAVIGATION_KEY = "clearNetworkOnNavigation";
const DOWNLOAD_JOBS_KEY = "companionDownloadJobs";
const FINISHED_STATUSES = new Set(["completed", "error", "cancelled"]);
const DOWNLOAD_RENDER_INTERVAL_MS = 500;
const DEFAULT_YT_DLP_OPTIONS = {
  shell: /Mac|Linux/i.test(navigator.platform) ? "posix" : "powershell",
  cookiesBrowser: "none",
  quality: "best",
  container: "auto",
  concurrentFragments: 8,
  filenameStyle: "pageTitle",
  outputFolder: "mediaFinder",
  embedMetadata: false,
  embedThumbnail: false,
  embedEnglishSubtitles: false
};

let activeTab;
let mainView = "find";
let sourceView = "page";
let allItems = [];
let downloadJobs = [];
let selectedYtDlpItem;
let platformOs = "";
let downloadRenderTimeoutId;
let downloadRenderPending = false;

/** Displays a short status or error message above the active view. */
function showNotice(message) {
  noticeElement.textContent = message;
  noticeElement.hidden = !message;
}

/** Shows the one-time companion setup prompt only when local downloads are unavailable. */
function showCompanionHelp(visible) {
  companionHelpElement.hidden = !visible;
}

/** Returns user-facing guidance for a discovered media candidate. */
function getMediaHint(item) {
  if (item.kind === "manifest") return "Stream playlist. yt-dlp can assemble its segments.";
  if (item.kind === "blob") return "Temporary page URL. Play it and check Network instead.";
  if (item.kind === "audio") return "Direct audio file.";
  if (item.kind === "unknown") return "Media-like request with an unconfirmed format.";
  return "Direct media file.";
}

/** Converts a detector source into a compact, readable label. */
function getSourceLabel(source) {
  if (source === "network") return "Live request";
  if (source === "performance") return "Page history";
  return "Page HTML";
}

/** Copies text and briefly confirms the result on its button. */
async function copyWithFeedback(text, button, originalLabel) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = originalLabel; }, 1200);
  } catch {
    showNotice("Chrome could not copy that value to the clipboard.");
  }
}

/** Reads the current form values into the companion's allow-listed option shape. */
function getYtDlpOptions() {
  return {
    shell: shellOptionElement.value,
    cookiesBrowser: cookiesBrowserElement.value,
    quality: qualityOptionElement.value,
    container: containerOptionElement.value,
    concurrentFragments: Number(fragmentsOptionElement.value),
    filenameStyle: filenameStyleElement.value,
    outputFolder: outputFolderElement.value,
    embedMetadata: metadataOptionElement.checked,
    embedThumbnail: thumbnailOptionElement.checked,
    embedEnglishSubtitles: subtitlesOptionElement.checked
  };
}

/** Applies remembered yt-dlp preferences to every options control. */
function applyYtDlpOptions(options) {
  shellOptionElement.value = options.shell;
  cookiesBrowserElement.value = options.cookiesBrowser;
  qualityOptionElement.value = options.quality;
  containerOptionElement.value = options.container;
  fragmentsOptionElement.value = String(options.concurrentFragments);
  filenameStyleElement.value = options.filenameStyle;
  outputFolderElement.value = options.outputFolder;
  metadataOptionElement.checked = options.embedMetadata;
  thumbnailOptionElement.checked = options.embedThumbnail;
  subtitlesOptionElement.checked = options.embedEnglishSubtitles;
  updateYtDlpCompatibility();
}

/** Disables choices that do not apply to audio-only extraction. */
function updateYtDlpCompatibility() {
  const isAudioOnly = qualityOptionElement.value === "audio";
  const usesChromeSession = cookiesBrowserElement.value === "chrome" && platformOs === "win";
  containerOptionElement.disabled = isAudioOnly;
  subtitlesOptionElement.disabled = isAudioOnly;
  copyCommandButton.disabled = usesChromeSession;
  copyCommandButton.title = usesChromeSession
    ? "Chrome session cookies are available only through Download, not a copied terminal command."
    : "Copy this yt-dlp command";
}

/** Requests sensitive cookie access only for the Windows Chrome-session fallback. */
async function ensureChromeCookiePermission(options) {
  if (options.cookiesBrowser !== "chrome") return true;
  const platform = await chrome.runtime.getPlatformInfo();
  if (platform.os !== "win") return true;
  const permission = { permissions: ["cookies"] };
  if (await chrome.permissions.contains(permission)) return true;
  return chrome.permissions.request(permission);
}

/** Loads saved download and discovery preferences without storing any media URL. */
async function loadYtDlpOptions() {
  const stored = await chrome.storage.local.get([YT_DLP_SETTINGS_KEY, CLEAR_NETWORK_ON_NAVIGATION_KEY]);
  applyYtDlpOptions({
    ...DEFAULT_YT_DLP_OPTIONS,
    ...(stored[YT_DLP_SETTINGS_KEY] || {})
  });
  clearNetworkOnNavigationElement.checked = stored[CLEAR_NETWORK_ON_NAVIGATION_KEY] !== false;
}

/** Opens the same focused dialog for either settings or one customized download. */
function openYtDlpDialog(item) {
  selectedYtDlpItem = item;
  const isDownload = Boolean(item);
  dialogTitleElement.textContent = isDownload ? "Download options" : "Download settings";
  dialogDescriptionElement.textContent = isDownload
    ? "Adjust this download. These choices become your defaults."
    : "Choose defaults for one-click downloads.";
  submitOptionsButton.textContent = isDownload ? "Download" : "Save settings";
  copyCommandButton.hidden = !isDownload;
  settingsCompanionElement.hidden = isDownload;
  settingsDiscoveryElement.hidden = isDownload;
  ytDlpDialog.showModal();
}

/** Closes the options dialog and clears its temporary media selection. */
function closeYtDlpDialog() {
  if (ytDlpDialog.open) ytDlpDialog.close();
  selectedYtDlpItem = undefined;
}

/** Opens the persistent companion setup page from any popup entry point. */
function openCompanionSetupPage() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
}

/** Creates a real thumbnail image only when the page or yt-dlp supplied one. */
function createThumbnail(url, className, alt) {
  if (!/^https?:/i.test(url || "")) return null;
  const image = document.createElement("img");
  image.className = className;
  image.src = url;
  image.alt = alt;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => image.remove());
  return image;
}

/** Creates one accessible media result card without injecting untrusted markup. */
function createMediaItem(item) {
  const listItem = document.createElement("li");
  listItem.className = "media-item";
  const content = document.createElement("div");
  content.className = "media-content";
  const thumbnail = createThumbnail(item.thumbnailUrl, "media-thumbnail", "Media preview");
  const details = document.createElement("div");
  details.className = "media-details";
  const heading = document.createElement("div");
  heading.className = "media-heading";
  const badgeGroup = document.createElement("div");
  badgeGroup.className = "badge-group";
  const kindBadge = document.createElement("span");
  kindBadge.className = "kind-badge";
  kindBadge.textContent = item.kind;
  const formatBadge = document.createElement("span");
  formatBadge.className = "format-badge";
  formatBadge.textContent = (MediaUtils.inferMediaExtension(item.url, item.contentType) || "no ext").toUpperCase();
  badgeGroup.append(kindBadge, formatBadge);
  if (item.occurrences > 1) {
    const occurrenceBadge = document.createElement("span");
    occurrenceBadge.className = "format-badge";
    occurrenceBadge.textContent = `×${item.occurrences}`;
    occurrenceBadge.title = `Seen ${item.occurrences} times`;
    badgeGroup.append(occurrenceBadge);
  }
  const source = document.createElement("span");
  source.className = "source-label";
  source.textContent = getSourceLabel(item.source);
  heading.append(badgeGroup, source);
  const url = document.createElement(item.url.startsWith("blob:") ? "span" : "a");
  url.className = "media-url";
  url.title = item.url;
  url.textContent = item.url;
  if (url instanceof HTMLAnchorElement) {
    url.href = item.url;
    url.target = "_blank";
    url.rel = "noreferrer";
  }
  const hint = document.createElement("p");
  hint.className = "media-hint";
  hint.textContent = getMediaHint(item);
  details.append(heading, url, hint);
  if (thumbnail) content.append(thumbnail);
  content.append(details);

  const actions = document.createElement("div");
  actions.className = "media-actions";
  if (item.kind !== "blob") {
    const downloadButton = document.createElement("button");
    downloadButton.className = "button primary";
    downloadButton.type = "button";
    downloadButton.textContent = "Download";
    downloadButton.addEventListener("click", () => void startCompanionDownload(item));
    actions.append(downloadButton);
    if (["direct", "audio"].includes(item.kind)) {
      const directButton = document.createElement("button");
      directButton.className = "button secondary";
      directButton.type = "button";
      directButton.textContent = "Save as-is";
      directButton.title = "Use Chrome's download manager without conversion";
      directButton.addEventListener("click", () => void downloadMedia(item, directButton));
      actions.append(directButton);
    }
    const optionsButton = document.createElement("button");
    optionsButton.className = "button secondary";
    optionsButton.type = "button";
    optionsButton.textContent = "Options";
    optionsButton.addEventListener("click", () => openYtDlpDialog(item));
    const copyButton = document.createElement("button");
    copyButton.className = "quiet-button";
    copyButton.type = "button";
    copyButton.textContent = "Copy URL";
    copyButton.addEventListener("click", () => void copyWithFeedback(item.url, copyButton, "Copy URL"));
    actions.append(optionsButton, copyButton);
  }
  listItem.append(content, actions);
  return listItem;
}

/** Starts a fast direct-file download and adds it to the persistent manager. */
async function downloadMedia(item, button) {
  button.disabled = true;
  button.textContent = "Opening...";
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_MEDIA",
    tabId: activeTab.id,
    url: item.url,
    filename: MediaUtils.suggestFilename(item.url, activeTab.title, item.contentType),
    title: item.pageTitle || activeTab.title,
    thumbnailUrl: item.thumbnailUrl || ""
  });
  if (response.error) {
    showNotice(`Download failed: ${response.error}`);
    button.disabled = false;
    button.textContent = "Save as-is";
    return;
  }
  await loadDownloadJobs();
  selectMainView("downloads");
}

/** Returns the currently selected network search and filters. */
function getNetworkFilters() {
  return { query: networkSearchElement.value, kind: kindFilterElement.value, source: sourceFilterElement.value };
}

/** Renders the selected HTML or Network discovery list and both totals. */
function renderItems() {
  const pageItems = allItems.filter((item) => MediaUtils.getDiscoveryGroup(item.source) === "page");
  const networkItems = allItems.filter((item) => MediaUtils.getDiscoveryGroup(item.source) === "network");
  const visibleItems = sourceView === "page" ? pageItems : MediaUtils.filterNetworkItems(networkItems, getNetworkFilters());
  const currentTotal = sourceView === "page" ? pageItems.length : networkItems.length;
  pageCountElement.textContent = String(pageItems.length);
  networkCountElement.textContent = String(networkItems.length);
  networkFiltersElement.hidden = sourceView !== "network";
  listElement.replaceChildren(...visibleItems.map(createMediaItem));
  emptyElement.hidden = visibleItems.length > 0;
  if (!visibleItems.length) {
    const filtered = sourceView === "network" && currentTotal > 0;
    emptyElement.querySelector(".empty-title").textContent = filtered
      ? "No results match these filters"
      : `No ${sourceView === "page" ? "page" : "network"} media found yet`;
  }
  countElement.textContent = visibleItems.length === currentTotal
    ? `${currentTotal} ${currentTotal === 1 ? "item" : "items"}`
    : `${visibleItems.length} of ${currentTotal} items`;
}

/** Switches between the small HTML and Network lists without losing filters. */
function selectSourceView(view) {
  sourceView = view;
  sourceTabElements.forEach((tab) => {
    const active = tab.dataset.sourceView === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  renderItems();
}

/** Switches the popup between discovery and the persistent download manager. */
function selectMainView(view) {
  mainView = view;
  mainTabElements.forEach((tab) => {
    const active = tab.dataset.mainView === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  findPanel.hidden = view !== "find";
  downloadsPanel.hidden = view !== "downloads";
  findFooter.hidden = view !== "find";
  refreshButton.hidden = view !== "find";
  if (view === "downloads" && downloadRenderPending) scheduleDownloadJobsRender(true);
  showNotice("");
}

/** Converts raw lifecycle status into a friendly card label. */
function getDownloadStatusLabel(status) {
  return ({ queued: "Queued", started: "Preparing", preparing: "Preparing", metadata: "Preparing", downloading: "Downloading", processing: "Processing", completed: "Complete", error: "Failed", cancelled: "Cancelled", cancelling: "Cancelling" })[status] || "Preparing";
}

/** Requests a job's native diagnostic text and copies it for troubleshooting. */
async function copyDownloadLog(job, button) {
  button.disabled = true;
  button.textContent = "Loading...";
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_LOG", jobId: job.jobId });
    if (response.error || !response.logText) {
      throw new Error(response.error || "The diagnostic log is empty.");
    }
    const diagnostic = `Media Finder diagnostic log\nFile: ${response.logPath || job.logPath}\n\n${response.logText}`;
    await navigator.clipboard.writeText(diagnostic);
    button.textContent = "Copied";
    showNotice("Diagnostic log copied. Review media URLs before sharing it.");
  } catch (error) {
    button.textContent = "Copy log";
    button.disabled = false;
    showNotice(error.message || "The diagnostic log could not be copied.");
  }
}

/** Creates one persistent progress card with cancellation and diagnostic controls. */
function createDownloadJobItem(job) {
  const listItem = document.createElement("li");
  listItem.className = "download-item";
  const content = document.createElement("div");
  content.className = "download-content";
  const thumbnail = createThumbnail(job.thumbnailUrl, "download-thumbnail", `Thumbnail for ${job.title || "download"}`);
  const details = document.createElement("div");
  details.className = "download-details";
  const heading = document.createElement("div");
  heading.className = "download-heading";
  const title = document.createElement("strong");
  title.className = "download-title";
  title.textContent = job.title || "Untitled media";
  title.title = title.textContent;
  const status = document.createElement("span");
  status.className = `status-badge ${job.status || "queued"}`;
  status.textContent = getDownloadStatusLabel(job.status);
  heading.append(title, status);
  const statusRow = document.createElement("div");
  statusRow.className = "download-status-row";
  const message = document.createElement("p");
  message.className = "download-message";
  message.textContent = job.message || "Waiting for yt-dlp...";
  message.title = job.outputDirectory || message.textContent;
  statusRow.append(message);
  details.append(heading, statusRow);
  const progressValue = Number.isFinite(job.percent)
    ? Math.max(0, Math.min(100, job.percent))
    : 0;
  const progressTrack = document.createElement("div");
  progressTrack.className = `download-progress-track ${job.status || "queued"}`;
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.setAttribute("aria-label", `Download progress for ${title.textContent}`);
  progressTrack.setAttribute("aria-valuemin", "0");
  progressTrack.setAttribute("aria-valuemax", "100");
  progressTrack.setAttribute("aria-valuenow", String(Math.round(progressValue)));
  const progressFill = document.createElement("span");
  progressFill.className = "download-progress-fill";
  progressFill.style.width = `${progressValue}%`;
  const progressLabel = document.createElement("span");
  progressLabel.className = "download-progress-value";
  progressLabel.textContent = `${Math.round(progressValue)}%`;
  progressTrack.append(progressFill, progressLabel);
  details.append(progressTrack);
  if (thumbnail) content.append(thumbnail);
  content.append(details);
  listItem.append(content);
  if (job.logPath || !FINISHED_STATUSES.has(job.status)) {
    const actions = document.createElement("div");
    actions.className = "download-actions";
    if (job.logPath) {
      const logButton = document.createElement("button");
      logButton.className = "button secondary";
      logButton.type = "button";
      logButton.textContent = "Copy log";
      logButton.title = `Diagnostic file: ${job.logPath}`;
      logButton.addEventListener("click", () => void copyDownloadLog(job, logButton));
      actions.append(logButton);
    }
    if (!FINISHED_STATUSES.has(job.status)) {
      const cancelButton = document.createElement("button");
      cancelButton.className = "button danger";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", async () => {
        cancelButton.disabled = true;
        await chrome.runtime.sendMessage({ type: "CANCEL_DOWNLOAD_JOB", jobId: job.jobId });
      });
      actions.append(cancelButton);
    }
    listItem.append(actions);
  }
  return listItem;
}

/** Renders all jobs newest first and keeps the top-level count current. */
function renderDownloadJobs() {
  downloadJobs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  downloadListElement.replaceChildren(...downloadJobs.map(createDownloadJobItem));
  downloadsEmptyElement.hidden = downloadJobs.length > 0;
  downloadCountElement.textContent = String(downloadJobs.length);
  clearFinishedButton.disabled = !downloadJobs.some((job) => FINISHED_STATUSES.has(job.status));
}

/** Limits expensive card and thumbnail reconstruction while retaining live progress. */
function scheduleDownloadJobsRender(immediate = false) {
  downloadRenderPending = true;
  if (mainView !== "downloads" && !immediate) return;
  if (immediate) {
    if (downloadRenderTimeoutId) clearTimeout(downloadRenderTimeoutId);
    downloadRenderTimeoutId = undefined;
    downloadRenderPending = false;
    renderDownloadJobs();
    return;
  }
  if (downloadRenderTimeoutId) return;
  downloadRenderTimeoutId = setTimeout(() => {
    downloadRenderTimeoutId = undefined;
    downloadRenderPending = false;
    renderDownloadJobs();
  }, DOWNLOAD_RENDER_INTERVAL_MS);
}

/** Reloads persistent jobs so reopening the popup restores every progress card. */
async function loadDownloadJobs() {
  const response = await chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_JOBS" });
  downloadJobs = response.jobs || [];
  renderDownloadJobs();
}

/** Refreshes direct Chrome downloads while this visible popup can show byte-level progress. */
function pollActiveBrowserDownloads() {
  const hasActiveBrowserDownload = downloadJobs.some(
    (job) => job.source === "browser" && !FINISHED_STATUSES.has(job.status)
  );
  if (hasActiveBrowserDownload) void loadDownloadJobs();
}

/** Applies a background progress event immediately so an open popup repaints in real time. */
function applyDownloadUpdate(update) {
  if (!update.jobId) return;
  const existing = downloadJobs.find((job) => job.jobId === update.jobId) || {
    jobId: update.jobId,
    title: "Untitled media",
    createdAt: Date.now()
  };
  const changes = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
  const merged = { ...existing, ...changes, updatedAt: Date.now() };
  downloadJobs = [merged, ...downloadJobs.filter((job) => job.jobId !== update.jobId)];
  scheduleDownloadJobsRender(FINISHED_STATUSES.has(update.status));
}

/** Reads stored discoveries after requesting a fresh scan from the active page. */
async function scanActiveTab() {
  refreshButton.disabled = true;
  showNotice("");
  let pageItems = [];
  try {
    const pageResponse = await chrome.tabs.sendMessage(activeTab.id, { type: "SCAN_MEDIA" });
    pageItems = pageResponse.items || [];
  } catch {
    showNotice("Page scanning is unavailable on this Chrome tab.");
  }
  const response = await chrome.runtime.sendMessage({ type: "GET_MEDIA", tabId: activeTab.id });
  const combinedItems = new Map();
  [...(response.items || []), ...pageItems].forEach((item) => {
    combinedItems.set(`${MediaUtils.getDiscoveryGroup(item.source)}:${item.url}`, item);
  });
  allItems = Array.from(combinedItems.values());
  renderItems();
  refreshButton.disabled = false;
}

/** Starts one companion download using saved defaults or freshly selected options. */
async function startCompanionDownload(item, options = getYtDlpOptions()) {
  if (!await ensureChromeCookiePermission(options)) {
    showNotice("Chrome cookie access was not approved. Choose no cookies or approve the permission to continue.");
    return;
  }
  await chrome.storage.local.set({ [YT_DLP_SETTINGS_KEY]: options });
  const response = await chrome.runtime.sendMessage({
    type: "START_COMPANION_DOWNLOAD",
    tabId: activeTab.id,
    url: item.url,
    cookieSourceUrl: activeTab.url,
    title: item.pageTitle || activeTab.title || "Untitled media",
    thumbnailUrl: item.thumbnailUrl || "",
    options
  });
  if (response.error || !response.jobId) {
    showNotice(response.error || "The local companion could not start the download.");
    showCompanionHelp(true);
    return;
  }
  closeYtDlpDialog();
  showCompanionHelp(false);
  await loadDownloadJobs();
  selectMainView("downloads");
}

/** Saves defaults or starts the customized media selected in the dialog. */
async function submitOptions() {
  const options = getYtDlpOptions();
  await chrome.storage.local.set({
    [YT_DLP_SETTINGS_KEY]: options,
    [CLEAR_NETWORK_ON_NAVIGATION_KEY]: clearNetworkOnNavigationElement.checked
  });
  if (!selectedYtDlpItem) {
    closeYtDlpDialog();
    showNotice("Download settings saved.");
    return;
  }
  await startCompanionDownload(selectedYtDlpItem, options);
}

/** Copies a platform-appropriate yt-dlp command for the selected item. */
async function copySelectedCommand() {
  if (!selectedYtDlpItem) return;
  const options = getYtDlpOptions();
  await chrome.storage.local.set({ [YT_DLP_SETTINGS_KEY]: options });
  try {
    await navigator.clipboard.writeText(MediaUtils.buildYtDlpCommand(
      selectedYtDlpItem.url,
      options,
      selectedYtDlpItem.pageTitle || activeTab.title || ""
    ));
    closeYtDlpDialog();
    showNotice("yt-dlp command copied for your selected terminal.");
  } catch {
    showNotice("Chrome could not copy the yt-dlp command.");
  }
}

/** Refreshes companion availability and download cards from background updates. */
function handleRuntimeMessage(message) {
  if (message.type !== "COMPANION_UPDATE") return false;
  const update = message.update;
  if (update.type === "companionStatus") {
    const compatible = update.protocolVersion >= 6;
    const isYouTubePage = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(
      new URL(activeTab.url || "https://invalid.local").hostname
    );
    const denoReady = !isYouTubePage || update.denoAvailable !== false;
    const ready = update.status === "ready" && update.ytDlpAvailable !== false && compatible && denoReady;
    showCompanionHelp(!ready);
    if (!compatible && update.status === "ready") {
      showNotice("Update the local companion to use predictable filenames and the latest download features.");
    } else if (!denoReady) {
      showNotice("Deno is required for reliable YouTube downloads. Reinstall the current companion package.");
    } else if (!ready) {
      showNotice(update.message);
    }
    return false;
  }
  applyDownloadUpdate(update);
  if (update.status === "error" && update.message?.includes("yt-dlp")) showCompanionHelp(true);
  return false;
}

/** Loads the active tab, preferences, discoveries, download history, and companion health. */
async function initializePopup() {
  platformOs = (await chrome.runtime.getPlatformInfo()).os;
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageTitleElement.textContent = activeTab.title || "Current tab";
  pageYtDlpButton.disabled = !/^https?:/.test(activeTab.url || "");
  await loadYtDlpOptions();
  await Promise.all([scanActiveTab(), loadDownloadJobs()]);
  await chrome.runtime.sendMessage({ type: "CHECK_COMPANION" });
}

mainTabElements.forEach((tab) => tab.addEventListener("click", () => selectMainView(tab.dataset.mainView)));
sourceTabElements.forEach((tab) => tab.addEventListener("click", () => selectSourceView(tab.dataset.sourceView)));
networkSearchElement.addEventListener("input", renderItems);
kindFilterElement.addEventListener("change", renderItems);
sourceFilterElement.addEventListener("change", renderItems);
qualityOptionElement.addEventListener("change", updateYtDlpCompatibility);
cookiesBrowserElement.addEventListener("change", updateYtDlpCompatibility);
closeYtDlpButton.addEventListener("click", closeYtDlpDialog);
cancelYtDlpButton.addEventListener("click", closeYtDlpDialog);
refreshButton.addEventListener("click", () => void scanActiveTab());
settingsButton.addEventListener("click", () => openYtDlpDialog());
copyCommandButton.addEventListener("click", () => void copySelectedCommand());
openSetupButton.addEventListener("click", () => void openCompanionSetupPage());
downloadCompanionButton.addEventListener("click", () => void openCompanionSetupPage());
pageYtDlpButton.addEventListener("click", () => void startCompanionDownload({
  url: activeTab.url,
  kind: "page",
  source: "page",
  pageTitle: activeTab.title
}));
ytDlpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitOptions();
});
chrome.runtime.onMessage.addListener(handleRuntimeMessage);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[DOWNLOAD_JOBS_KEY]) {
    downloadJobs = changes[DOWNLOAD_JOBS_KEY].newValue || [];
    scheduleDownloadJobsRender();
  }
});
clearButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_MEDIA", tabId: activeTab.id });
  allItems = [];
  renderItems();
  showNotice("Results cleared. Play the media and refresh to capture new requests.");
});
clearFinishedButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_FINISHED_DOWNLOADS" });
  downloadJobs = response.jobs || [];
  renderDownloadJobs();
});

void initializePopup();
setInterval(pollActiveBrowserDownloads, 750);
