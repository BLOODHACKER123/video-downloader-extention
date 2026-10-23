
const scanButton = document.getElementById("scanButton");
const videoList = document.getElementById("videoList");
const status = document.getElementById("status");
const count = document.getElementById("count");

const scannerTab = document.getElementById("scannerTab");
const downloadsTab = document.getElementById("downloadsTab");
const scannerView = document.getElementById("scannerView");
const downloadsView = document.getElementById("downloadsView");

const downloadBadge = document.getElementById("downloadBadge");
const downloadStatus = document.getElementById("downloadStatus");
const downloadList = document.getElementById("downloadList");
const refreshButton = document.getElementById("refreshButton");

let downloads = [];
let activeFilter = "all";

scannerTab.addEventListener("click", () => showView("scanner"));
downloadsTab.addEventListener("click", () => showView("downloads"));

scanButton.addEventListener("click", scanPage);
refreshButton.addEventListener("click", loadDownloads);

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;

    document.querySelectorAll(".filter").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    renderDownloads();
  });
});

chrome.runtime.onMessage.addListener(message => {
  if (message.action === "DOWNLOADS_UPDATED") {
    downloads = message.downloads || [];
    renderDownloads();
  }
});

function showView(view) {
  const showDownloads = view === "downloads";

  scannerView.hidden = showDownloads;
  downloadsView.hidden = !showDownloads;

  scannerTab.classList.toggle("active", !showDownloads);
  downloadsTab.classList.toggle("active", showDownloads);

  if (showDownloads) {
    loadDownloads();
  }
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error || "The request failed.");
  }

  return response;
}

async function scanPage() {
  scanButton.disabled = true;
  videoList.replaceChildren();
  count.textContent = "0";
  status.textContent = "Scanning for media...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url?.startsWith("http")) {
      throw new Error("Open a regular website first.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "SCAN_VIDEOS"
    });

    const videos = response?.videos || [];
    count.textContent = String(videos.length);

    if (!videos.length) {
      status.textContent = "No recognizable media found.";
      return;
    }

    status.textContent =
      `Found ${videos.length} media resource(s).`;

    videos.forEach(video => {
      videoList.appendChild(createVideoCard(video, tab.url));
    });
  } catch (error) {
    status.textContent = error.message || "Could not scan this page.";
  } finally {
    scanButton.disabled = false;
  }
}

function isYouTubeHost(hostname) {
  const host = hostname.toLowerCase();

  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

function createVideoCard(video, pageUrl) {
  const card = document.createElement("article");
  card.className = "video-card";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = video.label;

  const meta = document.createElement("div");
  meta.className = "video-meta";
  meta.textContent = `${video.format} · ${video.duration}`;

  const details = document.createElement("p");
  details.className = "video-meta";
  details.textContent = video.reason ||
    (video.downloadable ? "Direct media resource" : "Not directly downloadable");

  const button = document.createElement("button");
  button.className = "download-button";

  let restricted = true;

  try {
    restricted = isYouTubeHost(new URL(pageUrl).hostname) ||
      isYouTubeHost(new URL(video.url).hostname);
  } catch {
    restricted = true;
  }

  if (restricted) {
    button.textContent = "YouTube downloads are not supported";
    button.disabled = true;
  } else if (!video.downloadable) {
    button.textContent = "Not a direct video file";
    button.disabled = true;
  } else {
    button.textContent = "Download video";

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Starting...";

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

async function loadDownloads() {
  downloadStatus.textContent = "Refreshing download history...";
  refreshButton.disabled = true;

  try {
    const response = await sendMessage({
      action: "GET_DOWNLOADS"
    });

    downloads = response.downloads || [];
    renderDownloads();
  } catch (error) {
    downloadStatus.textContent =
      error.message || "Could not load downloads.";
  } finally {
    refreshButton.disabled = false;
  }
}

function getFilteredDownloads() {
  if (activeFilter === "in_progress") {
    return downloads.filter(item => item.state === "in_progress");
  }

  if (activeFilter === "complete") {
    return downloads.filter(item => item.state === "complete");
  }

  if (activeFilter === "interrupted") {
    return downloads.filter(item => item.state === "interrupted");
  }

  return downloads;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(1)} ${units[index]}`;
}

function getState(item) {
  if (item.state === "complete") {
    return { label: "Completed", className: "complete" };
  }

  if (item.state === "interrupted") {
    return { label: "Interrupted", className: "interrupted" };
  }

  if (item.paused) {
    return { label: "Paused", className: "progress" };
  }

  return { label: "In progress", className: "progress" };
}

function renderDownloads() {
  const activeCount = downloads.filter(item =>
    item.state === "in_progress"
  ).length;

  downloadBadge.textContent = String(activeCount);
  downloadList.replaceChildren();

  const filtered = getFilteredDownloads();

  if (!filtered.length) {
    downloadStatus.textContent = downloads.length
      ? "No downloads match this filter."
      : "No downloads yet. Start one from the Scanner tab.";
    return;
  }

  downloadStatus.textContent =
    `${filtered.length} download(s) shown.`;

  filtered.forEach(item => {
    downloadList.appendChild(createDownloadCard(item));
  });
}

function createDownloadCard(item) {
  const card = document.createElement("article");
  card.className = "download-card";

  const top = document.createElement("div");
  top.className = "download-topline";

  const name = document.createElement("div");
  name.className = "download-name";

  // Show only the filename, not the entire local path.
  const parts = (item.filename || "").split(/[\\/]/);
  name.textContent = parts[parts.length - 1] || "Video download";

  const state = getState(item);
  const badge = document.createElement("span");
  badge.className = `state ${state.className}`;
  badge.textContent = state.label;

  top.append(name, badge);

  const meta = document.createElement("div");
  meta.className = "download-meta";

  const received = formatBytes(item.bytesReceived);
  const total = formatBytes(item.totalBytes);

  if (item.totalBytes > 0) {
    meta.textContent =
      `${received} of ${total}` +
      (item.progress !== null ? ` · ${item.progress}%` : "");
  } else {
    meta.textContent = `${received} received · Total size unknown`;
  }

  card.append(top, meta);

  if (item.state === "in_progress") {
    const track = document.createElement("div");
    track.className = "progress-track";

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${item.progress ?? 0}%`;

    track.appendChild(fill);
    card.appendChild(track);
  }

  if (item.state === "interrupted" && item.error) {
    const error = document.createElement("p");
    error.className = "download-meta";
    error.textContent = `Reason: ${item.error}`;
    card.appendChild(error);
  }

  const actions = document.createElement("div");
  actions.className = "download-actions";

  if (item.state === "in_progress") {
    const cancelButton = document.createElement("button");
    cancelButton.className = "action-button secondary";
    cancelButton.textContent = "Cancel";

    cancelButton.addEventListener("click", async () => {
      cancelButton.disabled = true;
      cancelButton.textContent = "Cancelling...";

      try {
        await sendMessage({
          action: "CANCEL_DOWNLOAD",
          id: item.id
        });

        await loadDownloads();
      } catch (error) {
        cancelButton.textContent = error.message || "Cancel failed";
        cancelButton.disabled = false;
      }
    });

    actions.appendChild(cancelButton);
  }

  if (item.state === "complete") {
    const openButton = document.createElement("button");
    openButton.className = "action-button";
    openButton.textContent = "Open file";

    openButton.addEventListener("click", async () => {
      openButton.disabled = true;

      try {
        await sendMessage({
          action: "OPEN_DOWNLOAD",
          id: item.id
        });
      } catch (error) {
        openButton.textContent = error.message || "Could not open";
      } finally {
        openButton.disabled = false;
      }
    });

    const showButton = document.createElement("button");
    showButton.className = "action-button secondary";
    showButton.textContent = "Show in folder";

    showButton.addEventListener("click", async () => {
      showButton.disabled = true;

      try {
        await sendMessage({
          action: "SHOW_DOWNLOAD",
          id: item.id
        });
      } catch (error) {
        showButton.textContent = error.message || "Could not show";
      } finally {
        showButton.disabled = false;
      }
    });

    actions.append(openButton, showButton);
  }

  if (actions.childElementCount) {
    card.appendChild(actions);
  }

  return card;
}

// Load history whenever the popup opens.
loadDownloads();
