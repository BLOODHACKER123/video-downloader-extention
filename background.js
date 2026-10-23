
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "DOWNLOAD_VIDEO") {
    return;
  }

  // Accept only ordinary web URLs.
  let url;

  try {
    url = new URL(message.url);
  } catch {
    sendResponse({
      ok: false,
      error: "Invalid video URL."
    });
    return;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    sendResponse({
      ok: false,
      error: "Only HTTP and HTTPS downloads are supported."
    });
    return;
  }

  // Avoid accidentally downloading a stream manifest as a video file.
  if (/\.(m3u8|mpd)$/i.test(url.pathname)) {
    sendResponse({
      ok: false,
      error: "Streaming manifests are not direct video files."
    });
    return;
  }

  // Chrome manages the actual download and destination.
  chrome.downloads.download({
    url: url.href,
    saveAs: true
  }).then((downloadId) => {
    sendResponse({
      ok: true,
      downloadId
    });
  }).catch((error) => {
    sendResponse({
      ok: false,
      error: error.message || "Chrome could not start the download."
    });
  });

  // Keep the message channel open for the asynchronous response.
  return true;
});
