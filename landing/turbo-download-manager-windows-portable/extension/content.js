// Turbo Download Manager - Universal Media Grabber & Quality Selector (IDM Style)
(function() {
  // 1. Download Interception Prompt & Toast Notification
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
        showDownloadToast(`${message.filename || 'Download'} stopped: ${message.error || 'Turbo could not start it.'}`);
      }
    }
    if (message.action === 'turbo:media-detected') {
      if (message.stream && message.stream.url) {
        addGenericMediaStream(message.stream);
      }
    }
  });

  // -------------------------------------------------------------
  // 2. IDM-Style Video Grabber & Quality Dropdown
  // -------------------------------------------------------------
  let activeGrabber = null;
  let currentTargetVideo = null;
  let hideTimer = null;
  let isMouseOverGrabber = false;
  let isDropdownOpen = false;

  // Stream Registries
  let ytMediaData = null; // { title, videoId, duration, formats }
  const genericStreams = []; // Array of { url, quality, label, format, size, type }

  function cleanPageTitle() {
    return document.title
      .replace(/ - YouTube$/, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  function getQualityFromDimensions(w, h) {
    const maxDim = Math.max(w, h);
    if (maxDim >= 3800 || h >= 2100) return '2160p 4K';
    if (maxDim >= 2500 || h >= 1400) return '1440p 2K';
    if (maxDim >= 1800 || h >= 1000) return '1080p Full HD';
    if (maxDim >= 1200 || h >= 700) return '720p HD';
    if (maxDim >= 800 || h >= 460) return '480p SD';
    if (maxDim >= 600 || h >= 340) return '360p';
    return 'Video';
  }

  function addGenericMediaStream(stream) {
    if (!stream || !stream.url) return;
    if (genericStreams.some(s => s.url === stream.url)) return;

    const extMatch = stream.url.match(/\.(mp4|webm|mkv|m4v|mov|avi|flv|m3u8|ts|mp3|m4a|ogg)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toUpperCase() : (stream.contentType?.includes('audio') ? 'MP3' : 'MP4');
    const isAudio = stream.contentType?.startsWith('audio/') || ['MP3', 'M4A', 'OGG'].includes(ext);

    let quality = stream.quality || (isAudio ? 'Audio' : 'Video');
    if (currentTargetVideo && currentTargetVideo.videoWidth > 0 && !stream.quality && !isAudio) {
      quality = getQualityFromDimensions(currentTargetVideo.videoWidth, currentTargetVideo.videoHeight);
    }

    genericStreams.push({
      url: stream.url,
      quality,
      label: `${quality} (${ext})`,
      format: ext,
      type: isAudio ? 'audio' : 'video',
      isHD: /720|1080|1440|2160|4K|2K|HD/i.test(quality),
      size: stream.size || ''
    });

    if (activeGrabber && isDropdownOpen) {
      renderDropdownItems();
    }
  }

  // Listen for YouTube Formats emitted by yt-helper.js
  window.addEventListener('TURBO_YT_FORMATS', (e) => {
    if (e.detail && Array.isArray(e.detail.formats) && e.detail.formats.length > 0) {
      ytMediaData = e.detail;
      const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player') || document.querySelector('video');
      if (ytPlayer) {
        showGrabberFor(ytPlayer);
      }
    }
  });

  // Ask for YouTube formats on load
  window.dispatchEvent(new CustomEvent('TURBO_REQUEST_YT_FORMATS'));

  function ensureGrabber() {
    if (activeGrabber) return activeGrabber;

    activeGrabber = document.createElement('div');
    activeGrabber.className = 'turbo-idm-bar';
    activeGrabber.innerHTML = `
      <div class="turbo-idm-btn" id="turboIdmMainBtn" title="Download this video with Turbo Download Manager">
        <span class="turbo-idm-icon">⚡</span>
        <span class="turbo-idm-text">Download this video</span>
        <span class="turbo-idm-arrow">▾</span>
      </div>
      <div class="turbo-idm-dropdown" id="turboIdmDropdown">
        <div class="turbo-idm-dropdown-header">
          <div class="turbo-idm-header-top">
            <span class="turbo-idm-brand">⚡ Turbo Accelerator</span>
            <button type="button" class="turbo-idm-close" id="turboIdmCloseBtn" title="Close">✕</button>
          </div>
          <div class="turbo-idm-title" id="turboIdmTitle">Video Title</div>
        </div>
        <div class="turbo-idm-stream-list" id="turboIdmList">
          <div class="turbo-idm-empty">
            <p>Scanning video qualities...</p>
          </div>
        </div>
      </div>
    `;

    const mainBtn = activeGrabber.querySelector('#turboIdmMainBtn');
    const closeBtn = activeGrabber.querySelector('#turboIdmCloseBtn');

    mainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown();
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDropdown();
    });

    activeGrabber.addEventListener('mouseenter', () => {
      isMouseOverGrabber = true;
      clearTimeout(hideTimer);
    });

    activeGrabber.addEventListener('mouseleave', () => {
      isMouseOverGrabber = false;
      if (!isDropdownOpen) {
        scheduleHide();
      }
    });

    document.body.appendChild(activeGrabber);
    return activeGrabber;
  }

  function getAvailableMediaStreams() {
    if (window.location.hostname.includes('youtube.com') && ytMediaData && ytMediaData.formats) {
      return ytMediaData.formats;
    }

    const results = [...genericStreams];

    // Inspect current video element
    if (currentTargetVideo) {
      const src = currentTargetVideo.currentSrc || currentTargetVideo.src;
      if (src && !src.startsWith('blob:') && !src.startsWith('data:') && !results.some(r => r.url === src)) {
        const quality = currentTargetVideo.videoWidth > 0
          ? getQualityFromDimensions(currentTargetVideo.videoWidth, currentTargetVideo.videoHeight)
          : 'Original Stream';
        results.unshift({
          url: src,
          quality,
          label: `${quality} (Direct Stream)`,
          format: 'MP4',
          type: 'video',
          isHD: /720|1080|1440|2160|4K|2K|HD/i.test(quality),
          size: ''
        });
      }

      // Inspect <source> children
      const sources = currentTargetVideo.querySelectorAll('source');
      sources.forEach(source => {
        const sUrl = source.src;
        if (sUrl && !sUrl.startsWith('blob:') && !results.some(r => r.url === sUrl)) {
          const res = source.getAttribute('res') || source.getAttribute('size') || source.getAttribute('label') || 'MP4';
          results.push({
            url: sUrl,
            quality: res,
            label: `${res} (Source)`,
            format: 'MP4',
            type: 'video',
            isHD: /720|1080|1440|2160|4K|2K|HD/i.test(res),
            size: ''
          });
        }
      });
    }

    return results;
  }

  function renderDropdownItems() {
    if (!activeGrabber) return;
    const listEl = activeGrabber.querySelector('#turboIdmList');
    const titleEl = activeGrabber.querySelector('#turboIdmTitle');

    const videoTitle = (ytMediaData && ytMediaData.title) ? ytMediaData.title : cleanPageTitle();
    titleEl.textContent = videoTitle;
    titleEl.title = videoTitle;

    const streams = getAvailableMediaStreams();

    if (streams.length === 0) {
      listEl.innerHTML = `
        <div class="turbo-idm-empty">
          <p>No direct video stream detected yet.<br>Play the video to capture stream quality.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = streams.map((stream, idx) => {
      const isAudio = stream.type === 'audio';
      const pillClass = isAudio ? 'audio' : (stream.isHD ? 'hd' : 'sd');
      const icon = isAudio ? '🎵' : '🎬';
      const sizeText = stream.size ? `<span class="turbo-idm-size">${stream.size}</span>` : '';

      return `
        <div class="turbo-idm-row" data-index="${idx}">
          <div class="turbo-idm-row-left">
            <span class="turbo-idm-media-icon">${icon}</span>
            <div class="turbo-idm-quality-info">
              <div class="turbo-idm-quality-top">
                <span class="turbo-idm-pill ${pillClass}">${escapeHtml(stream.quality)}</span>
                <span class="turbo-idm-quality-label">${escapeHtml(stream.label)}</span>
              </div>
              <div class="turbo-idm-quality-sub">${escapeHtml(stream.format || 'MP4')}${stream.isMuxed ? ' · Video + Audio' : ''}</div>
            </div>
          </div>
          <div class="turbo-idm-row-right">
            ${sizeText}
            <button type="button" class="turbo-idm-dl-btn" data-index="${idx}">⬇ Download</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click events
    listEl.querySelectorAll('.turbo-idm-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const index = parseInt(row.getAttribute('data-index'), 10);
        const stream = streams[index];
        if (!stream) return;

        const dlBtn = row.querySelector('.turbo-idm-dl-btn');
        if (dlBtn) {
          dlBtn.textContent = '⏳ Sending...';
        }

        const ext = stream.format ? stream.format.toLowerCase() : (stream.type === 'audio' ? 'm4a' : 'mp4');
        const qualSuffix = stream.quality ? ` [${stream.quality}]` : '';
        const finalFilename = `${videoTitle}${qualSuffix}.${ext}`;

        chrome.runtime.sendMessage({
          action: 'downloadUrl',
          url: stream.url,
          filename: finalFilename
        }, (res) => {
          if (dlBtn) {
            if (res && res.success) {
              dlBtn.textContent = '✓ Sent to Turbo!';
              dlBtn.classList.add('is-success');
              setTimeout(() => closeDropdown(), 1800);
            } else {
              dlBtn.textContent = 'Failed';
              setTimeout(() => { dlBtn.textContent = '⬇ Download'; }, 2500);
            }
          }
        });
      });
    });
  }

  function toggleDropdown() {
    if (isDropdownOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function openDropdown() {
    ensureGrabber();
    isDropdownOpen = true;
    activeGrabber.classList.add('is-open');
    renderDropdownItems();
  }

  function closeDropdown() {
    if (!activeGrabber) return;
    isDropdownOpen = false;
    activeGrabber.classList.remove('is-open');
  }

  function positionGrabber(targetEl) {
    if (!activeGrabber) return;
    const fullscreenEl = document.fullscreenElement;

    // In fullscreen mode, mount inside fullscreen element so it stays on top
    if (fullscreenEl && activeGrabber.parentElement !== fullscreenEl) {
      fullscreenEl.appendChild(activeGrabber);
      activeGrabber.style.position = 'absolute';
      activeGrabber.style.top = '16px';
      activeGrabber.style.right = '16px';
      activeGrabber.style.left = 'auto';
      return;
    }

    if (!fullscreenEl && activeGrabber.parentElement !== document.body) {
      document.body.appendChild(activeGrabber);
    }

    const rect = targetEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    activeGrabber.style.position = 'absolute';
    activeGrabber.style.top = `${window.scrollY + rect.top + 12}px`;
    activeGrabber.style.left = `${window.scrollX + rect.right - 230}px`;
    activeGrabber.style.right = 'auto';
  }

  function showGrabberFor(videoEl) {
    if (!videoEl) return;
    currentTargetVideo = videoEl;
    const grabber = ensureGrabber();

    positionGrabber(videoEl);
    grabber.classList.add('is-visible');
    clearTimeout(hideTimer);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!isMouseOverGrabber && !isDropdownOpen && activeGrabber) {
        activeGrabber.classList.remove('is-visible');
      }
    }, 2800);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // -------------------------------------------------------------
  // 3. Page Video Listeners (YouTube + Generic Sites)
  // -------------------------------------------------------------
  function scanForVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      if (v._turboHooked) return;
      v._turboHooked = true;

      v.addEventListener('mouseenter', () => {
        showGrabberFor(v);
      });

      v.addEventListener('mouseleave', () => {
        scheduleHide();
      });

      v.addEventListener('play', () => {
        showGrabberFor(v);
        // Ask background for any media streams detected on this tab
        chrome.runtime.sendMessage({ action: 'getTabMedia' }, (res) => {
          if (res && Array.isArray(res.streams)) {
            res.streams.forEach(addGenericMediaStream);
          }
        });
        if (window.location.hostname.includes('youtube.com')) {
          window.dispatchEvent(new CustomEvent('TURBO_REQUEST_YT_FORMATS'));
        }
      });
    });

    // YouTube specific player hook
    if (window.location.hostname.includes('youtube.com')) {
      const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (ytPlayer && !ytPlayer._turboHooked) {
        ytPlayer._turboHooked = true;
        ytPlayer.addEventListener('mouseenter', () => {
          showGrabberFor(ytPlayer);
        });
        ytPlayer.addEventListener('mouseleave', () => {
          scheduleHide();
        });
      }
    }
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (target.tagName === 'VIDEO' || target.closest?.('#movie_player') || target.closest?.('.html5-video-player')) {
      const v = target.tagName === 'VIDEO' ? target : target.querySelector('video') || target;
      showGrabberFor(v);
    }
  }, true);

  window.addEventListener('scroll', () => {
    if (currentTargetVideo && activeGrabber && activeGrabber.classList.contains('is-visible')) {
      positionGrabber(currentTargetVideo);
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (currentTargetVideo && activeGrabber) {
      positionGrabber(currentTargetVideo);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (currentTargetVideo && activeGrabber) {
      positionGrabber(currentTargetVideo);
    }
  });

  // Regular scan for dynamic SPA video insertion
  setInterval(scanForVideos, 1500);
  scanForVideos();

  // Initial getTabMedia check
  chrome.runtime.sendMessage({ action: 'getTabMedia' }, (res) => {
    if (res && Array.isArray(res.streams)) {
      res.streams.forEach(addGenericMediaStream);
    }
  });
})();
