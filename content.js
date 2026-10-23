
(() => {
  // Prevent duplicate listeners if the script is injected again.
  if (globalThis.__videoDownloaderInstalled) 
    return;
  globalThis.__videoDownloaderInstalled = true;

  function scanVideos() {
    const found = new Map();

    function addMedia(rawUrl, label, mimeType = "") {
      if (!rawUrl) return;

      let url;

      try {
        url = new URL(rawUrl, location.href);
      } catch {
        return;
      }

      // Only inspect ordinary web resources.
      if (!["http:", "https:"].includes(url.protocol)) return;

      const path = url.pathname.toLowerCase();
      const mime = mimeType.toLowerCase();

      let format = "";

      if (
        /\.m3u8$/.test(path) ||
        mime.includes("mpegurl")
      ) {
        format = "HLS stream";
      } else if (
        /\.mpd$/.test(path) ||
        mime.includes("dash+xml")
      ) {
        format = "DASH stream";
      } else if (
        /\.(mp4|m4v)$/.test(path) ||
        mime.includes("video/mp4")
      ) {
        format = "MP4";
      } else if (
        /\.webm$/.test(path) ||
        mime.includes("video/webm")
      ) {
        format = "WebM";
      } else if (
        /\.(mov|ogv)$/.test(path) ||
        mime.includes("video/ogg")
      ) {
        format = "Video";
      } else {
        return;
      }

      if (!found.has(url.href)) {
        found.set(url.href, {
          url: url.href,
          label: label || format,
          format,
          streaming: format === "HLS stream" ||
                     format === "DASH stream"
        });
      }
    }

    // Inspect HTML video elements and their sources.
    document.querySelectorAll("video").forEach((video, index) => {
      const sources = [
        { url: video.currentSrc, type: "" },
        { url: video.getAttribute("src"), type: "" },
        ...Array.from(video.querySelectorAll("source")).map(source => ({
          url: source.getAttribute("src"),
          type: source.getAttribute("type") || ""
        }))
      ];

      sources.forEach(source => {
        addMedia(
          source.url,
          `Video ${index + 1}`,
          source.type
        );
      });
    });

    // Inspect direct media links and visible stream manifests.
    document.querySelectorAll("a[href]").forEach((link) => {
      addMedia(
        link.href,
        link.textContent.trim() || "Linked media",
        link.type || ""
      );
    });

    return Array.from(found.values());
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SCAN_VIDEOS") {
      sendResponse({ videos: scanVideos() });
    }
  });
})();
