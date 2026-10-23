
const DOWNLOAD_IDS_KEY = "videoDownloaderDownloadIds";

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

function sendToPopup(message) {
  // The popup may be closed. That is normal.
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function getTrackedIds() {
  const result = await chrome.storage.local.get(DOWNLOAD_IDS_KEY);
  return result[DOWNLOAD_IDS_KEY] || [];
}

async function saveTrackedId(id) {
  const ids = await getTrackedIds();

  if (!ids.includes(id)) {
    ids.push(id);
    await chrome.storage.local.set({
      [DOWNLOAD_IDS_KEY]: ids
    });
  }
}

function summarizeDownload(item) {
  const total = item.totalBytes ?? -1;
  const received = item.bytesReceived ?? 0;

  let progress = null;

  if (total > 0) {
    progress = Math.min(
      100,
      Math.round((received / total) * 100)
    );
  }

  return {
    id: item.id,
    filename: item.filename || "Video download",
    url: item.url,
    state: item.state,
    paused: Boolean(item.paused),
    canResume: Boolean(item.canResume),
    bytesReceived: received,
    totalBytes: total,
    progress,
    error: item.error || "",
    startTime: item.startTime || "",
    endTime: item.endTime || "",
    mime: item.mime || "",
    danger: item.danger || "safe"
  };
}

async function getTrackedDownloads() {
  const ids = await getTrackedIds();

  if (ids.length === 0) {
    return [];
  }

  // Query Chrome's actual download records.
  const items = await chrome.downloads.search({});

  return items
    .filter(item => ids.includes(item.id))
    .map(summarizeDownload)
    .sort((a, b) => {
      return (b.id || 0) - (a.id || 0);
    });
}

async function refreshPopup() {
  try {
    const downloads = await getTrackedDownloads();

    sendToPopup({
      action: "DOWNLOADS_UPDATED",
      downloads
    });
  } catch (error) {
    console.error("Could not refresh downloads:", error);
  }
}

chrome.downloads.onChanged.addListener(() => {
  // Chrome provides the changed fields in the event.
  // Re-query the record so the popup receives a complete snapshot.
  refreshPopup();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.action) {
    return;
  }

  if (message.action === "GET_DOWNLOADS") {
    getTrackedDownloads()
      .then(downloads => sendResponse({
        ok: true,
        downloads
      }))
      .catch(error => sendResponse({
        ok: false,
        error: error.message || "Could not load download history."
      }));

    return true;
  }

  if (message.action === "DOWNLOAD_VIDEO") {
    (async () => {
      let mediaUrl;
      let pageUrl;

      try {
        mediaUrl = new URL(message.url);
        pageUrl = new URL(message.pageUrl);
      } catch {
        throw new Error("Invalid media or page URL.");
      }

      if (
        !["http:", "https:"].includes(mediaUrl.protocol) ||
        !["http:", "https:"].includes(pageUrl.protocol)
      ) {
        throw new Error("Only HTTP and HTTPS URLs are supported.");
      }

      // Preserve the existing YouTube restriction.
      if (
        isYouTubeHost(pageUrl.hostname) ||
        isYouTubeHost(mediaUrl.hostname)
      ) {
        throw new Error(
          "Downloads from YouTube are not supported. Use its official download options."
        );
      }

      if (/\.(m3u8|mpd)$/i.test(mediaUrl.pathname)) {
        throw new Error(
          "Streaming manifests cannot be downloaded as direct video files."
        );
      }

      const id = await chrome.downloads.download({
        url: mediaUrl.href,
        saveAs: true
      });

      await saveTrackedId(id);

      sendResponse({
        ok: true,
        downloadId: id
      });

      await refreshPopup();
    })().catch(error => {
      sendResponse({
        ok: false,
        error: error.message || "Could not start download."
      });
    });

    return true;
  }

  if (message.action === "CANCEL_DOWNLOAD") {
    (async () => {
      const ids = await getTrackedIds();

      if (!ids.includes(message.id)) {
        throw new Error("This download is not managed by the extension.");
      }

      await chrome.downloads.cancel(message.id);

      sendResponse({ ok: true });
      await refreshPopup();
    })().catch(error => {
      sendResponse({
        ok: false,
        error: error.message || "Could not cancel download."
      });
    });

    return true;
  }

  if (
    message.action === "OPEN_DOWNLOAD" ||
    message.action === "SHOW_DOWNLOAD"
  ) {
    (async () => {
      const ids = await getTrackedIds();

      if (!ids.includes(message.id)) {
        throw new Error("This download is not managed by the extension.");
      }

      const results = await chrome.downloads.search({
        id: message.id
      });

      const item = results[0];

      if (!item || item.state !== "complete") {
        throw new Error("Only completed downloads can be opened or shown.");
      }

      if (message.action === "OPEN_DOWNLOAD") {
        await chrome.downloads.open(message.id);
      } else {
        await chrome.downloads.show(message.id);
      }

      sendResponse({ ok: true });
    })().catch(error => {
      sendResponse({
        ok: false,
        error: error.message || "Could not open the downloaded file."
      });
    });

    return true;
  }
});
