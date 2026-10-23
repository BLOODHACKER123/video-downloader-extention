
(() => {
  if (globalThis.__videoDownloaderInstalled) return;
  globalThis.__videoDownloaderInstalled = true;

  const media = new Map();

  function classify(url, mimeType = "") {
    let parsed;

    try {
      parsed = new URL(url, location.href);
    } catch {
      return null;
    }

    if (!["http:", "https:", "blob:"].includes(parsed.protocol)) {
      return null;
    }

    const path = parsed.pathname.toLowerCase();
    const mime = mimeType.toLowerCase();

    if (parsed.protocol === "blob:") {
      return {
        format: "Blob / player media",
        streaming: true,
        downloadable: false,
        reason: "This player URL is not a standalone video file."
      };
    }

    if (
      /\.m3u8$/.test(path) ||
      mime.includes("mpegurl")
    ) {
      return {
        format: "HLS stream",
        streaming: true,
        downloadable: false,
        reason: "Streaming support is not enabled yet."
      };
    }

    if (
      /\.mpd$/.test(path) ||
      mime.includes("dash+xml")
    ) {
      return {
        format: "DASH stream",
        streaming: true,
        downloadable: false,
        reason: "Streaming support is not enabled yet."
      };
    }

    if (
      /\.(mp4|m4v)$/.test(path) ||
      mime.includes("video/mp4")
    ) {
      return {
        format: "MP4",
        streaming: false,
        downloadable: true
      };
    }

    if (
      /\.webm$/.test(path) ||
      mime.includes("video/webm")
    ) {
      return {
        format: "WebM",
        streaming: false,
        downloadable: true
      };
    }

    if (
      /\.(mov|ogv)$/.test(path) ||
      mime.includes("video/ogg") ||
      mime.includes("video/quicktime")
    ) {
      return {
        format: "Video",
        streaming: false,
        downloadable: true
      };
    }

    return null;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "Duration unavailable";
    }

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function scanVideos() {
    const found = new Map();

    function add(rawUrl, label, mimeType = "", duration = null) {
      if (!rawUrl) return;

      const details = classify(rawUrl, mimeType);
      if (!details) return;

      let url;

      try {
        url = new URL(rawUrl, location.href);
      } catch {
        return;
      }

      const key = url.href;

      if (!found.has(key)) {
        found.set(key, {
          url: key,
          label: label || details.format,
          format: details.format,
          duration: formatDuration(duration),
          streaming: details.streaming,
          downloadable: details.downloadable,
          reason: details.reason || ""
        });
      }
    }

    document.querySelectorAll("video").forEach((video, index) => {
      const label = `Video ${index + 1}`;
      const duration = video.duration;

      add(
        video.currentSrc,
        label,
        video.getAttribute("type") || "",
        duration
      );

      add(
        video.getAttribute("src"),
        label,
        video.getAttribute("type") || "",
        duration
      );

      video.querySelectorAll("source").forEach((source) => {
        add(
          source.src,
          label,
          source.type,
          duration
        );
      });
    });

    document.querySelectorAll("a[href]").forEach((link) => {
      add(
        link.href,
        link.textContent.trim() || "Linked media",
        link.type || ""
      );
    });

    return Array.from(found.values());
  }

  // Refresh our cached results when the page adds or changes media.
  let scanTimer;

  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);

    scanTimer = setTimeout(() => {
      media.clear();

      scanVideos().forEach((item) => {
        media.set(item.url, item);
      });
    }, 250);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "type"]
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SCAN_VIDEOS") {
      const results = scanVideos();

      media.clear();
      results.forEach((item) => media.set(item.url, item));

      sendResponse({
        videos: Array.from(media.values())
      });
    }
  });
})();
