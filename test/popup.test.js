"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const popupHtml = fs.readFileSync(path.join(__dirname, "..", "extension", "popup.html"), "utf8");
const popupScript = fs.readFileSync(path.join(__dirname, "..", "extension", "popup.js"), "utf8");
const serviceWorkerScript = fs.readFileSync(path.join(__dirname, "..", "extension", "service-worker.js"), "utf8");

/** Proves the simplified popup keeps discovery and downloads as distinct top-level views. */
test("popup separates finding media from managing downloads", () => {
  assert.match(popupHtml, /data-main-view="find"/);
  assert.match(popupHtml, /data-main-view="downloads"/);
  assert.match(popupHtml, /data-source-view="page"/);
  assert.match(popupHtml, /data-source-view="network"/);
});

/** Proves destination preferences and persistent multi-job controls remain wired into the UI. */
test("popup exposes download destination and persistent job controls", () => {
  assert.match(popupHtml, /id="output-folder"/);
  assert.match(popupHtml, /id="filename-style"/);
  assert.match(popupHtml, /id="download-list"/);
  assert.match(popupHtml, /id="clear-finished"/);
  assert.match(popupScript, /GET_DOWNLOAD_JOBS/);
  assert.match(popupScript, /CANCEL_DOWNLOAD_JOB/);
  assert.match(popupScript, /Save as-is/);
  assert.match(popupScript, /chrome\.storage\.onChanged/);
  assert.match(popupScript, /pollActiveBrowserDownloads/);
  assert.match(popupScript, /download-progress-track/);
  assert.match(popupScript, /ensureChromeCookiePermission/);
  assert.match(popupScript, /GET_DOWNLOAD_LOG/);
  assert.match(popupScript, /Copy log/);
  assert.match(serviceWorkerScript, /platform\.os === "win"/);
  assert.match(serviceWorkerScript, /useChromeSessionCookies/);
  assert.match(serviceWorkerScript, /requestDownloadLog/);
  assert.match(serviceWorkerScript, /persistNativeJobUpdate/);
  assert.match(serviceWorkerScript, /broadcastNativeJobUpdate/);
  assert.match(serviceWorkerScript, /inferCompanionJobUpdate/);
  assert.match(serviceWorkerScript, /reconcileCompanionDownloadJobs/);
  assert.match(serviceWorkerScript, /VISIBLE_UPDATE_INTERVAL_MS/);
  assert.match(popupScript, /scheduleDownloadJobsRender/);
  assert.match(popupScript, /DOWNLOAD_RENDER_INTERVAL_MS/);
  assert.match(serviceWorkerScript, /Number\.isFinite\(update\.percent\)/);
  assert.match(popupScript, /value !== null/);
  assert.ok(
    serviceWorkerScript.indexOf("broadcastNativeJobUpdate(update, !frequentUpdate)") <
      serviceWorkerScript.indexOf("persistNativeJobUpdate(update.jobId"),
    "Visible progress should broadcast before it is persisted."
  );
});

/** Proves Settings always provides a route to install or update the local companion. */
test("settings opens the companion download page even when the setup prompt is hidden", () => {
  assert.match(popupHtml, /id="settings-companion"/);
  assert.match(popupHtml, /id="download-companion"[^>]*>Download companion</);
  assert.match(popupScript, /settingsCompanionElement\.hidden = isDownload/);
  assert.match(popupScript, /function openCompanionSetupPage\(\)/);
  assert.match(popupScript, /chrome\.runtime\.getURL\("setup\.html"\)/);
  assert.match(popupScript, /downloadCompanionButton\.addEventListener/);
});

/** Proves discovery settings can clear per-tab network captures after navigation. */
test("network results display occurrence counts and can clear on navigation", () => {
  assert.match(popupHtml, /id="clear-network-on-navigation"/);
  assert.match(popupHtml, /Clear when the page loads or refreshes/);
  assert.match(popupScript, /CLEAR_NETWORK_ON_NAVIGATION_KEY/);
  assert.match(popupScript, /occurrenceBadge\.textContent = `×\$\{item\.occurrences\}`/);
  assert.match(serviceWorkerScript, /occurrences: isRepeatedNetworkUrl \? \(existing\.occurrences \|\| 1\) \+ 1/);
  assert.match(serviceWorkerScript, /function clearNetworkMediaOnNavigation\(tabId\)/);
  assert.match(serviceWorkerScript, /chrome\.webNavigation\.onCommitted\.addListener/);
});
