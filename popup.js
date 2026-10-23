
const scanButton = document.getElementById("scanButton");
const videoList = document.getElementById("videoList");
const status = document.getElementById("status");
const count = document.getElementById("count");

scanButton.addEventListener("click", scanPage);

async function scanPage() {
  scanButton.disabled = true;
  videoList.replaceChildren();
  count.textContent = "0";
  status.textContent = "Scanning the current page...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url?.startsWith("http")) {
      throw new Error(
        "Open a regular website first. Browser internal pages cannot be scanned."
      );
    }

    // Inject the detector only after the user clicks Scan.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "SCAN_VIDEOS"
    });

    const videos = response?.videos || [];

    count.textContent = String(videos.length);

    if (videos.length === 0) {
      status.textContent =
        "No recognizable media found. Some sites hide their video sources.";
      return;
    }

    status.textContent = `Found ${videos.length} media resource(s).`;

    videos.forEach((video) => {
      videoList.appendChild(createVideoCard(video));
    });
  } catch (error) {
    status.textContent =
      error.message || "Could not scan this page.";
  } finally {
    scanButton.disabled = false;
  }
}

function createVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = video.label;

  const meta = document.createElement("div");
  meta.className = "video-meta";
  meta.textContent = video.format;

  const button = document.createElement("button");
  button.className = "download-button";

  if (video.streaming) {
    button.textContent = "Streaming support coming next";
    button.disabled = true;
  } else {
    button.textContent = "Download video";

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Starting download...";

      try {
        const result = await chrome.runtime.sendMessage({
          action: "DOWNLOAD_VIDEO",
          url: video.url
        });

        if (!result?.ok) {
          throw new Error(result?.error || "Download failed.");
        }

        button.textContent = "Download started ✓";
      } catch (error) {
        button.textContent = error.message || "Download failed";
        button.disabled = false;
      }
    });
  }

  card.append(title, meta, button);
  return card;
}
