// Turbo Download Manager Floating Media Grabber (like IDM Video Download bar)
(function() {
  let activePanel = null;
  let hideTimeout = null;

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
