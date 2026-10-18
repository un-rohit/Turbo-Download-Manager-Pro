const SERVER_URL = 'http://127.0.0.1:4820';
let isRefreshing = false;
let downloadState = { active: [], history: [] };
let pendingCancelId = null;
let busyDownloadActions = new Set();
let downloadErrorTimer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function renderDownloads() {
  const section = document.getElementById('downloadSection');
  const title = document.getElementById('downloadSectionTitle');
  const list = document.getElementById('downloadList');
  const active = downloadState.active.filter(item => ['probing', 'downloading', 'paused'].includes(item.status));
  const completed = downloadState.history.filter(item => item.status === 'completed').slice(0, 3);
  const rows = [];

  active.forEach(item => {
    const id = String(item.id);
    const confirmingCancel = pendingCancelId === id;
    const busy = busyDownloadActions.has(id);
    const total = Number(item.contentLength) || 0;
    const downloaded = Number(item.downloadedBytes) || 0;
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))) : 0;
    const status = item.status === 'probing' ? 'Connecting' : item.status === 'paused' ? 'Paused' : `${percent}%`;
    const progressClass = total > 0 ? '' : ' indeterminate';
    const progressWidth = total > 0 ? `width:${percent}%` : '';
    const controls = confirmingCancel
      ? `<button class="download-action danger" data-action="confirm-cancel" data-id="${escapeHtml(id)}" ${busy ? 'disabled' : ''}>Confirm cancel</button><button class="download-action" data-action="keep" data-id="${escapeHtml(id)}">Keep</button>`
      : `${item.status === 'paused'
        ? `<button class="download-action" data-action="resume" data-id="${escapeHtml(id)}" ${busy ? 'disabled' : ''}>▶ Resume</button>`
        : `<button class="download-action" data-action="pause" data-id="${escapeHtml(id)}" ${busy || item.status === 'probing' ? 'disabled' : ''}>Ⅱ Pause</button>`}
        <button class="download-action danger" data-action="cancel" data-id="${escapeHtml(id)}" ${busy ? 'disabled' : ''}>✕ Cancel</button>`;

    rows.push(`<article class="download-item">
      <div class="download-item-head"><span class="download-name" title="${escapeHtml(item.filename || 'download')}">${escapeHtml(item.filename || 'download')}</span><span class="download-status">${status}</span></div>
      <div class="download-progress${progressClass}" aria-label="${total > 0 ? `${percent}% downloaded` : 'Download progress'}"><span style="${progressWidth}"></span></div>
      <div class="download-item-meta"><span>${formatBytes(downloaded)}${total > 0 ? ` / ${formatBytes(total)}` : ' downloaded'}</span><span>${formatSpeed(item.currentSpeed || 0)}</span></div>
      <div class="download-actions">${controls}</div>
    </article>`);
  });

  completed.forEach(item => {
    const id = String(item.id);
    const busy = busyDownloadActions.has(id);
    rows.push(`<article class="download-item completed-download">
      <div class="download-item-head"><span class="download-name" title="${escapeHtml(item.filename || 'download')}">${escapeHtml(item.filename || 'download')}</span><span class="download-status">Complete</span></div>
      <div class="download-item-meta"><span>${formatBytes(item.downloadedBytes ?? item.contentLength)}</span></div>
      <div class="download-actions">
        <button class="download-action" data-action="open-file" data-id="${escapeHtml(id)}" ${busy ? 'disabled' : ''}>Open file</button>
        <button class="download-action" data-action="open-folder" data-id="${escapeHtml(id)}" ${busy ? 'disabled' : ''}>Open folder</button>
      </div>
    </article>`);
  });

  section.hidden = rows.length === 0;
  title.textContent = active.length ? `Downloads · ${active.length} active` : 'Recent downloads';
  list.innerHTML = rows.join('');
}

function showDownloadError(message) {
  const error = document.getElementById('downloadError');
  error.textContent = message;
  error.hidden = false;
  clearTimeout(downloadErrorTimer);
  downloadErrorTimer = setTimeout(() => { error.hidden = true; }, 5000);
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 KB/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function checkServerStatus() {
  if (isRefreshing) return;
  isRefreshing = true;
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const speedVal = document.getElementById('speedValue');
  const activeJobs = document.getElementById('activeJobsCount');
  const bondedCount = document.getElementById('bondedCount');
  const adapterUsage = document.getElementById('adapterUsage');
  const rangeWarning = document.getElementById('rangeWarning');

  try {
    const res = await fetch(`${SERVER_URL}/api/downloads`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Not 200');
    const data = await res.json();

    statusPill.className = 'status-pill online';
    statusText.textContent = 'CONNECTED';

    downloadState = { active: data.active || [], history: data.history || [] };
    renderDownloads();
    const inFlight = downloadState.active.filter(d => d.status === 'downloading');
    const activeJobsList = downloadState.active.filter(d => ['probing', 'downloading', 'paused'].includes(d.status));
    const singleConnectionTask = inFlight.find(d => d.supportsRanges === false || d.forceSingleConnection);
    rangeWarning.hidden = !singleConnectionTask;
    rangeWarning.textContent = singleConnectionTask?.supportsRanges === false
      ? '⚠ This host allows one connection only. If interrupted, the download restarts from the beginning.'
      : '⚠ Segmented transfer failed. Turbo is continuing on one connection.';
    let totalSpeed = 0;
    inFlight.forEach(d => totalSpeed += (d.currentSpeed || 0));

    const usedAdapters = new Map();
    inFlight.forEach(download => {
      (download.interfaces || []).forEach(iface => {
        if ((iface.activeStreams || 0) > 0 || (iface.currentSpeed || 0) > 0) {
          usedAdapters.set(iface.address || iface.name, iface.name || iface.label || iface.address);
        }
      });
    });
    adapterUsage.textContent = usedAdapters.size
      ? [...usedAdapters.values()].join(' · ')
      : (inFlight.length ? 'Connecting to adapters…' : 'No active download');

    speedVal.textContent = formatSpeed(totalSpeed);
    activeJobs.textContent = activeJobsList.length.toString();

    // Query interfaces
    const ifacesRes = await fetch(`${SERVER_URL}/api/interfaces`);
    const ifacesData = await ifacesRes.json();
    const onlineIfaces = (ifacesData.interfaces || []).filter(i => i.online);
    bondedCount.textContent = onlineIfaces.length.toString();
  } catch (err) {
    statusPill.className = 'status-pill offline';
    statusText.textContent = 'APP OFFLINE';
    speedVal.textContent = '0 KB/s';
    activeJobs.textContent = '0';
    bondedCount.textContent = '0';
    adapterUsage.textContent = 'App unavailable';
    rangeWarning.hidden = true;
    downloadState = { active: [], history: [] };
    pendingCancelId = null;
    renderDownloads();
  } finally {
    isRefreshing = false;
  }
}

async function runDownloadAction(action, id) {
  const isHistoryAction = action === 'open-file' || action === 'open-folder';
  const endpoint = isHistoryAction
    ? `${SERVER_URL}/api/download-history/${encodeURIComponent(id)}/${action}`
    : `${SERVER_URL}/api/downloads/${encodeURIComponent(id)}/${action}`;
  const response = await fetch(endpoint, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
}

document.addEventListener('DOMContentLoaded', () => {
  const chkIntercept = document.getElementById('chkIntercept');

  // Load stored state
  chrome.storage.local.get(['interceptEnabled'], (res) => {
    chkIntercept.checked = res.interceptEnabled !== false;
  });

  chkIntercept.addEventListener('change', () => {
    chrome.storage.local.set({ interceptEnabled: chkIntercept.checked });
  });

  document.getElementById('downloadList').addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'keep') {
      pendingCancelId = null;
      renderDownloads();
      return;
    }
    if (action === 'cancel') {
      pendingCancelId = id;
      renderDownloads();
      return;
    }
    if (action === 'confirm-cancel') pendingCancelId = null;
    busyDownloadActions.add(id);
    renderDownloads();
    try {
      await runDownloadAction(action === 'confirm-cancel' ? 'cancel' : action, id);
      await checkServerStatus();
    } catch (err) {
      showDownloadError(err.message || 'Could not update this download.');
    } finally {
      busyDownloadActions.delete(id);
      renderDownloads();
    }
  });

  document.getElementById('btnOpenTab').addEventListener('click', () => {
    chrome.tabs.create({ url: SERVER_URL });
  });

  document.getElementById('btnOpenApp').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Opening app…';
    try {
      const res = await fetch(`${SERVER_URL}/api/open-app`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open the desktop app');
      window.close();
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Open in App';
      button.title = err.message;
      button.textContent = 'Restart app to enable';
      setTimeout(() => {
        if (button.isConnected) {
          button.textContent = 'Open in App';
          button.title = '';
        }
      }, 2500);
    }
  });

  checkServerStatus();
  setInterval(checkServerStatus, 2000);
});
