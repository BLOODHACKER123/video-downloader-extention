
const MAX_PLAYLIST_BYTES = 1024 * 1024;
const MAX_SEGMENTS = 500;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

function safeSameOrigin(url, baseUrl) {
  const resolved = new URL(url, baseUrl);

  if (
    !["http:", "https:"].includes(resolved.protocol) ||
    resolved.origin !== new URL(baseUrl).origin
  ) {
    throw new Error("Cross-origin stream resources are not supported.");
  }

  return resolved.href;
}

async function fetchText(url) {
  const response = await fetch(url, {
    credentials: "omit",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Playlist request failed (${response.status}).`);
  }

  const text = await response.text();

  if (new Blob([text]).size > MAX_PLAYLIST_BYTES) {
    throw new Error("The playlist is too large.");
  }

  if (!text.trimStart().startsWith("#EXTM3U")) {
    throw new Error("This is not a valid HLS playlist.");
  }

  return text;
}

function parsePlaylist(text, playlistUrl) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  // We don't support encrypted media or unsupported segment layouts.
  if (lines.some(line =>
    /^#EXT-X-KEY:/i.test(line) &&
    !/METHOD=NONE/i.test(line)
  )) {
    throw new Error("Encrypted HLS streams are not supported.");
  }

  if (lines.some(line =>
    /^#EXT-X-BYTERANGE:/i.test(line) ||
    /^#EXT-X-MAP:/i.test(line) ||
    /^#EXT-X-I-FRAMES-ONLY/i.test(line)
  )) {
    throw new Error(
      "This HLS playlist uses a segment format not supported yet."
    );
  }

  // Detect a master playlist and choose its lowest-bandwidth variant.
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^#EXT-X-STREAM-INF:/i.test(lines[i])) {
      const match = lines[i].match(/BANDWIDTH=(\d+)/i);
      const bandwidth = match ? Number(match[1]) : Infinity;

      const nextLine = lines.slice(i + 1).find(line =>
        !line.startsWith("#")
      );

      if (nextLine) {
        variants.push({
          bandwidth,
          url: safeSameOrigin(nextLine, playlistUrl)
        });
      }
    }
  }

  if (variants.length) {
    variants.sort((a, b) => a.bandwidth - b.bandwidth);

    return {
      type: "master",
      variantUrl: variants[0].url
    };
  }

  const segments = lines
    .filter(line => !line.startsWith("#"))
    .map(line => safeSameOrigin(line, playlistUrl));

  if (!segments.length) {
    throw new Error("No video segments were found in the playlist.");
  }

  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`Too many segments. Limit: ${MAX_SEGMENTS}.`);
  }

  // This first assembler supports MPEG-TS segments only.
 if (segments.some(url => !/\.ts(?:$|[?#])/i.test(url))) { 
    throw new Error(
      "Only ordinary MPEG-TS HLS segments are supported in this version."
    );
  }

  return {
    type: "media",
    segments
  };
}

async function downloadHls(url) {
  const originalUrl = new URL(url);

  if (!["http:", "https:"].includes(originalUrl.protocol)) {
    throw new Error("Invalid playlist URL.");
  }

  let playlistUrl = originalUrl.href;
  let playlistText = await fetchText(playlistUrl);
  let parsed = parsePlaylist(playlistText, playlistUrl);

  // Support one master-playlist level for now.
  if (parsed.type === "master") {
    playlistUrl = parsed.variantUrl;
    playlistText = await fetchText(playlistUrl);
    parsed = parsePlaylist(playlistText, playlistUrl);

    if (parsed.type !== "media") {
      throw new Error("Nested master playlists are not supported.");
    }
  }

  const chunks = [];
  let totalBytes = 0;

  for (let i = 0; i < parsed.segments.length; i++) {
    const segmentUrl = parsed.segments[i];

    const response = await fetch(segmentUrl, {
      credentials: "omit",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Segment ${i + 1} failed (${response.status}).`
      );
    }

    const buffer = await response.arrayBuffer();
    totalBytes += buffer.byteLength;

    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        "The stream exceeds the 100 MB limit for this first version."
      );
    }

    chunks.push(buffer);

    chrome.runtime.sendMessage({
      action: "HLS_PROGRESS",
      completed: i + 1,
      total: parsed.segments.length,
      bytes: totalBytes
    }).catch(() => {});
  }

  const blob = new Blob(chunks, { type: "video/mp2t" });
  const blobUrl = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);

  // The service worker will hand this URL to Chrome's download manager.
  return {
    blobUrl,
    filename: "video-stream.ts",
    bytes: totalBytes
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "PROCESS_HLS") {
    downloadHls(message.url)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({
        ok: false,
        error: error.message || "Could not process this stream."
      }));

    return true;
  }

  if (message.action === "RELEASE_HLS_BLOB") {
    if (message.blobUrl) {
      URL.revokeObjectURL(message.blobUrl);
    }

    sendResponse({ ok: true });
  }
});
