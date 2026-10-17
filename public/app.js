// State
let networkInterfaces = [];
let selectedInterfaces = new Set();
let activeDownloads = new Map();
let downloadHistory = [];
let probedData = null;

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
async function loadInterfaces() {
  const spinner = document.getElementById('scanSpinner');
  if (spinner) spinner.style.display = 'inline-block';

  try {
    const res = await fetch('/api/interfaces');
    const data = await res.json();
    networkInterfaces = data.interfaces || [];

    // Pre-select online interfaces by default
    selectedInterfaces.clear();
    networkInterfaces.forEach(iface => {
      if (iface.online) selectedInterfaces.add(iface.address);
    });

    renderAdapters();
    updateHeaderHud();
  } catch (err) {
    console.error('Error fetching interfaces:', err);
  } finally {
    if (spinner) spinner.style.display = 'none';
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
    const statusClass = !isSelected ? 'paused' : (iface.online ? 'online' : 'offline');

    return `
      <div class="adapter-compact-card ${isSelected ? 'active-bonded' : 'adapter-paused'}" id="adapter-${safeId}">
        <div class="adapter-left">
          <div class="adapter-icon-box-compact" style="color: ${isSelected ? color : '#64748b'}">
            ${iface.icon}
          </div>
          <div class="adapter-info-compact">
            <div class="adapter-name-row">
              <span class="adapter-name-text">${iface.name}</span>
              <span class="status-indicator ${statusClass}" title="${!isSelected ? 'Paused' : (iface.online ? 'Online' : 'No Route')}"></span>
              ${!isSelected ? '<span class="paused-tag">PAUSED</span>' : ''}
            </div>
            <div class="adapter-sub-row">
              <span class="adapter-type-pill">${iface.label}</span>
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
            <button type="button" class="btn btn-xs btn-glass btn-icon-test" onclick="testSingleAdapterSpeed('${iface.address}')" title="Test adapter speed (5s)">
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
    data.active.forEach(item => activeDownloads.set(item.id, item));
    downloadHistory = data.history || [];
    renderActiveDownloads();
    renderHistory();
  });

  es.addEventListener('download_update', (e) => {
    const item = JSON.parse(e.data);
    activeDownloads.set(item.id, item);

    if (item.status === 'completed' || item.status === 'error') {
      const idx = downloadHistory.findIndex(h => h.id === item.id);
      if (idx >= 0) downloadHistory[idx] = item;
      else downloadHistory.unshift(item);
      renderHistory();
    }

    renderActiveDownloads();
    updateGlobalSpeed();
  });

  es.addEventListener('speedtest_progress', (e) => {
    try {
      const prog = JSON.parse(e.data);
      if (prog.localAddress) {
        const safeId = prog.localAddress.replace(/[^a-zA-Z0-9]/g, '_');
        const badge = document.getElementById(`speedtest-badge-${safeId}`);
        if (badge) {
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
          iface.online = !!data.online;
          if (iface.online && !selectedInterfaces.has(iface.address)) {
            selectedInterfaces.add(iface.address);
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
    const isPaused = item.status === 'paused';

    // Segment block map
    const segmentsHtml = (item.segments || []).map((seg, idx) => {
      let stateClass = '';
      if (seg.done) stateClass = 'done';
      else if (seg.active && !isPaused) stateClass = 'in-flight';

      return `<div class="segment-block ${stateClass}" title="Segment ${seg.id}: ${formatBytes(seg.downloaded)} / ${formatBytes(seg.total)}">${seg.id}</div>`;
    }).join('');

    // Per-interface contribution pills with individual pause/resume controls
    const contribsHtml = (item.interfaces || []).map((iface, idx) => {
      const isIfacePaused = !!iface.paused;
      const color = INTERFACE_COLORS[idx % INTERFACE_COLORS.length];
      return `
        <div class="contrib-pill ${isIfacePaused ? 'contrib-pill-paused' : ''}">
          <span class="contrib-dot" style="background: ${isIfacePaused ? '#ffb800' : color}"></span>
          <span><strong>${iface.name}</strong>: ${formatBytes(iface.bytesDownloaded)} (${isIfacePaused ? '<span style="color:#ffb800;">PAUSED</span>' : (isPaused ? '0 B/s' : formatSpeed(iface.currentSpeed))})</span>
          <button type="button" class="btn btn-xs ${isIfacePaused ? 'btn-resume-device' : 'btn-pause-device'}" onclick="toggleDownloadInterface('${item.id}', '${iface.address}', ${isIfacePaused})" title="${isIfacePaused ? 'Resume this device — it will resume downloading' : 'Pause this device — other devices will complete its download'}">
            ${isIfacePaused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="task-card ${isPaused ? 'task-card-paused' : ''}" style="${isPaused ? 'border-color: rgba(255, 184, 0, 0.45);' : ''}">
        <div class="task-top">
          <div class="task-file-info">
            <div class="task-file-icon" style="${isPaused ? 'background: rgba(255, 184, 0, 0.15); color: #ffb800;' : ''}">
              ${isPaused ? '⏸' : '📦'}
            </div>
            <div>
              <div class="task-filename">${item.filename}</div>
              <div class="task-sub-meta mono">
                ${formatBytes(item.downloadedBytes)} of ${formatBytes(item.contentLength)} (${percent}%) · ${isPaused ? '<span style="color:#ffb800;font-weight:700;">PAUSED</span>' : `ETA: ${formatEta(item.etaSeconds)}`}
              </div>
            </div>
          </div>

          <div class="task-actions">
            ${isPaused ? 
              `<button class="btn btn-sm btn-accent" style="background: linear-gradient(135deg, #00f5a0, #00d285); color: #041019; font-weight: 700; box-shadow: 0 0 15px rgba(0, 245, 160, 0.4);" onclick="resumeDownload('${item.id}')">▶ Resume</button>` :
              `<button class="btn btn-sm btn-glass" onclick="pauseDownload('${item.id}')">⏸ Pause</button>`
            }
            <button class="btn btn-sm btn-glass" onclick="cancelDownload('${item.id}')">✕ Cancel</button>
          </div>
        </div>

        <div class="progress-container">
          <div class="progress-metrics-row">
            <span style="color: ${isPaused ? '#ffb800' : '#00f2fe'}; font-weight: 700;">
              ${isPaused ? '⏸ PAUSED' : item.status.toUpperCase()}
            </span>
            <span class="mono" style="color: ${isPaused ? '#ffb800' : '#00f5a0'}; font-weight: 700;">
              ${isPaused ? 'PAUSED' : formatSpeed(item.currentSpeed)}
            </span>
          </div>

          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${percent}%; ${isPaused ? 'background: #ffb800;' : ''}"></div>
          </div>

          <div class="segment-map-title">DYNAMIC MULTI-INTERFACE CHUNK MAP</div>
          <div class="segment-grid">
            ${segmentsHtml || '<div style="color: #64748b; font-size: 0.75rem">Allocating segments across bonded interfaces...</div>'}
          </div>

          <div class="adapter-contribution-row">
            ${contribsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 4. Download Controls
window.pauseDownload = async function(id) {
  const item = activeDownloads.get(id);
  if (item) {
    item.status = 'paused';
    item.currentSpeed = 0;
    if (item.segments) {
      item.segments.forEach(s => { s.active = false; });
    }
    renderActiveDownloads();
    updateGlobalSpeed();
  }
  try {
    await fetch(`/api/downloads/${id}/pause`, { method: 'POST' });
  } catch (err) {
    console.error('Error pausing download:', err);
  }
};

window.resumeDownload = async function(id) {
  const item = activeDownloads.get(id);
  if (item) {
    item.status = 'downloading';
    renderActiveDownloads();
  }
  try {
    await fetch(`/api/downloads/${id}/resume`, { method: 'POST' });
  } catch (err) {
    console.error('Error resuming download:', err);
  }
};

window.cancelDownload = async function(id) {
  if (confirm('Are you sure you want to cancel this download?')) {
    await fetch(`/api/downloads/${id}/cancel`, { method: 'POST' });
    activeDownloads.delete(id);
    renderActiveDownloads();
    updateGlobalSpeed();
  }
};

// 5. Render History
function renderHistory() {
  const tbody = document.getElementById('historyList');
  if (!tbody) return;

  if (downloadHistory.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table-cell">No completed downloads yet</td></tr>`;
    return;
  }

  tbody.innerHTML = downloadHistory.map(item => {
    const dateStr = item.completedAt ? new Date(item.completedAt).toLocaleTimeString() : '--';
    const isCompleted = item.status === 'completed';

    return `
      <tr>
        <td style="font-weight: 600; color: #f8fafc">${item.filename}</td>
        <td class="mono">${formatBytes(item.contentLength)}</td>
        <td>
          <span class="count-pill" style="color: ${isCompleted ? '#00f5a0' : '#ff3366'}">
            ${item.status.toUpperCase()}
          </span>
        </td>
        <td class="mono">${dateStr}</td>
        <td>
          <button type="button" class="btn btn-sm btn-glass" onclick="openHistoryItemFolder('${item.id}')" title="Open folder and select this file in Windows Explorer">
            Show in Folder
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

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
  if (probeFeedback) probeFeedback.textContent = '';
};

function populateModalInterfaces() {
  const container = document.getElementById('modalIfaceCheckboxes');
  if (!container) return;

  container.innerHTML = networkInterfaces.map(iface => {
    const isSelected = selectedInterfaces.has(iface.address);
    return `
      <label class="iface-checkbox-row">
        <input type="checkbox" value="${iface.address}" ${isSelected ? 'checked' : ''} name="modalIface">
        <span>${iface.icon} <strong>${iface.name}</strong> (${iface.address})</span>
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
      <td class="mono">${item.pattern}</td>
      <td>${item.username || '--'}</td>
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
window.testSingleAdapterSpeed = async function(address) {
  const safeId = address.replace(/[^a-zA-Z0-9]/g, '_');
  const card = document.getElementById(`adapter-${safeId}`);
  const badge = document.getElementById(`speedtest-badge-${safeId}`);

  if (card) card.classList.add('testing');
  if (badge) {
    badge.style.display = 'inline-block';
    badge.className = 'speedtest-result-badge testing';
    badge.textContent = 'Testing (5s)...';
  }

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
      body: JSON.stringify({ address, duration: 5 })
    });
    const data = await res.json();
    const result = data.result;

    if (badge) {
      badge.className = 'speedtest-result-badge';
      if (result && result.success) {
        badge.textContent = `Ping: ${result.ping}ms | ${result.mbps} Mbps (5s avg)`;
      } else {
        badge.textContent = `Error: ${(result && result.error) || 'Failed'}`;
        badge.style.color = '#ff3366';
      }
    }
  } catch (err) {
    if (badge) {
      badge.className = 'speedtest-result-badge';
      badge.textContent = `Error: ${err.message}`;
    }
  } finally {
    if (card) card.classList.remove('testing');
    updateGlobalSpeed();
  }
};

window.testAllAdaptersSpeed = async function() {
  const banner = document.getElementById('speedTestBanner');
  const title = document.getElementById('speedTestBannerTitle');
  const sub = document.getElementById('speedTestBannerSub');
  const mbpsEl = document.getElementById('speedTestBannerMbps');

  if (banner) banner.style.display = 'block';
  if (title) title.textContent = 'Benchmarking All Active Adapters (5s)...';
  if (sub) sub.textContent = 'Measuring CDN throughput and latency across bonded interfaces';
  if (mbpsEl) mbpsEl.textContent = 'Testing...';

  const onlineIfaces = networkInterfaces.filter(i => i.online);
  const simSpeeds = {};
  onlineIfaces.forEach(i => {
    const safeId = i.address.replace(/[^a-zA-Z0-9]/g, '_');
    const card = document.getElementById(`adapter-${safeId}`);
    const badge = document.getElementById(`speedtest-badge-${safeId}`);
    if (card) card.classList.add('testing');
    if (badge) {
      badge.style.display = 'inline-block';
      badge.className = 'speedtest-result-badge testing';
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
      body: JSON.stringify({ address: 'all', duration: 5 })
    });
    const data = await res.json();

    if (title) title.textContent = `✓ Aggregate Bonded Throughput: ${data.totalSpeedFormatted}`;
    if (sub) sub.textContent = `Concurrent channel bonding across ${data.activeCount} active network adapters`;
    if (mbpsEl) mbpsEl.textContent = `${data.totalMbps} Mbps`;

    (data.adapters || []).forEach(adapterResult => {
      if (adapterResult.localAddress) {
        const safeId = adapterResult.localAddress.replace(/[^a-zA-Z0-9]/g, '_');
        const badge = document.getElementById(`speedtest-badge-${safeId}`);
        if (badge) {
          badge.className = 'speedtest-result-badge';
          if (adapterResult.success) {
            badge.textContent = `Ping: ${adapterResult.ping}ms | ${adapterResult.mbps} Mbps`;
          } else {
            badge.textContent = `Err: ${adapterResult.error || 'Failed'}`;
          }
        }
      }
    });
  } catch (err) {
    if (title) title.textContent = `Speed Test Failed: ${err.message}`;
  } finally {
    onlineIfaces.forEach(i => {
      const safeId = i.address.replace(/[^a-zA-Z0-9]/g, '_');
      const card = document.getElementById(`adapter-${safeId}`);
      if (card) card.classList.remove('testing');
    });
    updateGlobalSpeed();
  }
};

// Event Listeners Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadInterfaces();
  loadSettings();
  initSSE();

  document.getElementById('btnScanAdapters')?.addEventListener('click', loadInterfaces);
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
      alert('✓ Turbo Download Manager Configuration Saved Successfully!');
    } catch (err) {
      alert(`Failed to save settings: ${err.message}`);
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
    if (!urlInput || !urlInput.value) return;

    feedback.textContent = 'Probing server for Range support and file size...';
    try {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value.trim() })
      });
      const data = await res.json();
      if (data.error) {
        feedback.textContent = `Error: ${data.error}`;
        return;
      }

      probedData = data;
      if (filenameInput && data.filename) {
        filenameInput.value = data.filename;
      }
      if (data.category && catBadge) {
        catBadge.textContent = `Category: ${data.category}`;
      }
      if (data.suggestedFolder && outputDirInput) {
        outputDirInput.value = data.suggestedFolder;
      }
      feedback.textContent = `Size: ${formatBytes(data.contentLength)} | Range Support: ${data.supportsRanges ? 'YES (Multi-Interface Accelerated)' : 'NO (Single Stream)'}`;
    } catch (err) {
      feedback.textContent = `Probe failed: ${err.message}`;
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

    try {
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

      const task = await res.json();
      activeDownloads.set(task.id, task);
      renderActiveDownloads();
      closeNewModal();
      document.getElementById('downloadForm').reset();
    } catch (err) {
      alert(`Failed to start download: ${err.message}`);
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
    this.totalSpeed = 0;
    this.animating = false;
    this.lastFrameTime = performance.now();
    this.minimized = false;
    this.clickableRegions = [];
    this.hoveredAddress = null;

    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredAddress = null;
      if (this.canvas) this.canvas.style.cursor = 'default';
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  handleClick(e) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const hit = this.clickableRegions.find(r => mx >= r.x1 && mx <= r.x2 && my >= r.y1 && my <= r.y2);
    if (hit && window.toggleAdapter) {
      window.toggleAdapter(hit.address);
    }
  }

  handleMouseMove(e) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const hit = this.clickableRegions.find(r => mx >= r.x1 && mx <= r.x2 && my >= r.y1 && my <= r.y2);
    this.hoveredAddress = hit ? hit.address : null;
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
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
        this.render(dt);
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

    // Padding preventing vertical clipping
    const topPadding = 42;
    const bottomPadding = 42;
    const usableHeight = Math.max(80, h - topPadding - bottomPadding);
    const step = ifaceCount > 1 ? usableHeight / (ifaceCount - 1) : 0;

    const srcX = 230; // Clean space on left for adapter labels and pause buttons
    const destX = w - 110;
    const destY = h / 2;

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
      const srcY = ifaceCount === 1 ? h / 2 : topPadding + (step * index);
      const isPaused = selectedInterfaces.size > 0 ? !selectedInterfaces.has(iface.address) : !iface.online;
      const speed = isPaused ? 0 : (this.isSurgeDemo ? 22 * 1024 * 1024 : (this.adapterSpeeds[iface.address] || 0));
      const color = isPaused ? '#64748b' : INTERFACE_COLORS[index % INTERFACE_COLORS.length];
      return { iface, index, x: 220, y: srcY, color, speed, isPaused };
    });

    // 1. Draw conduit lines
    sources.forEach(src => {
      const hasTraffic = !src.isPaused && (src.speed > 0 || this.isSurgeDemo);
      const cp1X = src.x + (destX - src.x) * 0.5;
      const cp1Y = src.y;
      const cp2X = destX - (destX - src.x) * 0.5;
      const cp2Y = destY;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, destX, destY);

      if (src.isPaused) {
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.25)';
      } else {
        ctx.setLineDash([]);
        ctx.lineWidth = hasTraffic ? 2.5 : 1.5;
        ctx.strokeStyle = hasTraffic ? src.color : 'rgba(255, 255, 255, 0.12)';
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Spawn data pulses only for unpaused active adapters
      if (!src.isPaused) {
        const targetPulseCount = hasTraffic ? 4 : 1;
        const pulsesForSrc = this.pulses.filter(p => p.srcIdx === src.index);

        if (pulsesForSrc.length < targetPulseCount && Math.random() < 0.06) {
          this.pulses.push({
            srcIdx: src.index,
            t: 0,
            speedRate: hasTraffic ? (0.35 + Math.min(0.45, src.speed / (15 * 1024 * 1024))) : 0.2,
            color: src.color,
            size: hasTraffic ? 3.5 : 2.5
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
      if (!src || src.isPaused) {
        this.pulses.splice(i, 1);
        continue;
      }

      const cp1X = src.x + (destX - src.x) * 0.5;
      const cp1Y = src.y;
      const cp2X = destX - (destX - src.x) * 0.5;
      const cp2Y = destY;

      const t = p.t;
      const invT = 1 - t;
      const bx = invT * invT * invT * src.x + 3 * invT * invT * t * cp1X + 3 * invT * t * t * cp2X + t * t * t * destX;
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
      const isHovered = this.hoveredAddress === src.iface.address;
      const hasTraffic = !src.isPaused && (src.speed > 0 || this.isSurgeDemo);

      // Register clickable region for this adapter row
      this.clickableRegions.push({
        address: src.iface.address,
        x1: 12,
        x2: src.x + 22,
        y1: src.y - 22,
        y2: src.y + 22
      });

      // Hover background highlight
      if (isHovered) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(12, src.y - 18, src.x - 2, 36, 6);
        } else {
          ctx.rect(12, src.y - 18, src.x - 2, 36);
        }
        ctx.fill();
      }

      // Draw Adapter Label
      const rawName = `${src.iface.icon || '📶'} ${src.iface.name || 'Adapter'}`;
      const displayName = rawName.length > 20 ? rawName.substring(0, 18) + '...' : rawName;

      ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = src.isPaused ? '#ffb800' : '#f8fafc';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayName, 24, src.y - 8);

      // Speed / Status line - short, clean, zero overlap
      ctx.font = '700 11px "JetBrains Mono", monospace';
      if (src.isPaused) {
        ctx.fillStyle = '#ffb800';
        ctx.fillText('Paused', 24, src.y + 9);
      } else {
        ctx.fillStyle = hasTraffic ? '#00f5a0' : '#64748b';
        ctx.fillText(formatSpeed(src.speed), 24, src.y + 9);
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

