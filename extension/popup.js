const SERVER_URL = 'http://127.0.0.1:4820';

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 KB/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function checkServerStatus() {
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const speedVal = document.getElementById('speedValue');
  const activeJobs = document.getElementById('activeJobsCount');
  const bondedCount = document.getElementById('bondedCount');

  try {
    const res = await fetch(`${SERVER_URL}/api/downloads`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Not 200');
    const data = await res.json();

    statusPill.className = 'status-pill online';
    statusText.textContent = 'CONNECTED';

    const inFlight = (data.active || []).filter(d => d.status === 'downloading');
    let totalSpeed = 0;
    inFlight.forEach(d => totalSpeed += (d.currentSpeed || 0));

    speedVal.textContent = formatSpeed(totalSpeed);
    activeJobs.textContent = inFlight.length.toString();

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
  }
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

  document.getElementById('btnOpenDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: SERVER_URL });
  });

  document.getElementById('btnDownloadCurrentTab').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        chrome.runtime.sendMessage({
          action: 'downloadUrl',
          url: tabs[0].url,
          filename: tabs[0].title ? tabs[0].title.substring(0, 30) + '.html' : undefined
        }, () => {
          window.close();
        });
      }
    });
  });

  checkServerStatus();
  setInterval(checkServerStatus, 2000);
});
