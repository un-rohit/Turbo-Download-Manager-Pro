const SERVER_URL = 'http://127.0.0.1:4820';
let interceptEnabled = true;
let mediaGrabberEnabled = true;
let badgeTimer = null;

// Initialize settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['interceptEnabled', 'mediaGrabberEnabled'], (res) => {
    if (res.interceptEnabled === undefined) {
      chrome.storage.local.set({ interceptEnabled: true });
    } else {
      interceptEnabled = res.interceptEnabled;
    }
    if (res.mediaGrabberEnabled === undefined) {
      chrome.storage.local.set({ mediaGrabberEnabled: true });
    } else {
      mediaGrabberEnabled = res.mediaGrabberEnabled;
    }
  });

  // Replace old entries on install/update before creating the current menus.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'turbo-download-link',
      title: '⚡ Download with Turbo Download Manager',
      contexts: ['link']
    });

    chrome.contextMenus.create({
      id: 'turbo-download-media',
      title: '⚡ Download Media with Turbo Download Manager',
      contexts: ['video', 'audio', 'image']
    });
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.interceptEnabled) {
    interceptEnabled = changes.interceptEnabled.newValue;
  }
  if (changes.mediaGrabberEnabled !== undefined) {
    mediaGrabberEnabled = changes.mediaGrabberEnabled.newValue !== false;
    if (!mediaGrabberEnabled) {
      tabMediaStreams.clear();
    }
  }
});

// Forward URL to Turbo Download Manager Server.
async function readJsonResponse(response, endpoint) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown content type';
    throw new Error(`${endpoint} returned HTML or invalid JSON (${contentType})`);
  }
}

let isWakingUpApp = false;

async function pingDesktopServer(timeoutMs = 1200) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${SERVER_URL}/api/interfaces`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureDesktopAppRunning() {
  const isRunning = await pingDesktopServer(800);
  if (isRunning) return true;

  if (isWakingUpApp) {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (await pingDesktopServer(600)) return true;
    }
  }

  isWakingUpApp = true;
  try {
    // Automatically wake up the Windows desktop application using registered turbodownload:// protocol
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (activeTab && activeTab.id) {
        if (chrome.scripting && chrome.scripting.executeScript) {
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              const ifr = document.createElement('iframe');
              ifr.style.display = 'none';
              ifr.src = 'turbodownload://open';
              document.documentElement.appendChild(ifr);
              setTimeout(() => ifr.remove(), 2500);
            }
          }).catch(() => {
            chrome.tabs.create({ url: 'turbodownload://open', active: false }, (t) => {
              if (t && t.id) setTimeout(() => chrome.tabs.remove(t.id).catch(() => {}), 1500);
            });
          });
        } else {
          chrome.tabs.create({ url: 'turbodownload://open', active: false }, (t) => {
            if (t && t.id) setTimeout(() => chrome.tabs.remove(t.id).catch(() => {}), 1500);
          });
        }
      } else {
        chrome.tabs.create({ url: 'turbodownload://open', active: false }, (t) => {
          if (t && t.id) setTimeout(() => chrome.tabs.remove(t.id).catch(() => {}), 1500);
        });
      }
    });

    // Wait up to 6 seconds for the desktop application to wake up and bind port 4820
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (await pingDesktopServer(600)) {
        return true;
      }
    }
    return false;
  } finally {
    isWakingUpApp = false;
  }
}

async function sendToTurboDownloader(url, filename, options = {}) {
  try {
    // 1. Ensure Windows desktop app is running, wake it up automatically if closed!
    await ensureDesktopAppRunning();

    const cachedHeaders = mediaHeadersCache.get(url) || {};
    const requestHeaders = {
      'User-Agent': navigator.userAgent,
      ...cachedHeaders
    };
    if (options.referer) requestHeaders['Referer'] = options.referer;
    else if (/youtube\.com|googlevideo\.com/i.test(url) && !requestHeaders['Referer']) requestHeaders['Referer'] = 'https://www.youtube.com/';
    if (options.origin) requestHeaders['Origin'] = options.origin;
    else if (/youtube\.com|googlevideo\.com/i.test(url) && !requestHeaders['Origin']) requestHeaders['Origin'] = 'https://www.youtube.com';

    // Ensure session cookies are forwarded for protected downloads (YouTube / Google Video CDN)
    if (!requestHeaders['Cookie'] && !requestHeaders['cookie'] && chrome.cookies) {
      try {
        let cookieList = await chrome.cookies.getAll({ url });
        if ((!cookieList || cookieList.length === 0) && /googlevideo\.com|youtube\.com/i.test(url)) {
          cookieList = await chrome.cookies.getAll({ domain: '.youtube.com' });
        }
        if (cookieList && cookieList.length > 0) {
          requestHeaders['Cookie'] = cookieList.map(c => `${c.name}=${c.value}`).join('; ');
        }
      } catch (cErr) {
        console.debug('[TDM] Cookie retrieval notice:', cErr);
      }
    }

    let warning = '';
    const probeController = new AbortController();
    const probeTimeout = setTimeout(() => probeController.abort(), 10000);
    try {
      const probeResponse = await fetch(`${SERVER_URL}/api/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, headers: requestHeaders }),
        signal: probeController.signal
      });
      const probe = await readJsonResponse(probeResponse, 'Download probe');
      if (!probeResponse.ok || probe.error) throw new Error(probe.error || `Server returned ${probeResponse.status}`);
      if (probe.supportsRanges === false) {
        warning = 'This host does not support byte ranges. The download uses one connection and cannot resume partial data.';
      }
      if (/^text\/html\b/i.test(probe.contentType || '') || /\.html?$/i.test(probe.filename || '')) {
        warning = `${warning}${warning ? ' ' : ''}This URL returns a web page, not a direct file link.`;
      }
    } catch (err) {
      // Probe feedback is advisory and time-limited; keep the handoff moving
      // and let the download API perform the authoritative validation.
      console.warn('[Turbo Download Manager Extension] Preflight check unavailable:', err.message);
    } finally {
      clearTimeout(probeTimeout);
    }

    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(() => downloadController.abort(), 10000);
    let res;
    try {
      const interfaceResponse = await fetch(`${SERVER_URL}/api/interfaces`, {
        cache: 'no-store',
        signal: downloadController.signal
      });
      const interfaceData = await readJsonResponse(interfaceResponse, 'Network adapter status');
      if (!interfaceResponse.ok) throw new Error(interfaceData.error || `Server returned ${interfaceResponse.status}`);
      const interfaces = interfaceData.interfaces || [];

      res = await fetch(`${SERVER_URL}/api/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          filename: filename || undefined,
          connectionsPerInterface: 2,
          interfaces,
          pausedInterfaces: interfaces.filter(iface => !iface.online || iface.enabled === false).map(iface => iface.address),
          headers: requestHeaders
        }),
        signal: downloadController.signal
      });
    } finally {
      clearTimeout(downloadTimeout);
    }

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await readJsonResponse(res, 'Download API');
    if (data.canceled) return { success: false, canceled: true };
    return { success: true, task: data, warning };
  } catch (err) {
    console.error('[Turbo Download Manager Extension] Failed to send download:', err);
    return { success: false, error: err.message };
  }
}

// With interception enabled, cancel the browser's original transfer first and
// route supported downloads only through Turbo. Failures never start Chrome's downloader.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!interceptEnabled || !item.url) {
    suggest();
    return;
  }

  let suggestionSent = false;
  const suggestOnce = details => {
    if (suggestionSent) return;
    suggestionSent = true;
    suggest(details);
  };

  const notifyTab = (tabId, result) => {
    if (Number.isInteger(tabId) && tabId >= 0) {
      chrome.tabs.sendMessage(tabId, { action: 'turbo:download-result', ...result }).catch(() => {});
    }
  };

  (async () => {
    const filename = (item.filename || '').split(/[\\/]/).pop() || 'download';
    let originalCanceled = false;

    try {
      // Re-read storage to avoid a stale service-worker value after the user
      // has just switched the toggle off.
      const { interceptEnabled: isEnabled } = await chrome.storage.local.get('interceptEnabled');
      if (isEnabled === false) {
        suggestOnce();
        return;
      }

      if (!/^https?:\/\//i.test(item.url)) {
        await chrome.downloads.cancel(item.id);
        originalCanceled = true;
        suggestOnce();
        chrome.downloads.erase({ id: item.id }).catch(() => {});
        const error = 'This download type is not supported by Turbo. Turn off “Use Turbo for browser downloads” to use Chrome’s downloader.';
        showWarning('Unsupported download stopped; Chrome’s downloader was not used.');
        notifyTab(item.tabId, { success: false, error });
        return;
      }

      // Stop the original transfer before resolving filename determination.
      // FilenameSuggestion only controls the name; it has no cancel option.
      await chrome.downloads.cancel(item.id);
      originalCanceled = true;
      suggestOnce();
      chrome.downloads.erase({ id: item.id }).catch(() => {});

      let decision = { choice: 'turbo' };
      if (Number.isInteger(item.tabId) && item.tabId >= 0) {
        try {
          decision = await chrome.tabs.sendMessage(item.tabId, {
            action: 'turbo:confirm-download',
            filename,
            timeoutMs: 3000
          });
        } catch (err) {
          // Protected pages and tabs without a content-script receiver cannot
          // show the in-tab prompt. Keep the enabled Turbo preference and use
          // the configured destination automatically.
          console.debug('[Turbo Download Manager Extension] In-tab prompt unavailable; using Turbo directly:', err.message);
        }
      }

      if (decision?.choice === 'cancel') {
        notifyTab(item.tabId, { success: false, canceled: true, filename });
        return;
      }

      const result = await sendToTurboDownloader(item.url, filename);
      if (!result.success) {
        console.warn('[Turbo Download Manager Extension] Manager rejected the download; browser fallback is disabled while interception is on');
        showWarning('Turbo could not start this download. Chrome’s downloader was not used.');
        notifyTab(item.tabId, { success: false, error: result.error || 'Turbo could not start this download.' });
        return;
      }

      notifyTab(item.tabId, { success: true, filename });
      if (result.warning) showWarning(result.warning);
      else showBadge('⚡', '#00f2fe');
    } catch (err) {
      console.warn('[Turbo Download Manager Extension] Could not hand off download:', err);
      if (!suggestionSent) suggestOnce();
      if (!originalCanceled && interceptEnabled) {
        try {
          await chrome.downloads.cancel(item.id);
          originalCanceled = true;
          chrome.downloads.erase({ id: item.id }).catch(() => {});
        } catch (cancelError) {
          console.error('[Turbo Download Manager Extension] Could not stop the browser transfer:', cancelError);
        }
      }
      if (originalCanceled) {
        showWarning('Turbo could not start this download. Chrome’s downloader was not used.');
        notifyTab(item.tabId, { success: false, error: err.message || 'Turbo could not start this download.' });
      } else {
        showWarning('Could not stop the browser transfer. Check Downloads and retry if needed.');
        notifyTab(item.tabId, { success: false, error: 'Turbo could not safely intercept this download. Check your browser downloads.' });
      }
    }
  })();
  return true;
});

// 2. Context Menu Click Handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.linkUrl || info.srcUrl;
  if (!targetUrl) return;

  const result = await sendToTurboDownloader(targetUrl);
  if (result.success) {
    if (result.warning) showWarning(result.warning);
    else showBadge('OK', '#00f5a0');
  } else {
    showBadge('ERR', '#ff3366');
  }
});

// 3. Listen for Messages from Content Scripts / Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadUrl') {
    const senderUrl = sender.tab ? sender.tab.url : undefined;
    let origin;
    try { if (senderUrl) origin = new URL(senderUrl).origin; } catch {}
    sendToTurboDownloader(request.url, request.filename, {
      referer: request.referer || senderUrl,
      origin: request.origin || origin
    }).then(sendResponse);
    return true; // Keep channel open for async response
  }
  if (request.action === 'turbo:tab-video-changed') {
    const tabId = sender.tab ? sender.tab.id : request.tabId;
    if (tabId) {
      tabMediaStreams.delete(tabId);
    }
    sendResponse({ success: true });
    return false;
  }
  if (request.action === 'getTabMedia') {
    if (!mediaGrabberEnabled) {
      sendResponse({ streams: [] });
      return false;
    }
    const tabId = sender.tab ? sender.tab.id : request.tabId;
    sendResponse({ streams: tabMediaStreams.get(tabId) || [] });
    return false;
  }
  if (request.action === 'resolveYouTube') {
    (async () => {
      try {
        await ensureDesktopAppRunning();
        const res = await fetch(`${SERVER_URL}/api/media/resolve-yt?url=${encodeURIComponent(request.url)}`);
        const data = await readJsonResponse(res, 'YouTube Resolver');
        sendResponse(data);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  if (request.action === 'turbo:reload-extension') {
    chrome.runtime.reload();
    sendResponse({ success: true });
    return false;
  }
});

// 4. Universal Media Sniffer (Non-blocking webRequest observer)
const tabMediaStreams = new Map(); // tabId -> Array of detected streams
const mediaHeadersCache = new Map(); // cleanUrl -> headersObject

function formatByteCount(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index++) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(1)} ${unit}`;
}

const YOUTUBE_ITAG_MAP = {
  // === 4K (2160p) & 8K ===
  '402': { quality: '4320p 8K', format: 'MP4', isHD: true },
  '272': { quality: '4320p 8K', format: 'WebM', isHD: true },
  '315': { quality: '2160p 4K 60fps', format: 'WebM', isHD: true },
  '313': { quality: '2160p 4K', format: 'WebM', isHD: true },
  '401': { quality: '2160p 4K', format: 'MP4', isHD: true },
  '337': { quality: '2160p 4K HDR', format: 'WebM', isHD: true },
  '701': { quality: '2160p 4K HDR', format: 'MP4', isHD: true },
  '138': { quality: '2160p 4K', format: 'MP4', isHD: true },

  // === 1440p (2K) ===
  '308': { quality: '1440p 2K 60fps', format: 'WebM', isHD: true },
  '271': { quality: '1440p 2K', format: 'WebM', isHD: true },
  '400': { quality: '1440p 2K', format: 'MP4', isHD: true },
  '336': { quality: '1440p 2K HDR', format: 'WebM', isHD: true },
  '700': { quality: '1440p 2K HDR', format: 'MP4', isHD: true },

  // === 1080p Full HD ===
  '299': { quality: '1080p Full HD 60fps', format: 'MP4', isHD: true },
  '303': { quality: '1080p Full HD 60fps', format: 'WebM', isHD: true },
  '137': { quality: '1080p Full HD', format: 'MP4', isHD: true },
  '248': { quality: '1080p Full HD', format: 'WebM', isHD: true },
  '399': { quality: '1080p Full HD', format: 'MP4', isHD: true },
  '335': { quality: '1080p Full HD HDR', format: 'WebM', isHD: true },
  '699': { quality: '1080p Full HD HDR', format: 'MP4', isHD: true },
  '37':  { quality: '1080p Full HD', format: 'MP4', isHD: true, isMuxed: true },

  // === 720p HD ===
  '298': { quality: '720p HD 60fps', format: 'MP4', isHD: true },
  '302': { quality: '720p HD 60fps', format: 'WebM', isHD: true },
  '136': { quality: '720p HD', format: 'MP4', isHD: true },
  '247': { quality: '720p HD', format: 'WebM', isHD: true },
  '398': { quality: '720p HD', format: 'MP4', isHD: true },
  '334': { quality: '720p HD HDR', format: 'WebM', isHD: true },
  '698': { quality: '720p HD HDR', format: 'MP4', isHD: true },
  '22':  { quality: '720p HD', format: 'MP4', isHD: true, isMuxed: true },

  // === 480p SD ===
  '135': { quality: '480p SD', format: 'MP4', isHD: false },
  '244': { quality: '480p SD', format: 'WebM', isHD: false },
  '397': { quality: '480p SD', format: 'MP4', isHD: false },
  '333': { quality: '480p SD HDR', format: 'WebM', isHD: false },
  '697': { quality: '480p SD HDR', format: 'MP4', isHD: false },

  // === 360p SD ===
  '18':  { quality: '360p', format: 'MP4', isHD: false, isMuxed: true },
  '134': { quality: '360p', format: 'MP4', isHD: false },
  '243': { quality: '360p', format: 'WebM', isHD: false },
  '396': { quality: '360p', format: 'MP4', isHD: false },
  '332': { quality: '360p HDR', format: 'WebM', isHD: false },
  '696': { quality: '360p HDR', format: 'MP4', isHD: false },

  // === 240p / 144p ===
  '133': { quality: '240p', format: 'MP4', isHD: false },
  '242': { quality: '240p', format: 'WebM', isHD: false },
  '395': { quality: '240p', format: 'MP4', isHD: false },
  '160': { quality: '144p', format: 'MP4', isHD: false },
  '278': { quality: '144p', format: 'WebM', isHD: false },
  '394': { quality: '144p', format: 'MP4', isHD: false },

  // === Audio Streams ===
  '140': { quality: 'Audio Only (M4A · 128k)', format: 'M4A', type: 'audio', isHD: false },
  '141': { quality: 'Audio Only (M4A · 256k)', format: 'M4A', type: 'audio', isHD: false },
  '251': { quality: 'Audio Only (WebM · 160k)', format: 'WebM', type: 'audio', isHD: false },
  '250': { quality: 'Audio Only (WebM · 70k)', format: 'WebM', type: 'audio', isHD: false },
  '249': { quality: 'Audio Only (WebM · 50k)', format: 'WebM', type: 'audio', isHD: false },
  '256': { quality: 'Audio 5.1 Surround', format: 'M4A', type: 'audio', isHD: false },
  '258': { quality: 'Audio 5.1 Surround', format: 'M4A', type: 'audio', isHD: false },
  '328': { quality: 'Audio 5.1 Surround', format: 'M4A', type: 'audio', isHD: false }
};

function getQualityLabelFromItag(itag) {
  const info = YOUTUBE_ITAG_MAP[String(itag)];
  return info ? info.quality : '';
}

function registerMediaStream(tabId, rawUrl, headers = []) {
  if (!mediaGrabberEnabled) return;
  if (tabId < 0 || !rawUrl || !/^https?:\/\//i.test(rawUrl)) return;

  let contentType = '';
  let contentLength = 0;
  for (const h of headers) {
    const name = h.name.toLowerCase();
    if (name === 'content-type') contentType = h.value.toLowerCase();
    if (name === 'content-length') contentLength = parseInt(h.value, 10) || 0;
  }

  const isYouTubeStream = rawUrl.includes('googlevideo.com/videoplayback');
  const isMediaContentType = contentType.startsWith('video/') || contentType.startsWith('audio/') ||
    contentType.includes('mpegurl') || contentType.includes('dash+xml');
  const isMediaExtension = /\.(mp4|webm|mkv|m4v|mov|avi|flv|m3u8|ts|mp3|m4a|aac|ogg)(\?|$)/i.test(rawUrl);

  if (!isMediaContentType && !isMediaExtension && !isYouTubeStream) return;

  // Live broadcast streams are continuous live chunk streams without a static file
  if (rawUrl.includes('source=yt_live_broadcast') || rawUrl.includes('live=1')) return;

  // Clean URL to make it a full stream link (remove chunk range/buffer query parameters)
  let cleanUrl = rawUrl;
  let itag = null;
  let ytStreamId = null;
  let aitagsStr = null;
  if (isYouTubeStream) {
    try {
      const parsed = new URL(rawUrl);
      itag = parsed.searchParams.get('itag');
      ytStreamId = parsed.searchParams.get('id');
      aitagsStr = parsed.searchParams.get('aitags');
      const signedParams = new Set((parsed.searchParams.get('sparams') || '').split(',').filter(Boolean));
      // Only delete parameters that are NOT in sparams (signed parameters list)
      ['range', 'rn', 'rbuf', 'sq', 'alr', 'ump'].forEach(p => {
        if (!signedParams.has(p)) parsed.searchParams.delete(p);
      });
      if (!signedParams.has('sabr')) parsed.searchParams.delete('sabr');
      if (!signedParams.has('rqh')) parsed.searchParams.delete('rqh');
      cleanUrl = parsed.toString();
    } catch {}

    // In modern YouTube SABR, the playback request may not have explicit itag in query string
    if (!itag) {
      itag = '137';
    }
  }

  let streams = tabMediaStreams.get(tabId) || [];

  const itagInfo = itag ? YOUTUBE_ITAG_MAP[String(itag)] : null;
  const isAudio = itagInfo?.type === 'audio' || contentType.startsWith('audio/') || (itagInfo?.format === 'M4A');
  const quality = itagInfo ? itagInfo.quality : getQualityLabelFromItag(itag);
  const format = itagInfo ? itagInfo.format : (isAudio ? 'M4A' : 'MP4');

  const streamInfo = {
    url: cleanUrl,
    contentType,
    sizeBytes: contentLength,
    size: contentLength > 1024 * 50 ? formatByteCount(contentLength) : '',
    quality: quality || (isAudio ? 'Audio' : 'Video'),
    label: `${quality || (isAudio ? 'Audio' : 'Video')} (${format})`,
    format,
    type: isAudio ? 'audio' : 'video',
    isHD: itagInfo ? itagInfo.isHD : /720|1080|1440|2160|4K|2K|HD/i.test(quality || ''),
    itag,
    ytStreamId,
    timestamp: Date.now()
  };

  const existingIdx = streams.findIndex(s => s.url === cleanUrl || (itag && s.itag === itag));
  if (existingIdx >= 0) {
    streams[existingIdx] = { ...streams[existingIdx], ...streamInfo };
  } else {
    streams.push(streamInfo);
  }

  if (streams.length > 50) streams = streams.slice(-50);
  tabMediaStreams.set(tabId, streams);

  chrome.tabs.sendMessage(tabId, {
    action: 'turbo:media-detected',
    stream: streamInfo,
    streams: streams
  }).catch(() => {});
}

if (chrome.webRequest) {
  try {
    if (chrome.webRequest.onBeforeSendHeaders) {
      chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
        if (!details.url) return;
        const isMedia = details.type === 'media' || details.url.includes('googlevideo.com');
        if (isMedia) {
          const hdrs = {};
          if (details.requestHeaders) {
            for (const h of details.requestHeaders) {
              hdrs[h.name] = h.value;
            }
          }
          mediaHeadersCache.set(details.url, hdrs);
          try {
            const parsed = new URL(details.url);
            const signedParams = new Set((parsed.searchParams.get('sparams') || '').split(',').filter(Boolean));
            ['range', 'rn', 'rbuf', 'sq', 'alr', 'ump'].forEach(p => {
              if (!signedParams.has(p)) parsed.searchParams.delete(p);
            });
            if (!signedParams.has('sabr')) parsed.searchParams.delete('sabr');
            if (!signedParams.has('rqh')) parsed.searchParams.delete('rqh');
            mediaHeadersCache.set(parsed.toString(), hdrs);
          } catch {}

          if (details.url.includes('googlevideo.com/videoplayback')) {
            registerMediaStream(details.tabId, details.url, details.requestHeaders || []);
          }
        }
      }, { urls: ["*://*.googlevideo.com/*", "<all_urls>"] }, ['requestHeaders', 'extraHeaders']);
    }

    if (chrome.webRequest.onBeforeRequest) {
      chrome.webRequest.onBeforeRequest.addListener((details) => {
        if (details.url && details.url.includes('googlevideo.com/videoplayback')) {
          registerMediaStream(details.tabId, details.url);
        }
      }, { urls: ["*://*.googlevideo.com/videoplayback*"] });
    }

    if (chrome.webRequest.onResponseStarted) {
      chrome.webRequest.onResponseStarted.addListener((details) => {
        registerMediaStream(details.tabId, details.url, details.responseHeaders || []);
      }, { urls: ["<all_urls>"] }, ['responseHeaders']);
    }
  } catch (err) {
    console.warn('[Turbo Download Manager Extension] webRequest listener setup notice:', err.message);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaStreams.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    tabMediaStreams.delete(tabId);
  }
});

function showBadge(text, color) {
  if (badgeTimer) clearTimeout(badgeTimer);
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    badgeTimer = null;
  }, 3500);
}

function showWarning(message) {
  if (badgeTimer) clearTimeout(badgeTimer);
  chrome.action.setBadgeText({ text: '1C' });
  chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
  chrome.action.setTitle({ title: `Turbo Download Manager: ${message}` });
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Turbo Download Manager' });
    badgeTimer = null;
  }, 12000);
}

