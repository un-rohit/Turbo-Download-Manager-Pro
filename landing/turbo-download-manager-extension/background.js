const SERVER_URL = 'http://127.0.0.1:4820';
let interceptEnabled = true;
let badgeTimer = null;

// Initialize settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['interceptEnabled'], (res) => {
    if (res.interceptEnabled === undefined) {
      chrome.storage.local.set({ interceptEnabled: true });
    } else {
      interceptEnabled = res.interceptEnabled;
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

async function sendToTurboDownloader(url, filename) {
  try {
    let warning = '';
    const probeController = new AbortController();
    const probeTimeout = setTimeout(() => probeController.abort(), 10000);
    try {
      const probeResponse = await fetch(`${SERVER_URL}/api/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
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
          pausedInterfaces: interfaces.filter(iface => !iface.online || iface.enabled === false).map(iface => iface.address)
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
    sendToTurboDownloader(request.url, request.filename).then(sendResponse);
    return true; // Keep channel open for async response
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
