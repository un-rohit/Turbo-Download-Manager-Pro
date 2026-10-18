const SERVER_URL = 'http://127.0.0.1:4820';
let interceptEnabled = true;

// Initialize settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['interceptEnabled'], (res) => {
    if (res.interceptEnabled === undefined) {
      chrome.storage.local.set({ interceptEnabled: true });
    } else {
      interceptEnabled = res.interceptEnabled;
    }
  });

  // Create Context Menus
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

async function sendToTurboDownloader(url, filename, chooseFolder = false) {
  try {
    let outputDir;
    if (chooseFolder) {
      const folderResponse = await fetch(`${SERVER_URL}/api/browse-folder`, { method: 'POST' });
      if (folderResponse.ok) {
        try {
          const folderResult = await readJsonResponse(folderResponse, 'Folder picker');
          if (folderResult.path === null) return { success: false, canceled: true };
          outputDir = folderResult.path || undefined;
        } catch (err) {
          // Older app builds may not expose the folder-picker route. Still
          // send the transfer through Turbo using its configured save folder.
          console.warn('[Turbo Download Manager Extension] Folder picker unavailable; using the app default folder:', err.message);
        }
      } else {
        console.warn(`[Turbo Download Manager Extension] Folder picker returned ${folderResponse.status}; using the app default folder`);
      }
    }

    const res = await fetch(`${SERVER_URL}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        filename: filename || undefined,
        outputDir,
        connectionsPerInterface: 2
      })
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await readJsonResponse(res, 'Download API');
    if (data.canceled) return { success: false, canceled: true };
    return { success: true, task: data };
  } catch (err) {
    console.error('[Turbo Download Manager Extension] Failed to send download:', err);
    return { success: false, error: err.message };
  }
}

// Intercept before Chrome opens its Save As dialog. The app's folder picker
// chooses the destination, then the native browser transfer is cancelled.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!interceptEnabled || !item.url || !/^https?:\/\//i.test(item.url)) {
    suggest();
    return;
  }

  // The manager only supports HTTP(S); let the browser handle local, blob,
  // extension, FTP, and other non-HTTP downloads itself.
  (async () => {
    const filename = (item.filename || '').split(/[\\/]/).pop() || 'download';
    try {
      // Re-read storage to avoid a stale service-worker value after the user
      // has just switched the toggle off.
      const { interceptEnabled: isEnabled } = await chrome.storage.local.get('interceptEnabled');
      if (isEnabled === false) return;

      const result = await sendToTurboDownloader(item.url, filename, true);
      if (!result.success) {
        if (!result.canceled) console.warn('[Turbo Download Manager Extension] Manager rejected the download; keeping the native browser download');
        return;
      }

      await chrome.downloads.cancel(item.id);
      chrome.downloads.erase({ id: item.id });
      showBadge('⚡', '#00f2fe');
    } catch (err) {
      console.warn('[Turbo Download Manager Extension] Could not hand off download:', err);
    } finally {
      // Chrome requires exactly one suggest() call, including on fallback.
      suggest({ filename, conflictAction: 'uniquify' });
    }
  })();
  return true;
});

// 2. Context Menu Click Handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.linkUrl || info.srcUrl;
  if (!targetUrl) return;

  const result = await sendToTurboDownloader(targetUrl, undefined, true);
  if (result.success) {
    showBadge('OK', '#00f5a0');
  } else {
    showBadge('ERR', '#ff3366');
  }
});

// 3. Listen for Messages from Content Scripts / Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadUrl') {
    sendToTurboDownloader(request.url, request.filename, true).then(sendResponse);
    return true; // Keep channel open for async response
  }
});

function showBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 3500);
}
