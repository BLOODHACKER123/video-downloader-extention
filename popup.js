
const scanButton = document.getElementById("scanButton");
const scanResults = document.getElementById("videoList");
const statusElement = document.getElementById("status");
const scannerTab = document.getElementById("scannerTab");
const downloadsTab = document.getElementById("downloadsTab");
const scannerPage = document.getElementById("scannerView");
const downloadsPage = document.getElementById("downloadsView");
const container = document.getElementById("downloadList");

function setStatus(message) {
  if (statusElement) statusElement.textContent = message;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error("The extension returned no response."));
        return;
      }

      if (response.ok === false) {
        reject(new Error(response.error || "Request failed."));
        return;
      }

      resolve(response);
    });
  });
}

function isYouTubeHost(hostname) {
  return hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com") ||
    hostname === "youtu.be" ||
    hostname.endsWith(".youtu.be");
}

function switchTab(tab) {
  const showScanner = tab === "scanner";

  if (scannerPage) scannerPage.hidden = !showScanner;
  if (downloadsPage) downloadsPage.hidden = showScanner;

  if (scannerTab) scannerTab.classList.toggle("active", showScanner);
  if (downloadsTab) downloadsTab.classList.toggle("active", !showScanner);

  if (!showScanner) loadDownloads();
}

if (scannerTab) {
  scannerTab.addEventListener("click", () => switchTab("scanner"));
}

if (downloadsTab) {
  downloadsTab.addEventListener("click", () => switchTab("downloads"));
}

if (scanButton) {
  scanButton.addEventListener("click", scanVideos);
} else {
  console.error("Scan button not found. Check its ID in popup.html.");
}

async function scanVideos() {
  if (!scanResults) {
    setStatus("Scan results container is missing. Check popup.html.");
    return;
  }

  scanButton.disabled = true;
  setStatus("Scanning this page...");
  scanResults.replaceChildren();

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id || !tab.url ||
        !/^https?:/.test(tab.url)) {
      throw new Error(
        "Open a normal website first. Chrome internal pages cannot be scanned."
      );
    }

    let response;

    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: "SCAN_VIDEOS"
      });
    } catch {
      // The content script may not have loaded yet.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });

      response = await chrome.tabs.sendMessage(tab.id, {
        action: "SCAN_VIDEOS"
      });
    }

    const videos = response?.videos || [];

    if (!videos.length) {
      setStatus("No videos found on this page.");
      return;
    }

    for (const video of videos) {
      scanResults.appendChild(createVideoCard(video, tab.url));
    }

    setStatus(`Found ${videos.length} video resource(s).`);
  } catch (error) {
    console.error("Video scan failed:", error);
    setStatus(error.message || "Scanning failed. Check the console.");
  } finally {
    scanButton.disabled = false;
  }
}

async function loadDownloads() {
  const container = document.getElementById("downloadsList");
  if (!container) return;

  try {
    const response = await sendMessage({ action: "GET_DOWNLOADS" });
    const downloads = response.downloads || [];

    container.replaceChildren();

    if (!downloads.length) {
      container.textContent = "No downloads yet.";
      return;
    }

    for (const item of downloads) {
      const row = document.createElement("div");
      row.className = "download-item";

      const name = document.createElement("div");
      name.textContent = item.filename || item.url || "Video download";

      const state = document.createElement("div");
      state.textContent = item.state || "Unknown";

      row.append(name, state);
      container.appendChild(row);
    }
  } catch (error) {
    console.error("Could not load downloads:", error);
    container.textContent = "Could not load downloads. Check the extension errors.";
  }
}

function createVideoCard(video, pageUrl) {
  const card = document.createElement("article");
  card.className = "video-card";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = video.label || "Detected video";

  const meta = document.createElement("div");
  meta.className = "video-meta";
  meta.textContent = `${video.format || "Unknown format"} · ${video.duration || "Duration unknown"}`;

  const details = document.createElement("p");
  details.className = "video-meta";
  details.textContent = video.reason ||
    (video.downloadable ? "Direct media resource" : "Streaming resource");

  const button = document.createElement("button");
  button.className = "download-button";

  let pageHost = "";
  let mediaHost = "";

  try {
    pageHost = new URL(pageUrl).hostname;
    mediaHost = new URL(video.url).hostname;
  } catch {}

  if (isYouTubeHost(pageHost) || isYouTubeHost(mediaHost)) {
    button.textContent = "YouTube downloads are not supported";
    button.disabled = true;
  } else if (video.format === "HLS stream") {
    button.textContent = "Download authorized HLS";
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        const mediaOrigin = new URL(video.url).origin;
        const granted = await chrome.permissions.request({
          origins: [`${mediaOrigin}/*`]
        });

        if (!granted) {
          throw new Error("Media-site permission was not granted.");
        }

        await sendMessage({
          action: "DOWNLOAD_HLS",
          url: video.url,
          pageUrl
        });

        button.textContent = "Stream download started ✓";
      } catch (error) {
        button.textContent = error.message || "HLS download failed";
        button.disabled = false;
      }
    });
  } else if (!video.downloadable) {
    button.textContent = "Not supported yet";
    button.disabled = true;
  } else {
    button.textContent = "Download video";

    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        await sendMessage({
          action: "DOWNLOAD_VIDEO",
          url: video.url,
          pageUrl
        });

        button.textContent = "Download started ✓";
        await loadDownloads();
      } catch (error) {
        button.textContent = error.message || "Download failed";
        button.disabled = false;
      }
    });
  }

  card.append(title, meta, details, button);
  return card;
}

chrome.runtime.onMessage.addListener(message => {
  if (message.action === "DOWNLOADS_UPDATED") {
    loadDownloads();
  }

  if (message.action === "HLS_PROGRESS") {
    setStatus(
      `Processing HLS segments: ${message.completed}/${message.total}`
    );
  }
});
