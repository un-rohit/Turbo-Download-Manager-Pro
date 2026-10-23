// Turbo Download Manager - YouTube Player Formats Extractor
// Runs in the page (MAIN) world to access YouTube internal player objects
(function() {
  let lastVideoId = '';
  let cachedData = null;

  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b <= 0) return '';
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function cleanTitle(title) {
    return String(title || 'YouTube_Video')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function resolveStreamUrl(format) {
    if (format.url) return format.url;
    // Note: If format has signatureCipher, s is encrypted and requires client-side deciphering.
    // Returning an un-deciphered URL causes immediate HTTP 403 Forbidden from Google Video.
    // Real deciphered streams are sniffed directly from active webRequest playback.
    return null;
  }

  function extractFormats(playerResponse) {
    if (!playerResponse || !playerResponse.streamingData) return null;
    const streaming = playerResponse.streamingData;
    const details = playerResponse.videoDetails || {};
    const title = cleanTitle(details.title);
    const duration = parseInt(details.lengthSeconds || '0', 10);
    const videoId = details.videoId || '';

    const list = [];
    const seenQualities = new Set();

    // 1. Progressive muxed formats (Video + Audio combined - Best compatibility!)
    const formats = streaming.formats || [];
    for (const f of formats) {
      const url = resolveStreamUrl(f);
      if (!url) continue;
      const quality = f.qualityLabel || (f.height ? `${f.height}p` : 'SD');
      const isHD = f.height >= 720 || /720|1080|1440|2160/i.test(quality);
      const sizeStr = f.contentLength ? formatBytes(f.contentLength) :
        (f.bitrate && duration > 0 ? formatBytes((f.bitrate * duration) / 8) : '');

      list.push({
        quality,
        label: `${quality} HD (Video + Audio)`,
        format: 'MP4',
        type: 'video',
        isMuxed: true,
        isHD,
        url,
        size: sizeStr,
        itag: f.itag
      });
      seenQualities.add(`muxed_${quality}`);
    }

    // 2. Adaptive separate video formats (1080p, 1440p, 2160p / 4K, 720p, 480p, 360p)
    const adaptive = streaming.adaptiveFormats || [];
    for (const f of adaptive) {
      const mime = f.mimeType || '';
      const isVideo = mime.startsWith('video/');
      const isAudio = mime.startsWith('audio/');
      const url = resolveStreamUrl(f);
      if (!url) continue;

      if (isVideo) {
        const quality = f.qualityLabel || (f.height ? `${f.height}p` : '');
        if (!quality) continue;
        const key = `video_${quality}_${mime.includes('mp4') ? 'mp4' : 'webm'}`;
        if (seenQualities.has(key)) continue;
        seenQualities.add(key);

        const isHD = f.height >= 720 || /720|1080|1440|2160/i.test(quality);
        const formatName = mime.includes('mp4') ? 'MP4' : 'WebM';
        const sizeStr = f.contentLength ? formatBytes(f.contentLength) :
          (f.bitrate && duration > 0 ? formatBytes((f.bitrate * duration) / 8) : '');

        list.push({
          quality,
          label: `${quality} Full Quality (${formatName})`,
          format: formatName,
          type: 'video',
          isMuxed: false,
          isHD,
          url,
          size: sizeStr,
          itag: f.itag
        });
      } else if (isAudio) {
        const isM4A = mime.includes('mp4') || mime.includes('m4a');
        const key = `audio_${isM4A ? 'm4a' : 'webm'}`;
        if (seenQualities.has(key)) continue;
        seenQualities.add(key);

        const bitrateKbps = Math.round((f.bitrate || 128000) / 1000);
        const formatName = isM4A ? 'M4A' : 'WebM';
        const sizeStr = f.contentLength ? formatBytes(f.contentLength) :
          (f.bitrate && duration > 0 ? formatBytes((f.bitrate * duration) / 8) : '');

        list.push({
          quality: 'Audio',
          label: `Audio Only (${formatName} · ${bitrateKbps} kbps)`,
          format: formatName,
          type: 'audio',
          isMuxed: false,
          isHD: false,
          url,
          size: sizeStr,
          itag: f.itag
        });
      }
    }

    // Collect format metadata (itags, real sizes in bytes, resolutions)
    const itagMeta = {};
    for (const f of formats) {
      if (f.itag) {
        const rawBytes = f.contentLength ? parseInt(f.contentLength, 10) :
          (f.bitrate && duration > 0 ? Math.round((f.bitrate * duration) / 8) : 0);
        itagMeta[String(f.itag)] = {
          itag: f.itag,
          qualityLabel: f.qualityLabel || (f.height ? `${f.height}p` : ''),
          contentLength: rawBytes,
          size: rawBytes > 0 ? formatBytes(rawBytes) : '',
          mimeType: f.mimeType || '',
          fps: f.fps || 0
        };
      }
    }
    for (const f of adaptive) {
      if (f.itag) {
        const rawBytes = f.contentLength ? parseInt(f.contentLength, 10) :
          (f.bitrate && duration > 0 ? Math.round((f.bitrate * duration) / 8) : 0);
        itagMeta[String(f.itag)] = {
          itag: f.itag,
          qualityLabel: f.qualityLabel || (f.height ? `${f.height}p` : ''),
          contentLength: rawBytes,
          size: rawBytes > 0 ? formatBytes(rawBytes) : '',
          mimeType: f.mimeType || '',
          fps: f.fps || 0
        };
      }
    }

    // Sort order: 2160p, 1440p, 1080p, 720p, 480p, 360p, 240p, 144p, Audio
    const getRank = (item) => {
      if (item.type === 'audio') return 10;
      const num = parseInt(item.quality, 10) || 0;
      if (num === 2160) return 100;
      if (num === 1440) return 90;
      if (num === 1080) return 80;
      if (num === 720) return item.isMuxed ? 75 : 70;
      if (num === 480) return 60;
      if (num === 360) return item.isMuxed ? 55 : 50;
      return num;
    };
    list.sort((a, b) => getRank(b) - getRank(a));

    return {
      title,
      videoId,
      duration,
      formats: list,
      itagMeta
    };
  }

  function getCurrentVideoId() {
    try {
      const p = new URLSearchParams(window.location.search).get('v');
      if (p) return p;
    } catch {}
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.getVideoData === 'function') {
        const v = player.getVideoData();
        if (v && v.video_id) return v.video_id;
      }
    } catch {}
    return '';
  }

  function getCurrentVideoTitle() {
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.getVideoData === 'function') {
        const v = player.getVideoData();
        if (v && v.title) return cleanTitle(v.title);
      }
    } catch {}
    try {
      const h1 = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
      if (h1 && h1.textContent && h1.textContent.trim()) {
        return cleanTitle(h1.textContent.trim());
      }
    } catch {}
    return '';
  }

  function handleVideoSwitch(newId) {
    if (!newId || newId === lastVideoId) return;
    lastVideoId = newId;
    cachedData = null; // Clear stale format cache immediately
    const title = getCurrentVideoTitle();
    window.dispatchEvent(new CustomEvent('TURBO_YT_VIDEO_CHANGED', {
      detail: { videoId: newId, title }
    }));
    setTimeout(notifyFormats, 300);
    setTimeout(notifyFormats, 900);
    setTimeout(notifyFormats, 1800);
  }

  function getPlayerResponse() {
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const resp = player.getPlayerResponse();
        if (resp && resp.streamingData) return resp;
      }
    } catch {}

    if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData) {
      return window.ytInitialPlayerResponse;
    }

    return null;
  }

  function notifyFormats() {
    const raw = getPlayerResponse();
    const data = extractFormats(raw);
    if (data) {
      const currentV = getCurrentVideoId();
      if (currentV && data.videoId && data.videoId !== currentV) {
        // Response is still stale from the previous video; skip
        return;
      }
      cachedData = data;
      lastVideoId = data.videoId || currentV || lastVideoId;
      window.dispatchEvent(new CustomEvent('TURBO_YT_FORMATS', {
        detail: data
      }));
    }
  }

  // Intercept fetch responses for YouTube internal player API
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (url.includes('/youtubei/v1/player')) {
        const clone = response.clone();
        clone.json().then(json => {
          if (json && json.streamingData) {
            const data = extractFormats(json);
            if (data) {
              const currentV = getCurrentVideoId();
              if (!currentV || !data.videoId || data.videoId === currentV) {
                cachedData = data;
                lastVideoId = data.videoId || currentV;
                window.dispatchEvent(new CustomEvent('TURBO_YT_FORMATS', { detail: data }));
              }
            }
          }
        }).catch(() => {});
      }
    } catch {}
    return response;
  };

  // Listen for requests from isolated-world content script
  window.addEventListener('TURBO_REQUEST_YT_FORMATS', () => {
    if (cachedData) {
      window.dispatchEvent(new CustomEvent('TURBO_YT_FORMATS', { detail: cachedData }));
    } else {
      notifyFormats();
    }
  });

  // Watch for page navigation and video switches
  ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'spfdone', 'popstate'].forEach(evt => {
    window.addEventListener(evt, () => {
      const currentId = getCurrentVideoId();
      if (currentId && currentId !== lastVideoId) {
        handleVideoSwitch(currentId);
      } else {
        setTimeout(notifyFormats, 400);
        setTimeout(notifyFormats, 1200);
      }
    });
  });

  // Check periodically when player is active
  setInterval(() => {
    try {
      const currentId = getCurrentVideoId();
      if (currentId && currentId !== lastVideoId) {
        handleVideoSwitch(currentId);
      }
    } catch {}
  }, 300);

  // Initial attempt
  if (document.readyState === 'complete') {
    setTimeout(notifyFormats, 500);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(notifyFormats, 500));
  }
})();
