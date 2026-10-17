// =========================================================
// Turbo Download Manager Pro — Landing Page Interactive Engine
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  initHeroVisualizer();
  initSpeedCalculator();
});

// 1. Hero Canvas Channel Bonding Visualizer
function initHeroVisualizer() {
  const canvas = document.getElementById('landingFlowCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = 800;
  let height = 220;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width || 800;
    height = rect.height || 220;
    canvas.width = width;
    canvas.height = height;
  }

  resize();
  window.addEventListener('resize', resize);

  const adapters = [
    { id: 'chkDemoWifi', name: '📶 Wi-Fi 6', speedMbps: 45, color: '#00f2fe' },
    { id: 'chkDemoUsb', name: '📱 5G USB', speedMbps: 50, color: '#00f5a0' },
    { id: 'chkDemoLan', name: '🖧 1Gbps LAN', speedMbps: 50, color: '#ffb800' }
  ];

  let pulses = [];
  let lastTime = performance.now();

  function updateHud() {
    const activeAdapters = adapters.filter(a => {
      const el = document.getElementById(a.id);
      return el ? el.checked : true;
    });

    let totalMbps = activeAdapters.reduce((acc, a) => acc + a.speedMbps, 0);
    const speedEl = document.getElementById('demoCombinedSpeed');
    const badgeEl = document.getElementById('demoMultiplierBadge');

    if (speedEl) {
      const mbs = (totalMbps / 8).toFixed(1);
      const gbps = (totalMbps / 1000).toFixed(2);
      speedEl.textContent = `${mbs} MB/s (${totalMbps} Mbps)`;
    }

    if (badgeEl) {
      const count = activeAdapters.length;
      if (count === 3) badgeEl.textContent = '⚡ 3.2x Triple-Bonded Speed!';
      else if (count === 2) badgeEl.textContent = '⚡ 2.1x Dual-Bonded Boost!';
      else if (count === 1) badgeEl.textContent = 'Single Connection (Unbonded)';
      else badgeEl.textContent = 'All Connections Off';
    }
  }

  adapters.forEach(a => {
    document.getElementById(a.id)?.addEventListener('change', updateHud);
  });
  updateHud();

  // Animation Loop
  function render(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    ctx.clearRect(0, 0, width, height);

    const activeAdapters = adapters.filter(a => {
      const el = document.getElementById(a.id);
      return el ? el.checked : true;
    });

    const count = activeAdapters.length;
    const destX = width - 100;
    const destY = height / 2;

    const topPad = 35;
    const bottomPad = 35;
    const usableH = height - topPad - bottomPad;
    const step = count > 1 ? usableH / (count - 1) : 0;

    const sources = activeAdapters.map((a, idx) => {
      const y = count === 1 ? height / 2 : topPad + (step * idx);
      return { ...a, x: 180, y, idx };
    });

    // Draw conduits
    sources.forEach(src => {
      const cp1X = src.x + (destX - src.x) * 0.5;
      const cp1Y = src.y;
      const cp2X = destX - (destX - src.x) * 0.5;
      const cp2Y = destY;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, destX, destY);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = src.color;
      ctx.stroke();

      // Spawn pulses
      const pulsesForSrc = pulses.filter(p => p.srcIdx === src.idx);
      if (pulsesForSrc.length < 3 && Math.random() < 0.08) {
        pulses.push({
          srcIdx: src.idx,
          t: 0,
          speedRate: 0.45,
          color: src.color
        });
      }
    });

    // Animate & draw pulses
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += p.speedRate * dt;
      if (p.t >= 1) {
        pulses.splice(i, 1);
        continue;
      }

      const src = sources.find(s => s.idx === p.srcIdx);
      if (!src) {
        pulses.splice(i, 1);
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
      ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    // Draw Source Nodes
    sources.forEach(src => {
      ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(src.name, 20, src.y - 7);

      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = src.color;
      ctx.fillText(`${src.speedMbps} MB/s`, 20, src.y + 9);

      // Circle node
      ctx.beginPath();
      ctx.arc(src.x, src.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#0a101d';
      ctx.strokeStyle = src.color;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(src.x, src.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = src.color;
      ctx.fill();
    });

    // Draw Destination PC Node
    ctx.beginPath();
    ctx.arc(destX, destY, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#0a101d';
    ctx.strokeStyle = count > 0 ? '#00f2fe' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2.5;
    ctx.fill();
    ctx.stroke();

    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💻', destX, destY);

    ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('PC STORAGE', destX, destY + 34);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

// 2. Interactive Speed Calculator
function initSpeedCalculator() {
  const rangeWifi = document.getElementById('rangeWifi');
  const rangeUsb = document.getElementById('rangeUsb');
  const rangeLan = document.getElementById('rangeLan');

  const valWifi = document.getElementById('valWifi');
  const valUsb = document.getElementById('valUsb');
  const valLan = document.getElementById('valLan');

  const calcCombinedTotal = document.getElementById('calcCombinedTotal');
  const calcThroughput = document.getElementById('calcThroughput');
  const calcTime5GB = document.getElementById('calcTime5GB');
  const calcOldTime5GB = document.getElementById('calcOldTime5GB');
  const calcSavingsPill = document.getElementById('calcSavingsPill');

  function formatTime(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  }

  function update() {
    const wifi = parseInt(rangeWifi?.value || 40, 10);
    const usb = parseInt(rangeUsb?.value || 60, 10);
    const lan = parseInt(rangeLan?.value || 0, 10);

    if (valWifi) valWifi.textContent = `${wifi} Mbps`;
    if (valUsb) valUsb.textContent = `${usb} Mbps`;
    if (valLan) valLan.textContent = lan > 0 ? `${lan} Mbps` : '0 Mbps (Off)';

    const totalMbps = wifi + usb + lan;
    const totalBytesPerSec = (totalMbps * 1024 * 1024) / 8;
    const mbPerSec = (totalBytesPerSec / (1024 * 1024)).toFixed(2);

    if (calcCombinedTotal) calcCombinedTotal.textContent = `${totalMbps.toFixed(1)} Mbps`;
    if (calcThroughput) calcThroughput.textContent = `${mbPerSec} MB/s Download Rate`;

    // 5 GB file calculation
    const fileSize5GB = 5 * 1024 * 1024 * 1024;
    const bondedSeconds = fileSize5GB / totalBytesPerSec;
    const wifiOnlyBytesPerSec = (wifi * 1024 * 1024) / 8;
    const wifiOnlySeconds = fileSize5GB / wifiOnlyBytesPerSec;

    if (calcTime5GB) calcTime5GB.textContent = formatTime(bondedSeconds);
    if (calcOldTime5GB) calcOldTime5GB.textContent = formatTime(wifiOnlySeconds);

    if (calcSavingsPill) {
      const savingsPct = Math.min(95, Math.max(10, Math.round((1 - (bondedSeconds / wifiOnlySeconds)) * 100)));
      const multiplier = (totalMbps / wifi).toFixed(1);
      calcSavingsPill.textContent = `🚀 ${multiplier}x Faster (${savingsPct}% Time Saved)!`;
    }
  }

  [rangeWifi, rangeUsb, rangeLan].forEach(el => {
    el?.addEventListener('input', update);
  });

  update();
}
