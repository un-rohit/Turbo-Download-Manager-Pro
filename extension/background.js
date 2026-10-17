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

// Forward URL to Turbo Download Manager Server
async function sendToTurboDownloader(url, filename) {
  try {
    const res = await fetch(`${SERVER_URL}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        filename: filename || undefined,
        connectionsPerInterface: 2
      })
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    return { success: true, task: data };
  } catch (err) {
    console.error('[Turbo Download Manager Extension] Failed to send download:', err);
    return { success: false, error: err.message };
  }
}

// 1. Intercept Browser Downloads
chrome.downloads.onCreated.addListener(async (item) => {
  // Check if interception is active
  const { interceptEnabled: isEnabled } = await chrome.storage.local.get('interceptEnabled');
  if (isEnabled === false) return;

  // Don't intercept data: or blob: URLs or internal browser extensions
  if (!item.url || item.url.startsWith('data:') || item.url.startsWith('blob:') || item.url.startsWith('chrome-extension:')) {
    return;
  }

  // Cancel the native Chrome download immediately
  try {
    chrome.downloads.cancel(item.id, async () => {
      chrome.downloads.erase({ id: item.id });

      const result = await sendToTurboDownloader(item.url, item.filename);
      if (result.success) {
        showBadge('⚡', '#00f2fe');
      } else {
        // If Turbo Download Manager server is offline, resume standard download
        console.warn('[Turbo Download Manager Extension] Server unreachable, falling back to native browser download');
      }
    });
  } catch (err) {
    console.error('[Turbo Download Manager Extension] Error cancelling download:', err);
  }
});

// 2. Context Menu Click Handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.linkUrl || info.srcUrl;
  if (!targetUrl) return;

  const result = await sendToTurboDownloader(targetUrl);
  if (result.success) {
    showBadge('OK', '#00f5a0');
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
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 3500);
}
