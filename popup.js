
const scanButton = document.getElementById("scanButton");
const videoList = document.getElementById("videoList");
const statusElement = document.getElementById("status");
const countElement = document.getElementById("count");

const scannerTab = document.getElementById("scannerTab");
const downloadsTab = document.getElementById("downloadsTab");
const scannerView = document.getElementById("scannerView");
const downloadsView = document.getElementById("downloadsView");

const downloadList = document.getElementById("downloadList");
const downloadStatus = document.getElementById("downloadStatus");
const downloadBadge = document.getElementById("downloadBadge");
const refreshButton = document.getElementById("refreshButton");
const filterButtons = document.querySelectorAll("[data-filter]");

let currentDownloads = [];
let currentFilter = "all";

// ---------- Messaging ----------

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

// ---------- Shared helpers ----------

function setStatus(message) {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function isYouTubeHost(hostname) {
  const host = hostname.toLowerCase();

  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host.endsWith(".youtu.be") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

function formatBytes(bytes) {
  if (bytes == null || bytes < 0) return "Unknown size";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  return `${(bytes / Math.pow(1024, index)).toFixed(
    index === 0 ? 0 : 1
  )} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString();
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

// ---------- Navigation ----------

function switchTab(tab) {
  const showScanner = tab === "scanner";

  scannerView.hidden = !showScanner;
  downloadsView.hidden = showScanner;

  scannerTab.classList.toggle("active", showScanner);
  downloadsTab.classList.toggle("active", !showScanner);

  if (!showScanner) {
    loadDownloads();
  }
}

scannerTab.addEventListener("click", () => switchTab("scanner"));
downloadsTab.addEventListener("click", () => switchTab("downloads"));

refreshButton.addEventListener("click", () => loadDownloads());

// ---------- Video scanner ----------

scanButton.addEventListener("click", scanVideos);

async function scanVideos() {
  scanButton.disabled = true;
  setStatus("Scanning this page...");
  videoList.replaceChildren();
  countElement.textContent = "0";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
      throw new Error(
        "Open a normal HTTP or HTTPS website before scanning."
      );
    }

    let response;

    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: "SCAN_VIDEOS"
      });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });

      response = await chrome.tabs.sendMessage(tab.id, {
        action: "SCAN_VIDEOS"
      });
    }

    if (response?.ok === false) {
      throw new Error(response.error || "The page scan failed.");
    }

    const videos = response?.videos || [];

    countElement.textContent = String(videos.length);

    if (videos.length === 0) {
      setStatus("No supported video resources found on this page.");
      return;
    }

    for (const video of videos) {
      videoList.appendChild(createVideoCard(video, tab.url));
    }

    setStatus(`Found ${videos.length} video resource(s).`);
  } catch (error) {
    console.error("Video scan failed:", error);
    setStatus(error.message || "Scanning failed.");
  } finally {
    scanButton.disabled = false;
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
  meta.textContent =
    `${video.format || "Unknown format"} · ` +
    `${video.duration || "Duration unknown"}`;

  const details = document.createElement("p");
  details.className = "video-meta";
  details.textContent = video.reason ||
    (video.downloadable
      ? "Direct media resource"
      : "Streaming resource");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "download-button";

  let pageHost = "";
  let mediaHost = "";

  try {
    pageHost = new URL(pageUrl).hostname;
    mediaHost = new URL(video.url).hostname;
  } catch {
    button.textContent = "Invalid media URL";
    button.disabled = true;
    card.append(title, meta, details, button);
    return card;
  }

  // Keep the YouTube restriction in the popup.
  // background.js also enforces it independently.
  if (isYouTubeHost(pageHost) || isYouTubeHost(mediaHost)) {
    button.textContent = "YouTube downloads are not supported";
    button.disabled = true;
  } else if (video.format === "HLS stream") {
    button.textContent = "Download authorized HLS";

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Starting stream download...";

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

        button.textContent = "Download started ✓";
        await loadDownloads();
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
      button.textContent = "Starting download...";

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

// ---------- Download manager ----------

async function loadDownloads() {
  downloadStatus.textContent = "Loading downloads...";
  refreshButton.disabled = true;

  try {
    const response = await sendMessage({
      action: "GET_DOWNLOADS"
    });

    currentDownloads = response.downloads || [];

    // Badge shows the number of managed downloads.
    downloadBadge.textContent = String(currentDownloads.length);

    renderDownloads();
  } catch (error) {
    console.error("Could not load downloads:", error);
    downloadStatus.textContent =
      error.message || "Could not load download history.";
  } finally {
    refreshButton.disabled = false;
  }
}

function renderDownloads() {
  downloadList.replaceChildren();

  const filtered = currentDownloads.filter(item => {
    return currentFilter === "all" || item.state === currentFilter;
  });

  if (filtered.length === 0) {
    downloadStatus.textContent =
      currentFilter === "all"
        ? "No downloads yet. Start a download from the Scanner tab."
        : "No downloads match this filter.";
    return;
  }

  const activeCount = currentDownloads.filter(
    item => item.state === "in_progress"
  ).length;

  downloadStatus.textContent =
    `${filtered.length} shown · ${activeCount} active`;

  for (const item of filtered) {
    downloadList.appendChild(createDownloadCard(item));
  }
}

function createDownloadCard(item) {
  const card = document.createElement("article");
  card.className = "download-item";

  const heading = document.createElement("div");
  heading.className = "download-heading";

  const name = document.createElement("div");
  name.className = "download-title";

  // Chrome supplies a local path; display only the filename.
  name.textContent = item.filename
    ? item.filename.split(/[\\/]/).pop()
    : "Video download";

  const state = document.createElement("span");
  state.className = `download-state ${item.state || "unknown"}`;
  state.textContent = getStateLabel(item);

  heading.append(name, state);
  card.appendChild(heading);

  const size = document.createElement("div");
  size.className = "download-meta";

  size.textContent =
    `${formatBytes(item.bytesReceived)} received` +
    (item.totalBytes >= 0
      ? ` of ${formatBytes(item.totalBytes)}`
      : "");

  card.appendChild(size);

  // Progress bar for active downloads.
  if (item.state === "in_progress") {
    const progressTrack = document.createElement("div");
    progressTrack.className = "progress-track";

    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";

    if (item.progress !== null && item.progress !== undefined) {
      progressBar.style.width = `${item.progress}%`;
      progressBar.setAttribute(
        "aria-label",
        `${item.progress}% downloaded`
      );
    } else {
      // Unknown total size: show an indeterminate visual indicator.
      progressBar.classList.add("indeterminate");
      progressBar.style.width = "35%";
    }

    progressTrack.appendChild(progressBar);
    card.appendChild(progressTrack);

    const progressText = document.createElement("div");
    progressText.className = "download-meta";
    progressText.textContent =
      item.progress == null
        ? "Downloading…"
        : `${item.progress}% downloaded`;

    card.appendChild(progressText);
  }

  if (item.error) {
    const error = document.createElement("p");
    error.className = "download-error";
    error.textContent = `Error: ${item.error}`;
    card.appendChild(error);
  }

  const timestamp = item.endTime || item.startTime;
  if (timestamp) {
    const date = document.createElement("div");
    date.className = "download-meta";
    date.textContent = formatDate(timestamp);
    card.appendChild(date);
  }

  const actions = document.createElement("div");
  actions.className = "download-actions";

  if (item.state === "in_progress") {
    actions.appendChild(
      createButton("Cancel", "download-action", async () => {
        await performDownloadAction(
          item.id,
          "CANCEL_DOWNLOAD",
          "Cancelling download..."
        );
      })
    );
  }

  if (item.state === "complete") {

actions.appendChild(
  createButton("Open file", "download-action", () => {
    try {
      // Open the completed local download directly.
      chrome.downloads.open(item.id);

      downloadStatus.textContent = "Opening downloaded file...";
    } catch (error) {
      console.error("Could not open download:", error);

      downloadStatus.textContent =
        error.message || "Could not open the downloaded file.";
    }
  })
);


  actions.appendChild(
    createButton("Show in folder", "download-action", async () => {
      await performDownloadAction(item.id, "SHOW_DOWNLOAD");
    })
  );
}

  if (actions.childElementCount > 0) {
    card.appendChild(actions);
  }

  return card;
}

function getStateLabel(item) {
  if (item.state === "in_progress") {
    return item.paused ? "Paused" : "Downloading";
  }

  if (item.state === "complete") return "Completed";
  if (item.state === "interrupted") return "Failed";
  return item.state || "Unknown";
}

async function performDownloadAction(id, action, message) {
  if (message) {
    downloadStatus.textContent = message;
  }

  try {
    await sendMessage({ action, id });
    await loadDownloads();
  } catch (error) {
    console.error(`${action} failed:`, error);
    downloadStatus.textContent =
      error.message || "The download action failed.";
  }
}

// ---------- Filters ----------

filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter || "all";

    filterButtons.forEach(filter => {
      filter.classList.toggle("active", filter === button);
    });

    renderDownloads();
  });
});

// ---------- Background updates ----------

chrome.runtime.onMessage.addListener(message => {
  if (message.action === "DOWNLOADS_UPDATED") {
    // The background already supplies a complete snapshot.
    if (Array.isArray(message.downloads)) {
      currentDownloads = message.downloads;
      downloadBadge.textContent = String(currentDownloads.length);
      renderDownloads();
    } else {
      loadDownloads();
    }
  }

  if (message.action === "HLS_PROGRESS") {
    setStatus(
      `Processing HLS segments: ${message.completed}/${message.total}`
    );
  }
});

// Load the initial manager state so the badge is correct.
loadDownloads();
