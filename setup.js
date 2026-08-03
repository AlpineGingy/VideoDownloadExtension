"use strict";

const platformNameElement = document.querySelector("#platform-name");
const downloadLinkElement = document.querySelector("#download-link");
const releaseWarningElement = document.querySelector("#release-warning");
const installStepElement = document.querySelector("#install-step");
const verifyButton = document.querySelector("#verify-button");
const connectionStatusElement = document.querySelector("#connection-status");

/** Detects the closest self-contained release package for the current Chrome platform. */
async function detectReleasePackage() {
  const platformText = navigator.userAgentData?.platform || navigator.platform || "";
  let architecture = "x64";
  if (navigator.userAgentData?.getHighEntropyValues) {
    const details = await navigator.userAgentData.getHighEntropyValues(["architecture", "bitness"]);
    if (/arm/i.test(details.architecture || "")) {
      architecture = "arm64";
    }
  } else if (/arm|aarch64/i.test(navigator.userAgent)) {
    architecture = "arm64";
  }

  if (/win/i.test(platformText)) {
    return {
      runtime: `win-${architecture}`,
      name: `Windows ${architecture === "arm64" ? "ARM64" : "64-bit"}`,
      instruction: "Double-click install-windows.cmd and approve the installation prompt."
    };
  }
  if (/mac/i.test(platformText)) {
    return {
      runtime: `osx-${architecture}`,
      name: `macOS ${architecture === "arm64" ? "Apple Silicon" : "Intel"}`,
      instruction: "Open Terminal in the extracted folder and run: sh install-unix.sh"
    };
  }
  return {
    runtime: `linux-${architecture}`,
    name: `Linux ${architecture === "arm64" ? "ARM64" : "64-bit"}`,
    instruction: "Open a terminal in the extracted folder and run: sh install-unix.sh"
  };
}

/** Checks whether an unpacked development build contains a local companion archive. */
async function localPackageExists(packageUrl) {
  try {
    const response = await fetch(packageUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

/** Configures the download link and platform-specific installation instruction. */
async function initializeSetupPage() {
  const releasePackage = await detectReleasePackage();
  platformNameElement.textContent = releasePackage.name;
  installStepElement.textContent = releasePackage.instruction;

  const releaseBaseUrl = globalThis.MEDIA_FINDER_RELEASE_BASE_URL?.replace(/\/$/, "");
  if (releaseBaseUrl) {
    downloadLinkElement.href = `${releaseBaseUrl}/media-finder-companion-${releasePackage.runtime}.zip`;
  } else {
    const localPackageUrl = chrome.runtime.getURL(
      `companion/artifacts/media-finder-companion-${releasePackage.runtime}.zip`
    );
    if (!await localPackageExists(localPackageUrl)) {
      releaseWarningElement.hidden = false;
      return;
    }
    downloadLinkElement.href = localPackageUrl;
    downloadLinkElement.download = `media-finder-companion-${releasePackage.runtime}.zip`;
  }

  downloadLinkElement.classList.remove("disabled");
  downloadLinkElement.removeAttribute("aria-disabled");
}

/** Requests a live companion health check and waits for its structured response. */
async function verifyCompanion() {
  connectionStatusElement.textContent = "Checking...";
  const response = await chrome.runtime.sendMessage({ type: "CHECK_COMPANION" });
  if (response.error) {
    connectionStatusElement.textContent = response.error;
  }
}

/** Displays native companion health details returned through the service worker. */
function handleCompanionUpdate(message) {
  if (message.type !== "COMPANION_UPDATE" || message.update.type !== "companionStatus") {
    return false;
  }

  const update = message.update;
  if (update.status !== "ready") {
    connectionStatusElement.textContent = update.message;
  } else if (update.protocolVersion < 6) {
    connectionStatusElement.textContent = "Connected, but this companion is outdated. Download and reinstall the current package.";
  } else if (!update.ytDlpAvailable) {
    connectionStatusElement.textContent = "Companion connected, but yt-dlp was not found.";
  } else if (!update.denoAvailable) {
    connectionStatusElement.textContent = "Connected. yt-dlp is ready; Deno is missing, so YouTube downloads may not work.";
  } else if (!update.ffmpegAvailable) {
    connectionStatusElement.textContent = "Connected. yt-dlp is ready; FFmpeg is not installed.";
  } else {
    connectionStatusElement.textContent = "Connected. yt-dlp, Deno, and FFmpeg are ready.";
  }
  return false;
}

verifyButton.addEventListener("click", () => {
  void verifyCompanion();
});
chrome.runtime.onMessage.addListener(handleCompanionUpdate);
void initializeSetupPage();
