// State
let networkInterfaces = [];
let selectedInterfaces = new Set();
let activeDownloads = new Map();
let downloadHistory = [];
let probedData = null;
let probedInputUrl = '';
let probedAt = 0;
const selectedHistoryIds = new Set();
let historyBulkActionInProgress = false;
const speedTestResults = new Map();
const downloadMenuOrigins = new WeakMap();
const expandedDownloadDetails = new Set();
let adapterScanInitialized = false;
let adapterScanInProgress = false;
let adapterScanTimer = null;
let speedTestInProgress = false;
let activeSpeedTestId = null;
const promptedAdapterAddresses = new Set();
const pendingAdapterPrompts = [];
let activeAdapterPrompt = null;
let appDialogQueue = Promise.resolve();

// Color Palette for Segment Visualization (per interface)
const INTERFACE_COLORS = [
  '#00f2fe', // Cyan
  '#00f5a0', // Emerald
  '#ffb800', // Amber
  '#8a2be2', // Purple
  '#ff3366', // Rose
  '#3b82f6'  // Blue
];

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function describeDownloadError(error) {
  const detail = String(error || '').trim();
  if (!detail) return 'No data was saved. Check the download link and try again.';
  if (/HTTP\s+(401|403)\b/i.test(detail)) return 'The server denied access. Sign in or get a fresh download link, then retry.';
  if (/HTTP\s+(404|410)\b/i.test(detail)) return 'The file is no longer available at this link. Get a new download link.';
  if (/HTTP\s+429\b/i.test(detail)) return 'The server is receiving too many requests. Wait a little, then retry.';
  if (/HTTP\s+5\d\d\b/i.test(detail)) return 'The file host had a server error. Wait a little, then retry.';
  if (/does not support byte-range|not support.*range|cannot resume/i.test(detail)) return 'This host cannot resume partial downloads. Retrying will start from the beginning.';
  if (/could not write|enospc|disk full|permission denied|access is denied/i.test(detail)) return 'Turbo could not save the file. Check the destination folder and available disk space.';
  if (/timed out|timeout|connection interrupted|socket|network route|closed the connection|ended early|incomplete|reset/i.test(detail)) return 'The connection stopped before the file finished. Check your internet connection, then retry.';
  if (/text\/html|web page|html document|browser challenge/i.test(detail)) return 'The link returned a web page instead of the file. Open the page and copy its direct download link.';
  return detail;
}

function showAppDialog({ kind = 'alert', title = '', message = '', value = '', confirmLabel = '', danger = false } = {}) {
  const dialogRoot = document.getElementById('appDialogBackdrop');
  if (!dialogRoot) {
    console.error('App dialog markup is unavailable.');
    return Promise.resolve(kind === 'confirm' ? false : kind === 'prompt' ? null : undefined);
  }

  const runDialog = () => new Promise(resolve => {
    const titleNode = document.getElementById('appDialogTitle');
    const messageNode = document.getElementById('appDialogMessage');
    const input = document.getElementById('appDialogInput');
    const cancelButton = document.getElementById('appDialogCancel');
    const confirmButton = document.getElementById('appDialogConfirm');
    const previousFocus = document.activeElement;
    const hasCancel = kind !== 'alert';
    titleNode.textContent = title || (kind === 'alert' ? 'Notice' : kind === 'prompt' ? 'Enter a value' : 'Please confirm');
    messageNode.textContent = message;
    input.hidden = kind !== 'prompt';
    input.value = value;
    cancelButton.hidden = !hasCancel;
    cancelButton.textContent = 'Cancel';
    confirmButton.textContent = confirmLabel || (kind === 'alert' ? 'OK' : kind === 'prompt' ? 'Save' : 'Continue');
    confirmButton.classList.toggle('is-danger', danger);
    dialogRoot.hidden = false;
    document.body.classList.add('has-app-dialog');

    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      dialogRoot.hidden = true;
      document.body.classList.remove('has-app-dialog');
      document.removeEventListener('keydown', onKeyDown, true);
      dialogRoot.removeEventListener('click', onBackdropClick);
      confirmButton.removeEventListener('click', onConfirm);
      cancelButton.removeEventListener('click', onCancel);
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(result);
    };
    const onConfirm = () => finish(kind === 'prompt' ? input.value : true);
    const onCancel = () => finish(kind === 'confirm' ? false : null);
    const onBackdropClick = event => { if (event.target === dialogRoot) onCancel(); };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'Enter' && event.target !== cancelButton) {
        event.preventDefault();
        onConfirm();
      } else if (event.key === 'Tab') {
        const focusable = [input, cancelButton, confirmButton].filter(el => !el.hidden && !el.disabled);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };

    confirmButton.addEventListener('click', onConfirm);
    cancelButton.addEventListener('click', onCancel);
    dialogRoot.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown, true);
    (kind === 'prompt' ? input : hasCancel ? cancelButton : confirmButton).focus();
  });

  const nextDialog = appDialogQueue.then(runDialog, runDialog);
  appDialogQueue = nextDialog.then(() => undefined, () => undefined);
  return nextDialog;
}

function appAlert(message, options = {}) {
  return showAppDialog({ ...options, kind: 'alert', message });
}

function appConfirm(message, options = {}) {
  return showAppDialog({ ...options, kind: 'confirm', message });
}

function appPrompt(message, value = '', options = {}) {
  return showAppDialog({ ...options, kind: 'prompt', message, value });
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// 1. Fetch & Render Network Interfaces
function queueNewAdapterPrompt(iface) {
  if (!iface?.address || selectedInterfaces.has(iface.address) || promptedAdapterAddresses.has(iface.address)) return;
  promptedAdapterAddresses.add(iface.address);
  pendingAdapterPrompts.push(iface);
  showNextAdapterPrompt();
}

function showNextAdapterPrompt() {
  if (activeAdapterPrompt || pendingAdapterPrompts.length === 0) return;
  const prompt = document.getElementById('newAdapterPrompt');
  const message = document.getElementById('newAdapterPromptMessage');
  if (!prompt || !message) return;

  activeAdapterPrompt = pendingAdapterPrompts.shift();
  const routeStatus = activeAdapterPrompt.online ? 'is online' : 'has no verified internet route yet';
  message.textContent = `${activeAdapterPrompt.name} (${activeAdapterPrompt.label}) was detected and ${routeStatus}. Use it for new downloads?`;
  prompt.hidden = false;
}

function resolveNewAdapterPrompt(useAdapter) {
  const iface = activeAdapterPrompt;
  activeAdapterPrompt = null;
  const prompt = document.getElementById('newAdapterPrompt');
  if (prompt) prompt.hidden = true;

  if (useAdapter && iface && networkInterfaces.some(item => item.address === iface.address) && !selectedInterfaces.has(iface.address)) {
    window.toggleAdapter(iface.address);
  }

  window.setTimeout(showNextAdapterPrompt, 120);
}

async function loadInterfaces(options = {}) {
  if (adapterScanInProgress) return;
  adapterScanInProgress = true;
  const silent = options?.silent === true;
  const spinner = document.getElementById('scanSpinner');
  if (spinner && !silent) spinner.style.display = 'inline-block';

  try {
    const res = await fetch(options?.silent ? '/api/interfaces' : '/api/interfaces?refresh=true');
    if (!res.ok) throw new Error(`Adapter scan failed with HTTP ${res.status}`);
    const data = await res.json();
    const wasInitialized = adapterScanInitialized;
    const previousAddresses = new Set(networkInterfaces.map(iface => iface.address));
    const nextInterfaces = data.interfaces || [];

    if (!adapterScanInitialized) {
      // Preserve the current startup behavior for adapters already connected when the app opens.
      selectedInterfaces.clear();
      nextInterfaces.forEach(iface => {
        if (iface.online) selectedInterfaces.add(iface.address);
      });
      adapterScanInitialized = true;
    } else {
      const presentAddresses = new Set(nextInterfaces.map(iface => iface.address));
      for (const address of selectedInterfaces) {
        if (!presentAddresses.has(address)) selectedInterfaces.delete(address);
      }
    }

    networkInterfaces = nextInterfaces;

    renderAdapters();
    updateHeaderHud();

    if (wasInitialized) {
      networkInterfaces.forEach(iface => {
        if (!previousAddresses.has(iface.address)) queueNewAdapterPrompt(iface);
      });
    }
  } catch (err) {
    console.error('Error fetching interfaces:', err);
  } finally {
    if (spinner && !silent) spinner.style.display = 'none';
    adapterScanInProgress = false;
    if (!adapterScanTimer) {
      adapterScanTimer = window.setInterval(() => {
        if (!document.hidden) loadInterfaces({ silent: true });
      }, 15000);
    }
  }
}

function renderAdapters() {
  const container = document.getElementById('adapterList');
  if (!container) return;

  if (networkInterfaces.length === 0) {
    container.innerHTML = `<div class="empty-state">No network adapters detected. Connect Wi-Fi, Ethernet, or USB Tethering and click Refresh.</div>`;
    return;
  }

  container.innerHTML = networkInterfaces.map((iface, index) => {
    const isSelected = selectedInterfaces.has(iface.address);
    const color = INTERFACE_COLORS[index % INTERFACE_COLORS.length];
    const safeId = iface.address.replace(/[^a-zA-Z0-9]/g, '_');
    const name = escapeHtml(iface.name || 'Network adapter');
    const label = escapeHtml(iface.label || 'Network adapter');
    const icon = escapeHtml(iface.icon || '📶');
    const statusClass = !isSelected ? 'paused' : (iface.online ? 'online' : 'offline');

    return `
      <div class="adapter-compact-card ${isSelected ? 'active-bonded' : 'adapter-paused'}" id="adapter-${safeId}">
        <div class="adapter-left">
          <div class="adapter-icon-box-compact" style="color: ${isSelected ? color : '#64748b'}">
            ${icon}
          </div>
          <div class="adapter-info-compact">
            <div class="adapter-name-row">
              <span class="adapter-name-text">${name}</span>
              <span class="status-indicator ${statusClass}" title="${!isSelected ? 'Paused' : (iface.online ? 'Online' : 'No Route')}"></span>
              ${!isSelected ? '<span class="paused-tag">PAUSED</span>' : ''}
            </div>
            <div class="adapter-sub-row">
              <span class="adapter-type-pill">${label}</span>
              <span id="speedtest-badge-${safeId}" class="speedtest-result-badge compact-badge" style="display: none;"></span>
            </div>
          </div>
        </div>

        <div class="adapter-right">
          <div class="adapter-speed-col">
            <span class="adapter-live-speed mono" id="speed-${safeId}">${!isSelected ? 'PAUSED' : '0 B/s'}</span>
          </div>

          <div class="adapter-btn-group">
            <button type="button" class="btn btn-xs ${isSelected ? 'btn-pause-device' : 'btn-resume-device'}" onclick="toggleAdapter('${iface.address}')" title="${isSelected ? 'Pause adapter from downloads' : 'Resume adapter in bonding'}">
              ${isSelected ? '⏸ Pause' : '▶ Resume'}
            </button>
            <button type="button" class="btn btn-xs btn-glass btn-icon-test" onclick="testSingleAdapterSpeed('${iface.address}')" title="Test adapter speed (5s)" ${speedTestInProgress ? 'disabled' : ''}>
              ⚡ Test
            </button>
            <label class="switch-wrap switch-sm" title="${isSelected ? 'Channel bonding enabled' : 'Paused'}">
              <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleAdapter('${iface.address}')">
            </label>
          </div>
        </div>
      </div>
    `;
  }).join('');

  for (const iface of networkInterfaces) {
    const result = speedTestResults.get(iface.address);
    if (result) applySpeedTestResult(iface.address, result);
  }
}

window.toggleAdapter = async function(address) {
  const willEnable = !selectedInterfaces.has(address);
  if (willEnable) {
    selectedInterfaces.add(address);
  } else {
    selectedInterfaces.delete(address);
  }
  renderAdapters();
  updateHeaderHud();
  if (window.energyFlowVisualizer) {
    window.energyFlowVisualizer.updateData();
  }

  try {
    await fetch('/api/interfaces/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, enabled: willEnable })
    });
  } catch (err) {
    console.error('Failed to toggle interface on backend:', err);
  }
};

window.toggleDownloadInterface = async function(downloadId, address, enabled) {
  try {
    const res = await fetch(`/api/downloads/${downloadId}/toggle-interface`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, enabled })
    });
    const data = await res.json();
    const task = activeDownloads.get(downloadId);
    if (task && task.interfaces) {
      const target = task.interfaces.find(i => i.address === address);
      if (target) {
        target.paused = !enabled;
      }
      renderActiveDownloads();
    }
  } catch (err) {
    console.error('Failed to toggle download interface:', err);
  }
};

function updateHeaderHud() {
  const activeCountEl = document.getElementById('activeIfacesCount');
  if (activeCountEl) {
    activeCountEl.textContent = `${selectedInterfaces.size} BONDED`;
  }
}

// 2. Server-Sent Events (SSE) Listener
function initSSE() {
  const es = new EventSource('/api/events');

  es.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    activeDownloads.clear();
    data.active.forEach(item => activeDownloads.set(item.id, item));
    downloadHistory = data.history || [];
    renderActiveDownloads();
    renderHistory();
  });

  es.addEventListener('download_update', (e) => {
    const item = JSON.parse(e.data);

    if (item.status === 'completed' || item.status === 'error') {
      activeDownloads.delete(item.id);
      const idx = downloadHistory.findIndex(h => h.id === item.id);
      if (idx >= 0) downloadHistory[idx] = item;
      else downloadHistory.unshift(item);
      downloadHistory = downloadHistory.slice(0, 50);
      renderHistory();
    } else {
      activeDownloads.set(item.id, item);
    }

    renderActiveDownloads();
    updateGlobalSpeed();
  });

  es.addEventListener('speedtest_progress', (e) => {
    try {
      const prog = JSON.parse(e.data);
      if (prog.testId === activeSpeedTestId && Number(prog.remainingSec) > 0 && prog.localAddress) {
        const safeId = prog.localAddress.replace(/[^a-zA-Z0-9]/g, '_');
        const badge = document.getElementById(`speedtest-badge-${safeId}`);
        if (badge?.classList.contains('testing')) {
          badge.style.display = 'inline-block';
          const rem = prog.remainingSec !== undefined ? `[${prog.remainingSec}s] ` : '';
          badge.textContent = `${rem}${prog.currentMbps} Mbps (${prog.ping}ms)`;
        }
        const liveSpeedEl = document.getElementById(`speed-${safeId}`);
        if (liveSpeedEl) {
          liveSpeedEl.textContent = `${(prog.currentMbps / 8).toFixed(1)} MB/s`;
        }
        if (window.energyFlowVisualizer) {
          const speeds = {};
          speeds[prog.localAddress] = (prog.currentMbps * 1024 * 1024) / 8;
          window.energyFlowVisualizer.updateData(speeds, speeds[prog.localAddress]);
        }
      }
    } catch {}
  });

  es.addEventListener('speedtest_complete', () => {
    try {
      // Immediately reset visualizer and adapter live speed badges once test ends
      updateGlobalSpeed();
      if (networkInterfaces) {
        networkInterfaces.forEach(iface => {
          const safeId = iface.address.replace(/[^a-zA-Z0-9]/g, '_');
          const liveSpeedEl = document.getElementById(`speed-${safeId}`);
          if (liveSpeedEl && activeDownloads.size === 0) {
            const isSelected = selectedInterfaces.has(iface.address);
            liveSpeedEl.textContent = isSelected ? '0 B/s' : 'PAUSED';
          }
        });
      }
    } catch {}
  });

  es.addEventListener('interface_status_update', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.address) {
        const iface = networkInterfaces.find(i => i.address === data.address);
        if (iface) {
          const wasOnline = iface.online;
          iface.online = !!data.online;
          if (iface.online && !wasOnline) {
            queueNewAdapterPrompt(iface);
          }
          renderAdapters();
          updateHeaderHud();
        }
      }
    } catch {}
  });

  es.onerror = () => {
    console.warn('SSE disconnected, retrying...');
  };
}

function updateGlobalSpeed() {
  let totalSpeed = 0;
  const adapterSpeeds = {};

  for (const item of activeDownloads.values()) {
    if (item.status === 'downloading') {
      totalSpeed += item.currentSpeed || 0;
      if (item.interfaces) {
        item.interfaces.forEach(iface => {
          adapterSpeeds[iface.address] = (adapterSpeeds[iface.address] || 0) + (iface.currentSpeed || 0);
        });
      }
    }
  }

  // Windows may report aggregate download throughput while per-adapter byte
  // counters remain zero (for example when traffic uses the default route).
  // Attribute only the unreported portion across enabled adapters so the flow
  // canvas still reflects active downloads without inflating the total.
  const attributedSpeed = Object.values(adapterSpeeds).reduce((sum, speed) => sum + speed, 0);
  const unreportedSpeed = Math.max(0, totalSpeed - attributedSpeed);
  if (unreportedSpeed > 0) {
    const eligibleInterfaces = networkInterfaces.filter(iface =>
      selectedInterfaces.size === 0 ? iface.online : selectedInterfaces.has(iface.address)
    );
    if (eligibleInterfaces.length > 0) {
      const share = unreportedSpeed / eligibleInterfaces.length;
      eligibleInterfaces.forEach(iface => {
        adapterSpeeds[iface.address] = (adapterSpeeds[iface.address] || 0) + share;
      });
    }
  }

  const speedEl = document.getElementById('globalSpeed');
  if (speedEl) {
    speedEl.textContent = formatSpeed(totalSpeed);
  }

  // Update individual adapter speed tags (ensuring zero when paused)
  if (networkInterfaces && networkInterfaces.length > 0) {
    networkInterfaces.forEach(iface => {
      const safeId = iface.address.replace(/[^a-zA-Z0-9]/g, '_');
      const el = document.getElementById(`speed-${safeId}`);
      if (el) {
        el.textContent = formatSpeed(adapterSpeeds[iface.address] || 0);
      }
    });
  } else {
    for (const addr in adapterSpeeds) {
      const safeId = addr.replace(/[^a-zA-Z0-9]/g, '_');
      const el = document.getElementById(`speed-${safeId}`);
      if (el) {
        el.textContent = formatSpeed(adapterSpeeds[addr]);
      }
    }
  }

  // Update Quantum Energy Flow Visualizer
  if (window.energyFlowVisualizer) {
    window.energyFlowVisualizer.updateData(adapterSpeeds, totalSpeed);
  }
}

// 3. Render Active Downloads & Segment Visualizer
function renderActiveDownloads() {
  const container = document.getElementById('activeList');
  const badge = document.getElementById('activeTasksBadge');
  if (!container) return;

  const inFlight = Array.from(activeDownloads.values()).filter(d => d.status === 'downloading' || d.status === 'probing' || d.status === 'paused');
  const activeIds = new Set(inFlight.map(item => item.id));
  for (const id of expandedDownloadDetails) {
    if (!activeIds.has(id)) expandedDownloadDetails.delete(id);
  }
  if (badge) badge.textContent = `${inFlight.length} IN FLIGHT`;

  if (inFlight.length === 0) {
    container.innerHTML = `
      <div class="empty-downloads">
        <div class="empty-icon">📂</div>
        <h3>No Active Downloads</h3>
        <p>Paste a file link to start multi-interface accelerated downloading.</p>
        <button id="btnEmptyNew" class="btn btn-secondary" onclick="openNewModal()">Add Download URL</button>
      </div>
    `;
    return;
  }

  container.innerHTML = inFlight.map(item => {
    const percent = (item.progress * 100).toFixed(1);
    const filename = escapeHtml(item.filename || 'download.bin');
    const isPaused = item.status === 'paused';
    const showDetails = expandedDownloadDetails.has(item.id);

    // Segment block map
    const segmentsHtml = showDetails ? (item.segments || []).map(seg => {
      let stateClass = '';
      if (seg.done) stateClass = 'done';
      else if (seg.active && !isPaused) stateClass = 'in-flight';

      return `<div class="segment-block ${stateClass}" title="Segment ${seg.id}: ${formatBytes(seg.downloaded)} / ${formatBytes(seg.total)}">${seg.id}</div>`;
    }).join('') : '';

    // Per-interface contribution pills with individual pause/resume controls
    const contribsHtml = showDetails ? (item.interfaces || []).map((iface, idx) => {
      const isIfacePaused = !!iface.paused;
      const color = INTERFACE_COLORS[idx % INTERFACE_COLORS.length];
      return `
        <div class="contrib-pill ${isIfacePaused ? 'contrib-pill-paused' : ''}">
          <span class="contrib-dot" style="background: ${isIfacePaused ? '#ffb800' : color}"></span>
          <span><strong>${escapeHtml(iface.name || 'Network adapter')}</strong>: ${formatBytes(iface.bytesDownloaded)} (${isIfacePaused ? '<span style="color:#ffb800;">PAUSED</span>' : (isPaused ? '0 B/s' : formatSpeed(iface.currentSpeed))})</span>
          <button type="button" class="btn btn-xs ${isIfacePaused ? 'btn-resume-device' : 'btn-pause-device'}" onclick="toggleDownloadInterface('${item.id}', '${iface.address}', ${isIfacePaused})" title="${isIfacePaused ? 'Resume this device — it will resume downloading' : 'Pause this device — other devices will complete its download'}">
            ${isIfacePaused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      `;
    }).join('') : '';

    const connectionCount = (item.interfaces || []).length;
    const segmentCount = (item.segments || []).length;
    const rangeWarning = item.supportsRanges === false
      ? '<div class="task-range-warning">⚠ Single connection: this host does not support byte ranges. Pause/resume or interruption restarts from 0.</div>'
      : (item.forceSingleConnection
        ? '<div class="task-range-warning">⚠ Segmented transfer failed. Continuing carefully on one connection.</div>'
        : '');
    const actionError = item.actionError
      ? `<div class="task-action-error">${escapeHtml(item.actionError)}</div>`
      : '';

    return `
      <article class="task-card task-card-compact ${isPaused ? 'task-card-paused' : ''}">
        <div class="task-compact-head">
          <div class="task-compact-file">
            <span class="task-status-mark ${isPaused ? 'is-paused' : ''}" aria-hidden="true"></span>
            <div class="task-compact-copy">
              <div class="task-filename" title="${filename}">${filename}</div>
              <div class="task-sub-meta mono">
                ${formatBytes(item.downloadedBytes)} / ${formatBytes(item.contentLength)} · ${percent}% · ${isPaused ? '<span class="task-paused-label">Paused</span>' : `ETA ${formatEta(item.etaSeconds)}`}
              </div>
            </div>
          </div>

          <div class="task-compact-actions">
            ${isPaused ?
              `<button class="btn btn-xs btn-accent" onclick="resumeDownload('${item.id}')">▶ Resume</button>` :
              `<button class="btn btn-xs btn-glass" onclick="pauseDownload('${item.id}')">⏸ Pause</button>`
            }
            <button class="btn btn-xs btn-glass" onclick="cancelDownload('${item.id}')">✕ Cancel</button>
            <div class="action-menu-wrap">
              <button type="button" class="btn btn-xs btn-glass" onclick="toggleDownloadMenu(event, 'active-${item.id}')">More ▾</button>
              <div id="active-${item.id}" class="download-action-menu" hidden>
                <button type="button" onclick="openActiveDownloadFolder('${item.id}')">Open download folder</button>
                <button type="button" onclick="copyDownloadUrl('${item.id}', 'active')">Copy download link</button>
                <button type="button" class="danger-action" onclick="restartDownload('${item.id}')">Restart from beginning</button>
              </div>
            </div>
          </div>
        </div>

        <div class="task-compact-progress">
          <div class="task-progress-meta">
            <span class="task-progress-status ${isPaused ? 'is-paused' : ''}">${isPaused ? 'Paused' : item.status}</span>
            <span class="mono task-progress-speed">${isPaused ? '—' : formatSpeed(item.currentSpeed)}</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${percent}%; ${isPaused ? 'background: #ffb800;' : ''}"></div>
          </div>
          ${rangeWarning}
          ${actionError}
        </div>

        <div class="task-details ${showDetails ? 'is-open' : ''}">
          <button type="button" class="task-details-toggle" onclick="toggleDownloadDetails('${item.id}')" aria-expanded="${showDetails}" aria-controls="details-${item.id}">
            <span>${showDetails ? 'Hide network details' : 'Network details'}</span>
            <span class="task-details-count">${segmentCount} segments · ${connectionCount} adapters</span>
          </button>
          <div id="details-${item.id}" class="task-details-content" ${showDetails ? '' : 'hidden'}>
            <div class="segment-map-title">DYNAMIC MULTI-INTERFACE CHUNK MAP</div>
            <div class="segment-grid">
              ${segmentsHtml || '<div style="color: #64748b; font-size: 0.75rem">Allocating segments across bonded interfaces...</div>'}
            </div>
            <div class="adapter-contribution-row">${contribsHtml}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

window.toggleDownloadDetails = function(id) {
  if (expandedDownloadDetails.has(id)) expandedDownloadDetails.delete(id);
  else expandedDownloadDetails.add(id);
  closeDownloadMenus();
  renderActiveDownloads();
};

// 4. Download Controls
window.pauseDownload = async function(id) {
  let item = activeDownloads.get(id);
  try {
    await postDownloadAction(`/api/downloads/${id}/pause`);
    item = activeDownloads.get(id) || item;
    if (item) item.actionError = '';
  } catch (err) {
    item = activeDownloads.get(id) || item;
    if (item) item.actionError = `Could not pause: ${err.message}`;
    else await appAlert(`Could not pause download: ${err.message}`, { title: 'Pause failed' });
  } finally {
    renderActiveDownloads();
    updateGlobalSpeed();
  }
};

window.resumeDownload = async function(id) {
  let item = activeDownloads.get(id);
  if (item) {
    if (item.supportsRanges === false && item.downloadedBytes > 0 && !await appConfirm(
      'This host does not support byte-range requests. Turbo cannot resume from the saved partial data, so this will restart the file from the beginning. Continue?',
      { title: 'Resume from the beginning', confirmLabel: 'Restart download' }
    )) return;
  }
  try {
    await postDownloadAction(`/api/downloads/${id}/resume`);
    item = activeDownloads.get(id) || item;
    if (item) item.actionError = '';
  } catch (err) {
    item = activeDownloads.get(id) || item;
    if (item) item.actionError = `Could not resume: ${err.message}`;
    else await appAlert(`Could not resume download: ${err.message}`, { title: 'Resume failed' });
  } finally {
    renderActiveDownloads();
    updateGlobalSpeed();
  }
};

window.cancelDownload = async function(id) {
  if (await appConfirm('Are you sure you want to cancel this download?', { title: 'Cancel download', confirmLabel: 'Cancel download', danger: true })) {
    try {
      await postDownloadAction(`/api/downloads/${id}/cancel`);
      activeDownloads.delete(id);
      renderActiveDownloads();
      updateGlobalSpeed();
    } catch (err) {
      await appAlert(`Could not cancel download: ${err.message}`, { title: 'Cancel failed' });
    }
  }
};

window.toggleDownloadMenu = function(event, menuId) {
  event.stopPropagation();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const shouldOpen = menu.hidden;

  closeDownloadMenus();
  if (!shouldOpen) return;

  const anchor = event.currentTarget.getBoundingClientRect();
  downloadMenuOrigins.set(menu, menu.parentElement);
  document.body.appendChild(menu);
  menu.classList.add('is-floating');
  menu.hidden = false;
  menu.style.visibility = 'hidden';

  const menuRect = menu.getBoundingClientRect();
  const edge = 12;
  const gap = 6;
  const width = Math.min(menuRect.width, window.innerWidth - edge * 2);
  const height = Math.min(menuRect.height, window.innerHeight - edge * 2);
  const left = Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge));
  const roomBelow = window.innerHeight - anchor.bottom - edge;
  const roomAbove = anchor.top - edge;
  const top = roomBelow >= height + gap || roomBelow >= roomAbove
    ? Math.min(anchor.bottom + gap, window.innerHeight - height - edge)
    : Math.max(edge, anchor.top - height - gap);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.maxHeight = `${height}px`;
  menu.style.visibility = '';
};

function closeDownloadMenus() {
  document.querySelectorAll('.download-action-menu').forEach(menu => {
    const wasFloating = menu.classList.contains('is-floating');
    menu.hidden = true;
    menu.classList.remove('is-floating');
    menu.style.left = '';
    menu.style.top = '';
    menu.style.maxHeight = '';
    menu.style.visibility = '';

    const origin = downloadMenuOrigins.get(menu);
    if (origin?.isConnected) origin.appendChild(menu);
    else if (wasFloating) menu.remove();
    downloadMenuOrigins.delete(menu);
  });
}

document.addEventListener('click', (event) => {
  if (event.target.closest('.download-action-menu button')) {
    closeDownloadMenus();
    return;
  }
  if (!event.target.closest('.action-menu-wrap, .download-action-menu')) {
    closeDownloadMenus();
  }
});

function outputDirectoryFromPath(outputPath) {
  if (!outputPath) return currentSettings?.downloadDir;
  const separator = Math.max(outputPath.lastIndexOf('\\'), outputPath.lastIndexOf('/'));
  return separator >= 0 ? outputPath.slice(0, separator) : currentSettings?.downloadDir;
}

async function postDownloadAction(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await readApiResponse(response, 'Download action');
  if (!response.ok || data.error) throw new Error(data.error || `Server returned HTTP ${response.status}`);
  return data;
}

async function readApiResponse(response, action = 'Request') {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown content type';
    throw new Error(`${action} returned an invalid response (HTTP ${response.status}, ${contentType})`);
  }
}

function renderProbeFeedback(data, feedback) {
  if (!feedback) return;
  const warnings = [];
  if (data.supportsRanges === false) {
    warnings.push('This host does not support byte-range requests. Turbo will use one connection; adapter bonding and safe resume are unavailable.');
  }
  if (/^text\/html\b/i.test(data.contentType || '') || /\.html?$/i.test(data.filename || '')) {
    warnings.push('This URL appears to return a web page, not a direct file link.');
  }
  if (!Number.isFinite(Number(data.contentLength)) || Number(data.contentLength) <= 0) {
    warnings.push('The server did not report a file size, so completion cannot be verified reliably.');
  }

  feedback.classList.toggle('is-warning', warnings.length > 0);
  feedback.textContent = `Size: ${formatBytes(data.contentLength)} | Range support: ${data.supportsRanges ? 'Yes — segmented and resumable' : 'No — single connection'}${warnings.length ? `\n⚠ ${warnings.join(' ')}` : ''}`;
}

function getProbeWarnings(data) {
  const warnings = [];
  if (data.supportsRanges === false) {
    warnings.push('This server does not support byte-range requests. Turbo must use one connection, cannot use multiple adapters for this file, and cannot resume a partial file. If interrupted, starting again will begin at 0.');
  }
  if (/^text\/html\b/i.test(data.contentType || '') || /\.html?$/i.test(data.filename || '')) {
    warnings.push('The URL appears to return a web page rather than a direct file. It may be a link-generator page or a browser challenge.');
  }
  if (!Number.isFinite(Number(data.contentLength)) || Number(data.contentLength) <= 0) {
    warnings.push('The server did not report a reliable file size, so Turbo cannot verify that the download is complete.');
  }
  return warnings;
}

function getSelectedDownloadInterfaces() {
  return networkInterfaces.filter(iface => selectedInterfaces.has(iface.address));
}

function acceptNewDownload(task) {
  activeDownloads.set(task.id, task);
  renderActiveDownloads();
  updateGlobalSpeed();
}

window.redownloadHistoryItem = async function(id) {
  const item = downloadHistory.find(entry => entry.id === id);
  if (!item?.url) return appAlert('The original download link is not available.', { title: 'Cannot download again' });
  try {
    const task = await postDownloadAction('/api/downloads', {
      url: item.url,
      filename: item.filename,
      outputDir: outputDirectoryFromPath(item.outputPath),
      interfaces: getSelectedDownloadInterfaces(),
      connectionsPerInterface: currentSettings?.connectionsPerAdapter || 4
    });
    acceptNewDownload(task);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    await appAlert(`Could not restart download: ${err.message}`, { title: 'Download could not start' });
  }
};

window.removeHistoryItem = async function(id) {
  if (!await appConfirm('Remove this item from download history? The downloaded file will stay on your computer.', { title: 'Remove from history', confirmLabel: 'Remove' })) return;
  try {
    await postDownloadAction(`/api/download-history/${id}/remove`);
    downloadHistory = downloadHistory.filter(item => item.id !== id);
    renderHistory();
  } catch (err) {
    await appAlert(`Could not remove history item: ${err.message}`, { title: 'Could not remove item' });
  }
};

window.deleteHistoryFile = async function(id) {
  const item = downloadHistory.find(entry => entry.id === id);
  if (!await appConfirm(`Permanently delete '${item?.filename || 'this file'}' from your computer and remove it from history?`, { title: 'Delete downloaded file', confirmLabel: 'Delete file', danger: true })) return;
  try {
    await postDownloadAction(`/api/download-history/${id}/delete-file`);
    downloadHistory = downloadHistory.filter(entry => entry.id !== id);
    renderHistory();
  } catch (err) {
    await appAlert(`Could not delete downloaded file: ${err.message}`, { title: 'Could not delete file' });
  }
};

window.copyDownloadUrl = async function(id, source) {
  const item = source === 'active' ? activeDownloads.get(id) : downloadHistory.find(entry => entry.id === id);
  if (!item?.url) return appAlert('The download link is not available.', { title: 'Link unavailable' });
  try {
    await navigator.clipboard.writeText(item.url);
  } catch (err) {
    await appAlert(`Could not copy download link: ${err.message}`, { title: 'Could not copy link' });
  }
};

window.openActiveDownloadFolder = async function(id) {
  const item = activeDownloads.get(id);
  if (item) await window.openOutputFolder(outputDirectoryFromPath(item.outputPath));
};

window.restartDownload = async function(id) {
  const item = activeDownloads.get(id);
  if (!item) return;
  if (!await appConfirm(`Cancel '${item.filename}' and delete its partial file, then start it again from the beginning?`, { title: 'Restart download', confirmLabel: 'Restart', danger: true })) return;
  try {
    await postDownloadAction(`/api/downloads/${id}/cancel`);
    activeDownloads.delete(id);
    renderActiveDownloads();
    const task = await postDownloadAction('/api/downloads', {
      url: item.url,
      filename: item.filename,
      outputDir: outputDirectoryFromPath(item.outputPath),
      interfaces: getSelectedDownloadInterfaces(),
      connectionsPerInterface: currentSettings?.connectionsPerAdapter || 4
    });
    acceptNewDownload(task);
  } catch (err) {
    await appAlert(`Could not restart download: ${err.message}`, { title: 'Could not restart download' });
  }
};

// 5. Render History
function renderHistory() {
  closeDownloadMenus();
  const tbody = document.getElementById('historyList');
  if (!tbody) return;

  if (downloadHistory.length === 0) {
    selectedHistoryIds.clear();
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">No completed downloads yet</td></tr>`;
    updateHistoryBulkControls();
    return;
  }

  const availableIds = new Set(downloadHistory.map(item => String(item.id)));
  for (const id of selectedHistoryIds) {
    if (!availableIds.has(id)) selectedHistoryIds.delete(id);
  }

  tbody.innerHTML = downloadHistory.map(item => {
    const itemId = String(item.id);
    const isSelected = selectedHistoryIds.has(itemId);
    const date = item.completedAt || item.updatedAt ? new Date(item.completedAt || item.updatedAt) : null;
    const dateStr = date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : '—';
    const size = Number(item.status === 'error' ? (item.downloadedBytes || 0) : (item.downloadedBytes ?? item.contentLength ?? 0));
    const isCompleted = item.status === 'completed' && size > 0;
    const isFailed = item.status === 'error' || (item.status === 'completed' && size === 0);
    const statusText = isCompleted ? 'COMPLETED' : (isFailed ? 'FAILED' : item.status.toUpperCase());
    const filename = escapeHtml(item.filename || 'download.bin');
    const rawError = item.error || (item.supportsRanges === false && size > 0 ? 'This host cannot resume partial downloads.' : '');
    const errorSummary = describeDownloadError(rawError);
    const historyDetails = [
      item.error,
      item.supportsRanges === false ? 'This host does not support byte-range requests. The download used one connection and cannot resume from its partial data.' : ''
    ].filter(Boolean).join(' ');
    const errorTitle = historyDetails ? ` title="${escapeHtml(historyDetails)}"` : '';
    const sizeLabel = isFailed && size > 0 ? `Partial · ${formatBytes(size)}` : formatBytes(size);

    return `
      <tr class="${isFailed ? 'history-row-failed' : ''}">
        <td class="history-select-cell">
          <input class="history-row-checkbox" type="checkbox" aria-label="Select ${filename}" value="${escapeHtml(itemId)}" ${isSelected ? 'checked' : ''} onchange="toggleHistorySelection(this)">
        </td>
        <td class="history-filename-cell">
          <span class="history-file-name">${filename}</span>
          ${isFailed ? `<div class="history-error-detail" title="${escapeHtml(historyDetails || errorSummary)}"><span>${escapeHtml(errorSummary)}</span><button type="button" class="history-retry-link" onclick="redownloadHistoryItem('${itemId}')">Retry</button></div>` : ''}
        </td>
        <td class="mono"${isFailed && size > 0 ? ` title="${formatBytes(size)} downloaded before the failure${Number(item.contentLength) > size ? ` out of ${formatBytes(Number(item.contentLength))}` : ''}"` : ''}>${sizeLabel}</td>
        <td>
          <span class="count-pill"${errorTitle} style="color: ${isCompleted ? '#00f5a0' : '#ff3366'}">
            ${statusText}
          </span>
        </td>
        <td class="mono">${dateStr}</td>
        <td>
          <div class="action-menu-wrap history-action-wrap">
            <button type="button" class="btn btn-sm btn-glass" onclick="toggleDownloadMenu(event, 'history-${item.id}')">More ▾</button>
            <div id="history-${item.id}" class="download-action-menu" hidden>
              <button type="button" onclick="redownloadHistoryItem('${item.id}')">Download again</button>
              <button type="button" onclick="openHistoryItemFolder('${item.id}')">Show in folder</button>
              <button type="button" onclick="copyDownloadUrl('${item.id}', 'history')">Copy download link</button>
              <button type="button" onclick="removeHistoryItem('${item.id}')">Remove from history</button>
              <button type="button" class="danger-action" onclick="deleteHistoryFile('${item.id}')">Delete downloaded file</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  updateHistoryBulkControls();
}

function updateHistoryBulkControls() {
  const selectAll = document.getElementById('historySelectAll');
  const bulkBar = document.getElementById('historyBulkActions');
  const selectedCount = document.getElementById('historySelectedCount');
  const count = selectedHistoryIds.size;
  const total = downloadHistory.length;
  if (selectAll) {
    selectAll.disabled = total === 0;
    selectAll.checked = total > 0 && count === total;
    selectAll.indeterminate = count > 0 && count < total;
  }
  if (bulkBar) bulkBar.hidden = count === 0;
  if (selectedCount) selectedCount.textContent = `${count} selected`;
  document.querySelectorAll('#historyBulkActions button').forEach(button => {
    button.disabled = historyBulkActionInProgress;
  });
}

window.toggleHistorySelection = function(checkbox) {
  const id = String(checkbox?.value || '');
  if (!id) return;
  if (checkbox.checked) selectedHistoryIds.add(id);
  else selectedHistoryIds.delete(id);
  updateHistoryBulkControls();
};

window.toggleAllHistorySelection = function(checkbox) {
  if (checkbox.checked) {
    downloadHistory.forEach(item => selectedHistoryIds.add(String(item.id)));
  } else {
    selectedHistoryIds.clear();
  }
  renderHistory();
};

window.runHistoryBulkAction = async function(action) {
  if (historyBulkActionInProgress) return;
  const selectedItems = downloadHistory.filter(item => selectedHistoryIds.has(String(item.id)));
  if (!selectedItems.length) return;

  const deletingFiles = action === 'delete-file';
  if (!deletingFiles && action !== 'remove') return;
  const confirmed = deletingFiles
    ? await appConfirm(`Permanently delete ${selectedItems.length} selected file(s) from your computer and remove them from history?`, { title: 'Delete selected files', confirmLabel: 'Delete files', danger: true })
    : await appConfirm(`Remove ${selectedItems.length} selected item(s) from history? Downloaded files will stay on your computer.`, { title: 'Remove selected items', confirmLabel: 'Remove' });
  if (!confirmed) return;

  historyBulkActionInProgress = true;
  updateHistoryBulkControls();
  const routeAction = deletingFiles ? 'delete-file' : 'remove';
  const results = await Promise.allSettled(selectedItems.map(item =>
    postDownloadAction(`/api/download-history/${encodeURIComponent(item.id)}/${routeAction}`)
  ));
  const removedIds = new Set();
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') removedIds.add(String(selectedItems[index].id));
  });

  if (removedIds.size) {
    downloadHistory = downloadHistory.filter(item => !removedIds.has(String(item.id)));
    removedIds.forEach(id => selectedHistoryIds.delete(id));
  }
  historyBulkActionInProgress = false;
  renderHistory();

  const failedCount = results.length - removedIds.size;
  const actionLabel = deletingFiles ? 'deleted' : 'removed from history';
  if (failedCount) {
    await appAlert(`${removedIds.size} item(s) ${actionLabel}. ${failedCount} failed; those items remain selected so you can retry.`, { title: 'Some items could not be processed' });
  } else {
    await appAlert(`${removedIds.size} item(s) ${actionLabel}.`, { title: 'Bulk action complete' });
  }
};

window.openHistoryItemFolder = async function(id) {
  const item = downloadHistory.find(h => h.id === id);
  const targetPath = item ? (item.outputPath || item.filename) : null;
  try {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath })
    });
  } catch (err) {
    console.error('Failed to open folder:', err);
  }
};

window.openOutputFolder = async function(customPath) {
  try {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: customPath || null })
    });
  } catch (err) {
    console.error('Failed to open downloads folder:', err);
  }
};

// 6. Modal & Probe Handler
const modal = document.getElementById('newDownloadModal');
window.openNewModal = function() {
  if (modal) {
    modal.style.display = 'flex';
    populateModalInterfaces();
  }
};

window.closeNewModal = function() {
  if (modal) modal.style.display = 'none';
  const probeFeedback = document.getElementById('probeResultText');
  if (probeFeedback) {
    probeFeedback.textContent = '';
    probeFeedback.classList.remove('is-warning', 'is-error');
  }
  probedData = null;
  probedInputUrl = '';
  probedAt = 0;
};

function populateModalInterfaces() {
  const container = document.getElementById('modalIfaceCheckboxes');
  if (!container) return;

  container.innerHTML = networkInterfaces.map(iface => {
    const isSelected = selectedInterfaces.has(iface.address);
    const name = escapeHtml(iface.name || 'Network adapter');
    const label = escapeHtml(iface.label || 'Network adapter');
    const icon = escapeHtml(iface.icon || '📶');
    const address = escapeHtml(iface.address || '');
    return `
      <label class="iface-checkbox-row">
        <input type="checkbox" value="${address}" ${isSelected ? 'checked' : ''} name="modalIface">
        <span>${icon} <strong>${name}</strong> (${address}) · ${label}</span>
      </label>
    `;
  }).join('');
}

// 7. Settings Modal & Folder Management (IDM Full Configuration)
let currentSettings = null;

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    currentSettings = await res.json();

    // 1. Tab: Save To
    const catSelect = document.getElementById('settingsCategorySelect');
    const chosenCat = catSelect ? catSelect.value : 'General';
    const catDirInput = document.getElementById('settingCategoryDir');
    if (catDirInput && currentSettings.categories) {
      catDirInput.value = currentSettings.categories[chosenCat] || currentSettings.downloadDir || '';
    }

    const tempDirEl = document.getElementById('settingTempDir');
    if (tempDirEl) tempDirEl.value = currentSettings.tempDir || '';

    if (document.getElementById('settingAutoCategorize')) {
      document.getElementById('settingAutoCategorize').checked = currentSettings.autoCategorize !== false;
    }
    if (document.getElementById('settingPromptForSavePath')) {
      document.getElementById('settingPromptForSavePath').checked = currentSettings.promptForSavePath !== false;
    }
    if (document.getElementById('settingRememberLastPath')) {
      document.getElementById('settingRememberLastPath').checked = currentSettings.rememberLastPath !== false;
    }

    // Categories Matrix
    const cats = currentSettings.categories || {};
    if (document.getElementById('catCompressed')) document.getElementById('catCompressed').value = cats.Compressed || '';
    if (document.getElementById('catPrograms')) document.getElementById('catPrograms').value = cats.Programs || '';
    if (document.getElementById('catVideo')) document.getElementById('catVideo').value = cats.Video || '';
    if (document.getElementById('catMusic')) document.getElementById('catMusic').value = cats.Music || '';
    if (document.getElementById('catDocuments')) document.getElementById('catDocuments').value = cats.Documents || '';
    if (document.getElementById('catGeneral')) document.getElementById('catGeneral').value = cats.General || currentSettings.downloadDir || '';

    // 2. Tab: Connection & Speed
    if (document.getElementById('settingConnectionType')) {
      document.getElementById('settingConnectionType').value = currentSettings.connectionType || 'Direct High Speed';
    }
    if (document.getElementById('settingConnectionsPerAdapter')) {
      document.getElementById('settingConnectionsPerAdapter').value = currentSettings.connectionsPerAdapter || 4;
    }
    if (document.getElementById('settingBondingStrategy')) {
      document.getElementById('settingBondingStrategy').value = currentSettings.bondingStrategy || 'dynamic_bonded';
    }
    if (document.getElementById('settingRetryAttempts')) {
      document.getElementById('settingRetryAttempts').value = currentSettings.retryAttempts || 5;
    }
    if (document.getElementById('settingSpeedLimitEnabled')) {
      document.getElementById('settingSpeedLimitEnabled').checked = !!currentSettings.speedLimitEnabled;
    }
    if (document.getElementById('settingSpeedLimit')) {
      document.getElementById('settingSpeedLimit').value = currentSettings.speedLimitKbps || 0;
    }

    // 3. Tab: File Types
    if (document.getElementById('settingFileTypes')) {
      document.getElementById('settingFileTypes').value = currentSettings.fileTypes || '';
    }
    if (document.getElementById('settingExceptionsList')) {
      document.getElementById('settingExceptionsList').value = currentSettings.exceptionsList || '';
    }

    // 4. Tab: General & Browser Integration
    if (document.getElementById('settingLaunchOnStartup')) {
      document.getElementById('settingLaunchOnStartup').checked = currentSettings.launchOnStartup !== false;
    }
    if (document.getElementById('settingMonitorClipboard')) {
      document.getElementById('settingMonitorClipboard').checked = currentSettings.monitorClipboard !== false;
    }
    if (document.getElementById('settingAutoStartFromClipboard')) {
      document.getElementById('settingAutoStartFromClipboard').checked = !!currentSettings.autoStartFromClipboard;
    }
    const bi = currentSettings.browserIntegration || {};
    if (document.getElementById('intChrome')) document.getElementById('intChrome').checked = bi.chrome !== false;
    if (document.getElementById('intEdge')) document.getElementById('intEdge').checked = bi.edge !== false;
    if (document.getElementById('intFirefox')) document.getElementById('intFirefox').checked = bi.firefox !== false;
    if (document.getElementById('intBrave')) document.getElementById('intBrave').checked = bi.brave !== false;
    if (document.getElementById('intOpera')) document.getElementById('intOpera').checked = bi.opera !== false;
    if (document.getElementById('intVivaldi')) document.getElementById('intVivaldi').checked = bi.vivaldi !== false;

    if (document.getElementById('settingKeyForce')) {
      document.getElementById('settingKeyForce').value = currentSettings.captureKeyForce || 'Alt';
    }
    if (document.getElementById('settingKeyPrevent')) {
      document.getElementById('settingKeyPrevent').value = currentSettings.captureKeyPrevent || 'Ctrl';
    }

    // 5. Tab: Downloads & Dialogs
    if (document.getElementById('settingShowStartDialog')) {
      document.getElementById('settingShowStartDialog').checked = currentSettings.showStartDialog !== false;
    }
    if (document.getElementById('settingShowCompleteDialog')) {
      document.getElementById('settingShowCompleteDialog').checked = currentSettings.showCompleteDialog !== false;
    }
    if (document.getElementById('settingShowProgressWindow')) {
      document.getElementById('settingShowProgressWindow').checked = currentSettings.showProgressWindow !== false;
    }
    if (document.getElementById('settingPlaySoundOnComplete')) {
      document.getElementById('settingPlaySoundOnComplete').checked = currentSettings.playSoundOnComplete !== false;
    }
    if (document.getElementById('settingPlaySoundOnError')) {
      document.getElementById('settingPlaySoundOnError').checked = currentSettings.playSoundOnError !== false;
    }
    if (document.getElementById('settingPostDownloadAction')) {
      document.getElementById('settingPostDownloadAction').value = currentSettings.postDownloadAction || 'none';
    }
    if (document.getElementById('settingVirusScanEnabled')) {
      document.getElementById('settingVirusScanEnabled').checked = !!currentSettings.virusScanEnabled;
    }
    if (document.getElementById('settingVirusScannerPath')) {
      document.getElementById('settingVirusScannerPath').value = currentSettings.virusScannerPath || '';
    }
    if (document.getElementById('settingVirusScannerArgs')) {
      document.getElementById('settingVirusScannerArgs').value = currentSettings.virusScannerArgs || '';
    }

    // 6. Tab: Proxy / Socks
    if (document.getElementById('settingProxyMode')) {
      document.getElementById('settingProxyMode').value = currentSettings.proxyMode || 'system';
    }
    if (document.getElementById('settingProxyHttpHost')) {
      document.getElementById('settingProxyHttpHost').value = currentSettings.proxyHttpHost || '';
    }
    if (document.getElementById('settingProxyHttpPort')) {
      document.getElementById('settingProxyHttpPort').value = currentSettings.proxyHttpPort || 8080;
    }
    if (document.getElementById('settingProxySocksHost')) {
      document.getElementById('settingProxySocksHost').value = currentSettings.proxySocksHost || '';
    }
    if (document.getElementById('settingProxySocksPort')) {
      document.getElementById('settingProxySocksPort').value = currentSettings.proxySocksPort || 1080;
    }
    if (document.getElementById('settingProxyUser')) {
      document.getElementById('settingProxyUser').value = currentSettings.proxyUser || '';
    }
    if (document.getElementById('settingProxyPass')) {
      document.getElementById('settingProxyPass').value = currentSettings.proxyPass || '';
    }

    // 7. Tab: Site Logins
    renderSiteLogins();

    // 8. Tab: Network & User-Agent
    if (document.getElementById('settingUserAgent')) {
      document.getElementById('settingUserAgent').value = currentSettings.userAgent || '';
    }
    if (document.getElementById('settingAutoReconnect')) {
      document.getElementById('settingAutoReconnect').checked = currentSettings.autoReconnect !== false;
    }

    // Update default save directory in Add Download modal
    const inputOutputDir = document.getElementById('inputOutputDir');
    if (inputOutputDir && !inputOutputDir.value) {
      inputOutputDir.value = currentSettings.categories?.General || currentSettings.downloadDir || '';
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function renderSiteLogins() {
  const tbody = document.getElementById('siteLoginsList');
  if (!tbody || !currentSettings) return;

  const logins = currentSettings.siteLogins || [];
  if (logins.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-table-cell">No stored site credentials</td></tr>`;
    return;
  }

  tbody.innerHTML = logins.map((item, idx) => `
    <tr>
      <td class="mono">${escapeHtml(item.pattern || '')}</td>
      <td>${escapeHtml(item.username || '--')}</td>
      <td class="mono">••••••••</td>
      <td>
        <button type="button" class="btn btn-xs btn-glass" onclick="deleteSiteLogin(${idx})">Delete</button>
      </td>
    </tr>
  `).join('');
}

window.deleteSiteLogin = function(idx) {
  if (currentSettings && currentSettings.siteLogins) {
    currentSettings.siteLogins.splice(idx, 1);
    renderSiteLogins();
  }
};

const settingsModal = document.getElementById('settingsModal');
window.openSettingsModal = function() {
  if (settingsModal) {
    loadSettings();
    settingsModal.style.display = 'flex';
  }
};

window.closeSettingsModal = function() {
  if (settingsModal) settingsModal.style.display = 'none';
};

// Native Windows Folder Picker Invocation
window.browseFolderForInput = async function(inputElement) {
  try {
    const res = await fetch('/api/browse-folder', { method: 'POST' });
    const data = await res.json();
    if (data.path && inputElement) {
      inputElement.value = data.path;
    }
  } catch (err) {
    console.error('Folder picker error:', err);
  }
};

// Native Windows File Picker Invocation
window.browseFileForInput = async function(inputElement) {
  try {
    const res = await fetch('/api/browse-file', { method: 'POST' });
    const data = await res.json();
    if (data.path && inputElement) {
      inputElement.value = data.path;
    }
  } catch (err) {
    console.error('File picker error:', err);
  }
};

// =========================================================
// Network Speed Tester (Individual or All Adapters)
// =========================================================
function applySpeedTestResult(address, result) {
  const safeId = address.replace(/[^a-zA-Z0-9]/g, '_');
  const badge = document.getElementById(`speedtest-badge-${safeId}`);
  if (!badge) return;
  badge.style.display = 'inline-block';
  badge.className = `speedtest-result-badge compact-badge${result.error ? ' speedtest-result-error' : ''}`;
  badge.textContent = result.text;
}

function rememberSpeedTestResult(address, text, error = false) {
  const result = { text, error };
  speedTestResults.set(address, result);
  applySpeedTestResult(address, result);
}

function showSpeedTestSummary(titleText, subText, speedText, completed = true) {
  const banner = document.getElementById('speedTestBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.classList.toggle('complete', completed);
  }
  const title = document.getElementById('speedTestBannerTitle');
  const sub = document.getElementById('speedTestBannerSub');
  const speed = document.getElementById('speedTestBannerMbps');
  const orb = banner?.querySelector('.speedtest-spinner-orb');
  if (title) title.textContent = titleText;
  if (sub) sub.textContent = subText;
  if (speed) speed.textContent = speedText;
  if (orb) orb.textContent = completed ? '✓' : '⚡';
}

window.testSingleAdapterSpeed = async function(address) {
  if (speedTestInProgress) return;
  speedTestInProgress = true;
  activeSpeedTestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const testId = activeSpeedTestId;
  const allButton = document.getElementById('btnTestAllSpeeds');
  if (allButton) allButton.disabled = true;
  document.querySelectorAll('.btn-icon-test').forEach(button => { button.disabled = true; });
  const safeId = address.replace(/[^a-zA-Z0-9]/g, '_');
  const card = document.getElementById(`adapter-${safeId}`);
  const badge = document.getElementById(`speedtest-badge-${safeId}`);

  speedTestResults.delete(address);
  if (card) card.classList.add('testing');
  if (badge) {
    badge.style.display = 'inline-block';
    badge.className = 'speedtest-result-badge compact-badge testing';
    badge.textContent = 'Testing (5s)...';
  }
  showSpeedTestSummary(`Testing ${networkInterfaces.find(i => i.address === address)?.name || address}...`, 'Measuring latency and download throughput for 5 seconds', 'Testing...', false);

  // Energize visualizer stream during active benchmark
  if (window.energyFlowVisualizer) {
    const speeds = {};
    speeds[address] = 5 * 1024 * 1024;
    window.energyFlowVisualizer.updateData(speeds, 5 * 1024 * 1024);
  }

  try {
    const res = await fetch('/api/speedtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, duration: 5, testId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server returned HTTP ${res.status}`);
    const result = data.result;

    if (result && result.success) {
      const resultText = `Ping: ${result.ping}ms | ${result.mbps} Mbps (5s avg)`;
      rememberSpeedTestResult(address, resultText);
      showSpeedTestSummary(`${result.speedFormatted} on ${networkInterfaces.find(i => i.address === address)?.name || address}`, `Speed test complete · ${result.bytes.toLocaleString()} bytes in ${result.duration}s · Ping ${result.ping}ms`, `${result.mbps} Mbps`);
    } else {
      const message = (result && result.error) || 'Speed test failed';
      rememberSpeedTestResult(address, `Error: ${message}`, true);
      showSpeedTestSummary('Speed test failed', message, 'Failed');
    }
  } catch (err) {
    rememberSpeedTestResult(address, `Error: ${err.message}`, true);
    showSpeedTestSummary('Speed test failed', err.message, 'Failed');
  } finally {
    if (card) card.classList.remove('testing');
    activeSpeedTestId = null;
    speedTestInProgress = false;
    if (allButton) allButton.disabled = false;
    document.querySelectorAll('.btn-icon-test').forEach(button => { button.disabled = false; });
    updateGlobalSpeed();
  }
};

window.testAllAdaptersSpeed = async function() {
  if (speedTestInProgress) return;
  speedTestInProgress = true;
  activeSpeedTestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const testId = activeSpeedTestId;
  const allButton = document.getElementById('btnTestAllSpeeds');
  if (allButton) allButton.disabled = true;
  document.querySelectorAll('.btn-icon-test').forEach(button => { button.disabled = true; });
  showSpeedTestSummary('Benchmarking all active adapters (5s)...', 'Measuring download throughput and latency across bonded interfaces', 'Testing...', false);

  const onlineIfaces = networkInterfaces.filter(i => i.online);
  const simSpeeds = {};
  onlineIfaces.forEach(i => {
    const safeId = i.address.replace(/[^a-zA-Z0-9]/g, '_');
    const card = document.getElementById(`adapter-${safeId}`);
    const badge = document.getElementById(`speedtest-badge-${safeId}`);
    if (card) card.classList.add('testing');
    if (badge) {
      badge.style.display = 'inline-block';
      badge.className = 'speedtest-result-badge compact-badge testing';
      badge.textContent = 'Testing (5s)...';
    }
    simSpeeds[i.address] = 4 * 1024 * 1024;
  });

  if (window.energyFlowVisualizer) {
    window.energyFlowVisualizer.updateData(simSpeeds, onlineIfaces.length * 4 * 1024 * 1024);
  }

  try {
    const res = await fetch('/api/speedtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'all', duration: 5, testId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server returned HTTP ${res.status}`);

    const aggregateMBps = Number.isFinite(Number(data.totalMBps))
      ? Number(data.totalMBps).toFixed(2)
      : (Number(data.totalMbps || 0) / 8).toFixed(2);
    showSpeedTestSummary(`Aggregate bonded throughput: ${aggregateMBps} MB/s`, `Concurrent test across ${data.activeCount} active network adapters`, `${aggregateMBps} MB/s`);

    (data.adapters || []).forEach(adapterResult => {
      if (adapterResult.localAddress) {
        if (adapterResult.success) {
          rememberSpeedTestResult(adapterResult.localAddress, `Ping: ${adapterResult.ping}ms | ${adapterResult.mbps} Mbps`);
        } else {
          rememberSpeedTestResult(adapterResult.localAddress, `Error: ${adapterResult.error || 'Failed'}`, true);
        }
      }
    });
  } catch (err) {
    showSpeedTestSummary('Speed test failed', err.message, 'Failed');
  } finally {
    onlineIfaces.forEach(i => {
      const safeId = i.address.replace(/[^a-zA-Z0-9]/g, '_');
      const card = document.getElementById(`adapter-${safeId}`);
      if (card) card.classList.remove('testing');
    });
    activeSpeedTestId = null;
    speedTestInProgress = false;
    if (allButton) allButton.disabled = false;
    document.querySelectorAll('.btn-icon-test').forEach(button => { button.disabled = false; });
    updateGlobalSpeed();
  }
};

// Event Listeners Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadInterfaces();
  loadSettings();
  initSSE();

  document.getElementById('btnScanAdapters')?.addEventListener('click', loadInterfaces);
  document.getElementById('btnUseNewAdapter')?.addEventListener('click', () => resolveNewAdapterPrompt(true));
  document.getElementById('btnKeepNewAdapterPaused')?.addEventListener('click', () => resolveNewAdapterPrompt(false));
  document.getElementById('btnTestAllSpeeds')?.addEventListener('click', testAllAdaptersSpeed);
  document.getElementById('btnOpenNewModal')?.addEventListener('click', openNewModal);
  document.getElementById('btnCloseModal')?.addEventListener('click', closeNewModal);
  document.getElementById('btnCancelModal')?.addEventListener('click', closeNewModal);

  // Settings Modal Triggers
  document.getElementById('btnOpenSettingsModal')?.addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseSettingsModal')?.addEventListener('click', closeSettingsModal);
  document.getElementById('btnCancelSettings')?.addEventListener('click', closeSettingsModal);

  // Browse button in Add Download modal
  document.getElementById('btnBrowseDownloadDir')?.addEventListener('click', () => {
    browseFolderForInput(document.getElementById('inputOutputDir'));
  });

  // Category Selector in Settings modal
  const catSelect = document.getElementById('settingsCategorySelect');
  if (catSelect) {
    catSelect.addEventListener('change', () => {
      const chosenCat = catSelect.value;
      const dirInput = document.getElementById('settingCategoryDir');
      const label = document.getElementById('labelCategoryDir');
      if (label) label.textContent = `Default download directory for '${chosenCat}' category:`;
      if (dirInput && currentSettings && currentSettings.categories) {
        dirInput.value = currentSettings.categories[chosenCat] || '';
      }
    });
  }

  document.getElementById('btnBrowseCategoryDir')?.addEventListener('click', async () => {
    const chosenCat = catSelect ? catSelect.value : 'General';
    const dirInput = document.getElementById('settingCategoryDir');
    await browseFolderForInput(dirInput);
    if (dirInput && dirInput.value && currentSettings && currentSettings.categories) {
      currentSettings.categories[chosenCat] = dirInput.value;
      const matrixInput = document.getElementById(`cat${chosenCat}`);
      if (matrixInput) matrixInput.value = dirInput.value;
    }
  });

  document.getElementById('btnBrowseVirusScanner')?.addEventListener('click', () => {
    browseFileForInput(document.getElementById('settingVirusScannerPath'));
  });

  // Generic browse buttons in Settings modal
  document.querySelectorAll('.btn-browse-folder').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (targetId) {
        browseFolderForInput(document.getElementById(targetId));
      }
    });
  });

  // Add Site Login button
  document.getElementById('btnAddSiteLogin')?.addEventListener('click', () => {
    const pat = document.getElementById('newLoginPattern');
    const usr = document.getElementById('newLoginUser');
    const pwd = document.getElementById('newLoginPass');
    if (pat && pat.value.trim()) {
      if (!currentSettings.siteLogins) currentSettings.siteLogins = [];
      currentSettings.siteLogins.push({
        id: String(Date.now()),
        pattern: pat.value.trim(),
        username: usr ? usr.value.trim() : '',
        password: pwd ? pwd.value : ''
      });
      renderSiteLogins();
      pat.value = '';
      if (usr) usr.value = '';
      if (pwd) pwd.value = '';
    }
  });

  // Settings Tab Navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(btn.getAttribute('data-tab'));
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Settings Form Submit
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const catSelectEl = document.getElementById('settingsCategorySelect');
    const currentActiveCat = catSelectEl ? catSelectEl.value : 'General';

    const updated = {
      // 1. Save To
      downloadDir: document.getElementById('catGeneral')?.value.trim() || document.getElementById('settingCategoryDir')?.value.trim(),
      tempDir: document.getElementById('settingTempDir')?.value.trim(),
      autoCategorize: document.getElementById('settingAutoCategorize')?.checked !== false,
      promptForSavePath: document.getElementById('settingPromptForSavePath')?.checked !== false,
      rememberLastPath: document.getElementById('settingRememberLastPath')?.checked !== false,
      activeCategory: currentActiveCat,
      categories: {
        Compressed: document.getElementById('catCompressed')?.value.trim(),
        Programs: document.getElementById('catPrograms')?.value.trim(),
        Video: document.getElementById('catVideo')?.value.trim(),
        Music: document.getElementById('catMusic')?.value.trim(),
        Documents: document.getElementById('catDocuments')?.value.trim(),
        General: document.getElementById('catGeneral')?.value.trim() || document.getElementById('settingCategoryDir')?.value.trim()
      },

      // 2. Connection
      connectionType: document.getElementById('settingConnectionType')?.value,
      connectionsPerAdapter: parseInt(document.getElementById('settingConnectionsPerAdapter')?.value, 10) || 4,
      bondingStrategy: document.getElementById('settingBondingStrategy')?.value || 'dynamic_bonded',
      retryAttempts: parseInt(document.getElementById('settingRetryAttempts')?.value, 10) || 5,
      speedLimitEnabled: document.getElementById('settingSpeedLimitEnabled')?.checked,
      speedLimitKbps: parseInt(document.getElementById('settingSpeedLimit')?.value, 10) || 0,

      // 3. File Types
      fileTypes: document.getElementById('settingFileTypes')?.value.trim(),
      exceptionsList: document.getElementById('settingExceptionsList')?.value.trim(),

      // 4. General
      launchOnStartup: document.getElementById('settingLaunchOnStartup')?.checked !== false,
      monitorClipboard: document.getElementById('settingMonitorClipboard')?.checked !== false,
      autoStartFromClipboard: document.getElementById('settingAutoStartFromClipboard')?.checked,
      browserIntegration: {
        chrome: document.getElementById('intChrome')?.checked !== false,
        edge: document.getElementById('intEdge')?.checked !== false,
        firefox: document.getElementById('intFirefox')?.checked !== false,
        brave: document.getElementById('intBrave')?.checked !== false,
        opera: document.getElementById('intOpera')?.checked !== false,
        vivaldi: document.getElementById('intVivaldi')?.checked !== false
      },
      captureKeyForce: document.getElementById('settingKeyForce')?.value || 'Alt',
      captureKeyPrevent: document.getElementById('settingKeyPrevent')?.value || 'Ctrl',

      // 5. Downloads
      showStartDialog: document.getElementById('settingShowStartDialog')?.checked !== false,
      showCompleteDialog: document.getElementById('settingShowCompleteDialog')?.checked !== false,
      showProgressWindow: document.getElementById('settingShowProgressWindow')?.checked !== false,
      playSoundOnComplete: document.getElementById('settingPlaySoundOnComplete')?.checked !== false,
      playSoundOnError: document.getElementById('settingPlaySoundOnError')?.checked !== false,
      postDownloadAction: document.getElementById('settingPostDownloadAction')?.value || 'none',
      virusScanEnabled: document.getElementById('settingVirusScanEnabled')?.checked,
      virusScannerPath: document.getElementById('settingVirusScannerPath')?.value.trim(),
      virusScannerArgs: document.getElementById('settingVirusScannerArgs')?.value.trim(),

      // 6. Proxy
      proxyMode: document.getElementById('settingProxyMode')?.value || 'system',
      proxyHttpHost: document.getElementById('settingProxyHttpHost')?.value.trim(),
      proxyHttpPort: parseInt(document.getElementById('settingProxyHttpPort')?.value, 10) || 8080,
      proxySocksHost: document.getElementById('settingProxySocksHost')?.value.trim(),
      proxySocksPort: parseInt(document.getElementById('settingProxySocksPort')?.value, 10) || 1080,
      proxyUser: document.getElementById('settingProxyUser')?.value.trim(),
      proxyPass: document.getElementById('settingProxyPass')?.value || '',

      // 7. Site Logins
      siteLogins: currentSettings?.siteLogins || [],

      // 8. Network
      userAgent: document.getElementById('settingUserAgent')?.value.trim(),
      autoReconnect: document.getElementById('settingAutoReconnect')?.checked !== false
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      currentSettings = await res.json();
      closeSettingsModal();
      await appAlert('Turbo Download Manager configuration saved successfully.', { title: 'Settings saved' });
    } catch (err) {
      await appAlert(`Failed to save settings: ${err.message}`, { title: 'Could not save settings' });
    }
  });

  document.getElementById('btnOpenDownloadsFolder')?.addEventListener('click', () => {
    openOutputFolder();
  });

  // URL Input real-time category detection
  const urlInput = document.getElementById('inputUrl');
  if (urlInput) {
    urlInput.addEventListener('input', () => {
      const url = urlInput.value.trim();
      if (url !== probedInputUrl) {
        probedData = null;
        probedInputUrl = '';
        probedAt = 0;
        const feedback = document.getElementById('probeResultText');
        if (feedback) {
          feedback.textContent = '';
          feedback.classList.remove('is-warning', 'is-error');
        }
      }
      if (url && currentSettings) {
        try {
          const u = new URL(url);
          const base = u.pathname.split('/').filter(Boolean).pop();
          if (base) {
            const ext = base.split('.').pop()?.toLowerCase();
            const mapping = {
              Compressed: ['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'img', 'tgz', 'bz2', 'xz'],
              Programs: ['exe', 'msi', 'msu', 'apk', 'appx', 'msix', 'bat', 'cmd', 'bin'],
              Video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'],
              Music: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
              Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']
            };
            let detected = 'General';
            for (const [cat, exts] of Object.entries(mapping)) {
              if (exts.includes(ext)) { detected = cat; break; }
            }
            const catBadge = document.getElementById('categoryBadge');
            const outputDirInput = document.getElementById('inputOutputDir');
            if (catBadge) catBadge.textContent = `Category: ${detected}`;
            if (outputDirInput && currentSettings.categories) {
              outputDirInput.value = currentSettings.categories[detected] || currentSettings.downloadDir;
            }
          }
        } catch {}
      }
    });
  }

  // URL Probe Handler with Category Suggestion
  document.getElementById('btnProbeUrl')?.addEventListener('click', async () => {
    const feedback = document.getElementById('probeResultText');
    const filenameInput = document.getElementById('inputFilename');
    const outputDirInput = document.getElementById('inputOutputDir');
    const catBadge = document.getElementById('categoryBadge');
    const probeButton = document.getElementById('btnProbeUrl');
    if (!urlInput || !urlInput.value) return;

    const targetUrl = urlInput.value.trim();
    const originalLabel = probeButton?.textContent;
    if (probeButton) {
      probeButton.disabled = true;
      probeButton.textContent = 'Checking…';
    }
    feedback.textContent = 'Probing server for Range support and file size...';
    feedback.classList.remove('is-warning', 'is-error');
    try {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await readApiResponse(res, 'Probe');
      if (!res.ok || data.error) {
        throw new Error(data.error || `Server returned HTTP ${res.status}`);
      }

      probedData = data;
      probedInputUrl = targetUrl;
      probedAt = Date.now();
      if (filenameInput && data.filename) {
        filenameInput.value = data.filename;
      }
      if (data.category && catBadge) {
        catBadge.textContent = `Category: ${data.category}`;
      }
      if (data.suggestedFolder && outputDirInput) {
        outputDirInput.value = data.suggestedFolder;
      }
      renderProbeFeedback(data, feedback);
    } catch (err) {
      probedData = null;
      probedInputUrl = '';
      feedback.textContent = `Probe failed: ${err.message || 'Could not inspect this link.'}`;
      feedback.classList.add('is-error');
    } finally {
      if (probeButton) {
        probeButton.disabled = false;
        probeButton.textContent = originalLabel || 'Probe';
      }
    }
  });

  // Form Submit Handler
  document.getElementById('downloadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('inputUrl').value.trim();
    const filename = document.getElementById('inputFilename').value.trim() || undefined;
    const outputDir = document.getElementById('inputOutputDir').value.trim() || undefined;
    const conns = parseInt(document.getElementById('inputStreamsPerIface').value, 10) || 4;
    const rememberPath = document.getElementById('chkRememberCategoryPath')?.checked;
    const catBadgeText = document.getElementById('categoryBadge')?.textContent || '';
    const category = catBadgeText.replace('Category: ', '').trim();

    const checkedBoxes = Array.from(document.querySelectorAll('input[name="modalIface"]:checked'));
    const chosenAddresses = checkedBoxes.map(cb => cb.value);

    const chosenInterfaces = networkInterfaces.filter(iface => chosenAddresses.includes(iface.address));
    const submitButton = document.getElementById('btnSubmitDownload');
    const originalSubmitLabel = submitButton?.textContent;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Checking link…';
    }

    try {
      let preflight = probedData && probedInputUrl === url && Date.now() - probedAt < 30000
        ? probedData
        : null;
      if (!preflight) {
        const probeResponse = await fetch('/api/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        preflight = await readApiResponse(probeResponse, 'Download probe');
        if (!probeResponse.ok || preflight.error) {
          throw new Error(preflight.error || `Server returned HTTP ${probeResponse.status}`);
        }
        probedData = preflight;
        probedInputUrl = url;
        probedAt = Date.now();
        renderProbeFeedback(preflight, document.getElementById('probeResultText'));
      }

      const warnings = getProbeWarnings(preflight);
      if (warnings.length && !await appConfirm(`Download warning:\n\n${warnings.join('\n\n')}\n\nContinue anyway?`, { title: 'Download notice', confirmLabel: 'Continue download' })) {
        return;
      }

      if (submitButton) submitButton.textContent = 'Starting download…';
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          filename,
          outputDir,
          category,
          rememberPath,
          connectionsPerInterface: conns,
          interfaces: chosenInterfaces
        })
      });

      const task = await readApiResponse(res, 'Download request');
      if (!res.ok || task.error) {
        throw new Error(task.error || `Server returned HTTP ${res.status}`);
      }
      activeDownloads.set(task.id, task);
      renderActiveDownloads();
      closeNewModal();
      document.getElementById('downloadForm').reset();
    } catch (err) {
      const feedback = document.getElementById('probeResultText');
      if (feedback) {
        feedback.textContent = `Could not start download: ${err.message || 'Unexpected error'}`;
        feedback.classList.add('is-error');
      } else {
        await appAlert(`Failed to start download: ${err.message || 'Unexpected error'}`, { title: 'Download could not start' });
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalSubmitLabel || '⚡ Start Bonded Download';
      }
    }
  });

  // Wire up Demo Surge button
  document.getElementById('btnSurgeDemo')?.addEventListener('click', () => {
    if (window.energyFlowVisualizer) {
      window.energyFlowVisualizer.triggerSurgeDemo();
    }
  });

  // Initialize Quantum Energy Flow Visualizer
  window.energyFlowVisualizer = new QuantumEnergyFlowCanvas('energyFlowCanvas');
  window.energyFlowVisualizer.start();
});

// =========================================================
// Lightweight Hardware Data Flow Visualizer (Simple & Smooth)
// =========================================================
class QuantumEnergyFlowCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.pulses = [];
    this.isSurgeDemo = false;
    this.surgeDemoTimer = null;
    this.adapterSpeeds = {};
    this.lastTraffic = new Map();
    this.totalSpeed = 0;
    this.animating = false;
    this.lastFrameTime = performance.now();
    this.frameAccumulator = 0;
    this.minimized = false;
    this.clickableRegions = [];
    this.hoveredAddress = null;
    this.adapterPositions = this.loadAdapterPositions();
    this.draggingAddress = null;
    this.dragStart = null;
    this.dragMoved = false;
    this.suppressNextClick = false;

    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('pointermove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    this.canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    this.canvas.addEventListener('lostpointercapture', (e) => this.handlePointerUp(e));
    this.canvas.addEventListener('mouseleave', () => {
      if (this.draggingAddress) return;
      this.hoveredAddress = null;
      if (this.canvas) this.canvas.style.cursor = 'default';
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  loadAdapterPositions() {
    try {
      const saved = JSON.parse(localStorage.getItem('adapterCanvasPositions') || '{}');
      return new Map(Object.entries(saved).filter(([, position]) =>
        position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ));
    } catch {
      return new Map();
    }
  }

  saveAdapterPositions() {
    try {
      localStorage.setItem('adapterCanvasPositions', JSON.stringify(Object.fromEntries(this.adapterPositions)));
    } catch {
      // Keep dragging available when browser storage is disabled or full.
    }
  }

  getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
    };
  }

  getLayoutBounds(w, h) {
    const sideMargin = Math.min(110, Math.max(48, w * 0.08));
    const destX = Math.max(42, w - sideMargin);
    const minX = Math.min(Math.max(36, w * 0.18), Math.max(24, destX - 82));
    const maxX = Math.max(minX, destX - 58);
    const top = Math.min(42, Math.max(20, h * 0.16));
    const bottom = Math.max(top, h - top);
    return { destX, minX, maxX, top, bottom };
  }

  getAdapterPosition(address, index, count, bounds) {
    const stored = this.adapterPositions.get(address);
    const xRatio = stored ? Math.max(0, Math.min(1, stored.x)) : null;
    const yRatio = stored ? Math.max(0, Math.min(1, stored.y)) : null;
    const defaultX = Math.max(bounds.minX, Math.min(bounds.maxX, this.width * 0.28));
    const defaultY = count <= 1 ? 0.5 : index / (count - 1);
    return {
      x: xRatio === null ? defaultX : bounds.minX + xRatio * (bounds.maxX - bounds.minX),
      y: bounds.top + (yRatio === null ? defaultY : yRatio) * (bounds.bottom - bounds.top)
    };
  }

  handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const point = this.getCanvasPoint(e);
    const hit = this.clickableRegions.find(r =>
      point.x >= r.x1 && point.x <= r.x2 && point.y >= r.y1 && point.y <= r.y2
    );
    if (!hit) return;
    this.draggingAddress = hit.address;
    this.dragStart = point;
    this.dragMoved = false;
    this.suppressNextClick = false;
    this.canvas.style.cursor = 'grabbing';
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  handlePointerUp(e) {
    if (!this.draggingAddress) return;
    if (this.dragMoved) this.suppressNextClick = true;
    this.draggingAddress = null;
    this.dragStart = null;
    this.dragMoved = false;
    this.canvas.style.cursor = this.hoveredAddress ? 'grab' : 'default';
    if (this.canvas.hasPointerCapture?.(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  }

  handleClick(e) {
    if (!this.canvas) return;
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    const { x: mx, y: my } = this.getCanvasPoint(e);

    const hit = this.clickableRegions.find(r => mx >= r.x1 && mx <= r.x2 && my >= r.y1 && my <= r.y2);
    if (hit && window.toggleAdapter) {
      window.toggleAdapter(hit.address);
    }
  }

  handleMouseMove(e) {
    if (!this.canvas) return;
    const { x: mx, y: my } = this.getCanvasPoint(e);

    if (this.draggingAddress && this.dragStart) {
      if (!this.dragMoved && Math.hypot(mx - this.dragStart.x, my - this.dragStart.y) > 3) {
        this.dragMoved = true;
      }
      if (this.dragMoved) {
        const bounds = this.getLayoutBounds(this.width, this.height);
        const x = Math.max(bounds.minX, Math.min(bounds.maxX, mx));
        const y = Math.max(bounds.top, Math.min(bounds.bottom, my));
        this.adapterPositions.set(this.draggingAddress, {
          x: bounds.maxX === bounds.minX ? 0 : (x - bounds.minX) / (bounds.maxX - bounds.minX),
          y: bounds.bottom === bounds.top ? 0.5 : (y - bounds.top) / (bounds.bottom - bounds.top)
        });
        this.saveAdapterPositions();
      }
      return;
    }

    const hit = this.clickableRegions.find(r => mx >= r.x1 && mx <= r.x2 && my >= r.y1 && my <= r.y2);
    this.hoveredAddress = hit ? hit.address : null;
    this.canvas.style.cursor = hit ? 'grab' : 'default';
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 800;
    this.height = rect.height || 250;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  triggerSurgeDemo() {
    this.isSurgeDemo = true;
    const btn = document.getElementById('btnSurgeDemo');
    if (btn) btn.textContent = '⚡ Surge Active (45 MB/s)';
    clearTimeout(this.surgeDemoTimer);
    this.surgeDemoTimer = setTimeout(() => {
      this.isSurgeDemo = false;
      if (btn) btn.textContent = '⚡ Test Lightning Surge';
    }, 5000);
  }

  updateData(speeds, total) {
    if (speeds !== undefined) this.adapterSpeeds = speeds || {};
    if (total !== undefined) this.totalSpeed = total || 0;
  }

  start() {
    if (this.animating) return;
    this.animating = true;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;
      if (!this.minimized) {
        this.frameAccumulator += dt;
        if (this.frameAccumulator >= 1 / 30) {
          this.render(this.frameAccumulator);
          this.frameAccumulator = 0;
        }
      } else {
        this.frameAccumulator = 0;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  render(dt = 0.016) {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);
    this.clickableRegions = [];

    const ifacesToDraw = networkInterfaces.length > 0 ? networkInterfaces : [];
    const ifaceCount = Math.max(1, ifacesToDraw.length);
    const bounds = this.getLayoutBounds(w, h);
    const destX = bounds.destX;
    const destY = h / 2;
    const wireScale = Math.max(0.65, Math.min(1.25, Math.min(w / 800, h / 250)));

    const activeTotalSpeed = this.isSurgeDemo ? 45 * 1024 * 1024 : this.totalSpeed;

    // Update HUD metrics
    const surgeEl = document.getElementById('surgeLevelText');
    const inflowEl = document.getElementById('totalInflowText');
    if (surgeEl) {
      const surgePercent = Math.min(100, Math.round((activeTotalSpeed / (30 * 1024 * 1024)) * 100));
      surgeEl.textContent = activeTotalSpeed > 0 ? `ACTIVE (${surgePercent}%)` : 'IDLE';
      surgeEl.style.color = activeTotalSpeed > 0 ? '#00f5a0' : '#64748b';
    }
    if (inflowEl) {
      inflowEl.textContent = formatSpeed(activeTotalSpeed);
    }

    // Sources mapping
    const sources = ifacesToDraw.map((iface, index) => {
      const position = this.getAdapterPosition(iface.address, index, ifaceCount, bounds);
      const isPaused = selectedInterfaces.size > 0 ? !selectedInterfaces.has(iface.address) : !iface.online;
      const speed = isPaused ? 0 : (this.isSurgeDemo ? 22 * 1024 * 1024 : (this.adapterSpeeds[iface.address] || 0));
      const now = performance.now();
      if (speed > 0) this.lastTraffic.set(iface.address, { at: now, speed });
      const previousTraffic = this.lastTraffic.get(iface.address);
      const elapsedSinceTraffic = previousTraffic ? now - previousTraffic.at : Infinity;
      const fade = Math.max(0, 1 - elapsedSinceTraffic / 1500);
      const visualSpeed = speed > 0 ? speed : (previousTraffic?.speed || 0) * fade;
      const hasTraffic = !isPaused && (speed > 0 || fade > 0);
      const color = isPaused ? '#64748b' : INTERFACE_COLORS[index % INTERFACE_COLORS.length];
      return { iface, index, x: position.x, y: position.y, color, speed, visualSpeed, hasTraffic, isPaused };
    });

    // 1. Draw conduit lines
    sources.forEach(src => {
      const hasTraffic = src.hasTraffic || (!src.isPaused && this.isSurgeDemo);
      const wireStartX = src.x + 14;
      const wireEndX = destX - 24;
      const cp1X = wireStartX + (wireEndX - wireStartX) * 0.5;
      const cp1Y = src.y;
      const cp2X = wireEndX - (wireEndX - wireStartX) * 0.5;
      const cp2Y = destY;

      ctx.beginPath();
      ctx.moveTo(wireStartX, src.y);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, wireEndX, destY);

      if (src.isPaused) {
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.25 * wireScale;
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.25)';
      } else {
        ctx.setLineDash([]);
        ctx.lineWidth = (hasTraffic ? 1.8 : 1.25) * wireScale;
        ctx.strokeStyle = hasTraffic ? src.color : 'rgba(255, 255, 255, 0.12)';
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Show moving data only while an adapter is carrying a download. Higher
      // throughput fills the wire with more, slightly larger and faster pulses.
      if (hasTraffic) {
        const targetPulseCount = Math.min(14, 7 + Math.floor(src.visualSpeed / (4 * 1024 * 1024)));
        const pulsesForSrc = this.pulses.filter(p => p.srcIdx === src.index).length;
        const pulseDeficit = targetPulseCount - pulsesForSrc;
        const spawnChance = Math.min(0.9, 0.3 * pulseDeficit);

        if (pulseDeficit > 0 && Math.random() < spawnChance) {
          this.pulses.push({
            srcIdx: src.index,
            t: 0,
            speedRate: 0.5 + Math.min(0.8, src.visualSpeed / (30 * 1024 * 1024)),
            color: src.color,
            size: 3.5 + Math.min(1.75, src.visualSpeed / (8 * 1024 * 1024))
          });
        }
      }
    });

    // 2. Draw moving data pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += p.speedRate * dt;

      if (p.t >= 1) {
        this.pulses.splice(i, 1);
        continue;
      }

      const src = sources[p.srcIdx];
      if (!src || src.isPaused || !src.hasTraffic) {
        this.pulses.splice(i, 1);
        continue;
      }

      const wireStartX = src.x + 14;
      const wireEndX = destX - 24;
      const cp1X = wireStartX + (wireEndX - wireStartX) * 0.5;
      const cp1Y = src.y;
      const cp2X = wireEndX - (wireEndX - wireStartX) * 0.5;
      const cp2Y = destY;

      const t = p.t;
      const invT = 1 - t;
      const bx = invT * invT * invT * wireStartX + 3 * invT * invT * t * cp1X + 3 * invT * t * t * cp2X + t * t * t * wireEndX;
      const by = invT * invT * invT * src.y + 3 * invT * invT * t * cp1Y + 3 * invT * t * t * cp2Y + t * t * t * destY;

      ctx.beginPath();
      ctx.arc(bx, by, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(bx, by, p.size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    // 3. Draw Left Adapter Nodes (Clean, minimalistic, NO text overlap)
    sources.forEach(src => {
      const hasTraffic = src.hasTraffic || (!src.isPaused && this.isSurgeDemo);

      // Register clickable region for this adapter row
      const labelWidth = Math.min(154, Math.max(86, w * 0.3));
      const hasLeftLabel = src.x - labelWidth - 30 >= 8;
      const labelX = Math.max(8, Math.min(w - labelWidth - 8, hasLeftLabel ? src.x - labelWidth - 30 : src.x + 24));
      const labelY = src.y;
      const hitLeft = Math.min(labelX, src.x - 19);
      const hitRight = Math.max(labelX + labelWidth, src.x + 19);
      this.clickableRegions.push({
        address: src.iface.address,
        x1: Math.max(4, hitLeft - 4),
        x2: Math.min(w - 4, hitRight + 4),
        y1: src.y - 22,
        y2: src.y + 22
      });

      // Draw Adapter Label
      const rawName = `${src.iface.icon || '📶'} ${src.iface.name || 'Adapter'}`;
      const displayName = rawName.length > 20 ? rawName.substring(0, 18) + '...' : rawName;

      ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = src.isPaused ? '#ffb800' : '#f8fafc';
      ctx.textAlign = hasLeftLabel ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayName, hasLeftLabel ? src.x - 24 : labelX, labelY - 8, labelWidth);

      // Speed / Status line - short, clean, zero overlap
      ctx.font = '700 11px "JetBrains Mono", monospace';
      if (src.isPaused) {
        ctx.fillStyle = '#ffb800';
        ctx.fillText('Paused', hasLeftLabel ? src.x - 24 : labelX, labelY + 9, labelWidth);
      } else {
        ctx.fillStyle = hasTraffic ? '#00f5a0' : '#64748b';
        ctx.fillText(formatSpeed(src.speed), hasLeftLabel ? src.x - 24 : labelX, labelY + 9, labelWidth);
      }

      // Node circle at x = src.x
      ctx.beginPath();
      ctx.arc(src.x, src.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#0a101d';
      ctx.strokeStyle = src.isPaused ? '#ffb800' : (hasTraffic ? src.color : 'rgba(255, 255, 255, 0.2)');
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(src.x, src.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = src.isPaused ? '#ffb800' : (hasTraffic ? src.color : '#64748b');
    });

    // 4. Draw Right PC Storage Node
    ctx.beginPath();
    ctx.arc(destX, destY, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#0a101d';
    ctx.strokeStyle = activeTotalSpeed > 0 ? '#00f2fe' : 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2.5;
    ctx.fill();
    ctx.stroke();

    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💻', destX, destY);

    ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText('PC STORAGE BUS', destX, destY + 36);

    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00f2fe';
    ctx.fillText(formatSpeed(activeTotalSpeed), destX, destY + 50);
  }
}

