// Turbo Download Manager Floating Media Grabber (like IDM Video Download bar)
(function() {
  let activePanel = null;
  let hideTimeout = null;
  const activeDownloadPrompts = new Set();

  function positionDownloadPrompts() {
    [...activeDownloadPrompts].forEach((host, index) => {
      host.style.top = `${16 + index * 154}px`;
    });
  }

  function askWhereToDownload({ filename, timeoutMs = 3000 }) {
    if (activeDownloadPrompts.size >= 4) return Promise.resolve({ choice: 'turbo' });
    return new Promise(resolve => {
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const card = document.createElement('section');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Choose download manager');
      card.innerHTML = `
        <style>
          * { box-sizing: border-box; }
          section { width: min(370px, calc(100vw - 32px)); padding: 17px; border: 1px solid rgba(0,242,254,.42); border-radius: 14px; color: #f8fafc; background: rgba(10,16,29,.97); box-shadow: 0 16px 48px rgba(0,0,0,.48), 0 0 22px rgba(0,242,254,.12); font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
          header { display:flex; align-items:center; gap:9px; margin-bottom:7px; font-size:15px; font-weight:700; }
          header span { color:#00f2fe; font-size:18px; }
          p { margin:0; color:#bac7d8; overflow-wrap:anywhere; }
          .file { margin-top:6px; color:#f8fafc; font-weight:600; }
          .timer { margin-top:8px; color:#00f2fe; font-size:12px; }
          .actions { display:flex; gap:8px; margin-top:14px; }
          button { flex:1; min-height:36px; border:1px solid rgba(148,163,184,.25); border-radius:8px; background:#172033; color:#dce6f4; font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; cursor:pointer; }
          button:hover { border-color:#00f2fe; }
          button.primary { border:0; color:#06131b; background:linear-gradient(100deg,#00e8ef,#35a8ff); }
          button:focus-visible { outline:2px solid #fff; outline-offset:2px; }
          @media (prefers-reduced-motion: no-preference) { section { animation: enter .16s ease-out; } @keyframes enter { from { opacity:0; transform:translateY(-5px) } to { opacity:1; transform:translateY(0) } } }
        </style>
        <header><span aria-hidden="true">⚡</span><div>Send through Turbo?</div></header>
        <p>When Turbo interception is on, browser downloads stay in Turbo. Cancel here to stop this download.</p>
        <p class="file"></p>
        <p class="timer" aria-live="polite"></p>
        <div class="actions"><button class="primary" type="button">Use Turbo</button><button type="button">Cancel download</button></div>
      `;
      card.querySelector('.file').textContent = filename || 'Download';
      const timerText = card.querySelector('.timer');
      const [turboButton, cancelButton] = card.querySelectorAll('button');
      shadow.appendChild(card);
      document.documentElement.appendChild(host);
      activeDownloadPrompts.add(host);
      positionDownloadPrompts();

      let finished = false;
      const deadline = Date.now() + Math.max(0, timeoutMs);
      const finish = choice => {
        if (finished) return;
        finished = true;
        clearInterval(interval);
        host.remove();
        activeDownloadPrompts.delete(host);
        positionDownloadPrompts();
        resolve({ choice });
      };
      const updateCountdown = () => {
        const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        timerText.textContent = secondsLeft
          ? `Starting with Turbo in ${secondsLeft} second${secondsLeft === 1 ? '' : 's'}…`
          : 'Starting with Turbo…';
        if (!secondsLeft) finish('turbo');
      };
      turboButton.addEventListener('click', () => finish('turbo'));
      cancelButton.addEventListener('click', () => finish('cancel'));
      const interval = setInterval(updateCountdown, 100);
      updateCountdown();
      turboButton.focus();
    });
  }

  function showDownloadToast(message) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = 'max-width:min(370px,calc(100vw - 32px));padding:12px 16px;border:1px solid rgba(0,242,254,.42);border-radius:11px;color:#f8fafc;background:rgba(10,16,29,.97);box-shadow:0 12px 36px rgba(0,0,0,.4);font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    shadow.appendChild(toast);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 2800);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'turbo:confirm-download') {
      askWhereToDownload(message).then(sendResponse, () => sendResponse({ choice: 'turbo' }));
      return true;
    }
    if (message.action === 'turbo:download-result') {
      if (message.success) {
        showDownloadToast(`Sent ${message.filename || 'download'} to Turbo Download Manager.`);
      } else if (message.canceled) {
        showDownloadToast('Download cancelled. Chrome’s downloader was not started.');
      } else {
        showDownloadToast(`${message.filename || 'Download'} stopped: ${message.error || 'Turbo could not start it.'} Chrome’s downloader was not used.`);
      }
    }
  });

  function createDownloadButton(mediaEl) {
    if (activePanel) activePanel.remove();

    const rect = mediaEl.getBoundingClientRect();
    if (rect.width < 150 || rect.height < 100) return; // Skip tiny icons/audios

    const src = mediaEl.currentSrc || mediaEl.src || (mediaEl.querySelector('source') ? mediaEl.querySelector('source').src : '');
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;

    activePanel = document.createElement('div');
    activePanel.className = 'turbo-video-grabber';
    activePanel.innerHTML = `
      <div class="turbo-grabber-content">
        <span class="turbo-grabber-icon">⚡</span>
        <span class="turbo-grabber-text">Download with Turbo Manager</span>
      </div>
    `;

    // Position top-right of media element
    activePanel.style.top = `${window.scrollY + rect.top + 10}px`;
    activePanel.style.left = `${window.scrollX + rect.right - 210}px`;

    activePanel.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const filename = document.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) + '.mp4';
      chrome.runtime.sendMessage({
        action: 'downloadUrl',
        url: src,
        filename
      }, (res) => {
        if (res && res.success) {
          activePanel.innerHTML = `<span style="color: #00f5a0">✓ Sent to Turbo Manager!</span>`;
          setTimeout(() => activePanel?.remove(), 2000);
        } else {
          activePanel.innerHTML = `<span style="color: #ff3366">Failed (check app)</span>`;
        }
      });
    });

    document.body.appendChild(activePanel);
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO') {
      clearTimeout(hideTimeout);
      createDownloadButton(target);
    }
  }, true);

  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO') {
      hideTimeout = setTimeout(() => {
        if (activePanel && !activePanel.matches(':hover')) {
          activePanel.remove();
          activePanel = null;
        }
      }, 1500);
    }
  }, true);
})();
