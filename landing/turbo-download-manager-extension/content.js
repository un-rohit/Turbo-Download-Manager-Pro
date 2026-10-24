// Turbo Download Manager - Universal Media Grabber & Quality Selector (IDM Style)
(function() {
  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) return;
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          return;
        }
        if (typeof callback === 'function') {
          try { callback(res); } catch {}
        }
      });
    } catch {}
  }

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
      if (!mediaGrabberEnabled) return;
      if (Array.isArray(message.streams)) {
        message.streams.forEach(addGenericMediaStream);
      } else if (message.stream && message.stream.url) {
        addGenericMediaStream(message.stream);
      }
    }
  });

  // -------------------------------------------------------------
  // 2. IDM-Style Video Grabber & Quality Dropdown
  // -------------------------------------------------------------
  let mediaGrabberEnabled = true;
  let activeGrabber = null;
  let activeDropdown = null;
  let activeTriggerEl = null;
  let currentTargetVideo = null;
  let hideTimer = null;
  let isMouseOverGrabber = false;
  let isDropdownOpen = false;

  // Sync media grabber toggle state from extension storage
  if (isExtensionValid() && chrome?.storage?.local) {
    try {
      chrome.storage.local.get(['mediaGrabberEnabled'], (res) => {
        if (!isExtensionValid()) return;
        if (res && res.mediaGrabberEnabled !== undefined) {
          mediaGrabberEnabled = res.mediaGrabberEnabled;
          if (!mediaGrabberEnabled) {
            if (activeGrabber) activeGrabber.classList.remove('is-visible');
            const ytAction = document.getElementById('turboYtActionContainer');
            if (ytAction) ytAction.remove();
            closeDropdown();
          }
        }
      });

      chrome.storage.onChanged.addListener((changes) => {
        if (!isExtensionValid()) return;
        if (changes && changes.mediaGrabberEnabled !== undefined) {
          mediaGrabberEnabled = changes.mediaGrabberEnabled.newValue !== false;
          if (!mediaGrabberEnabled) {
            if (activeGrabber) activeGrabber.classList.remove('is-visible');
            const ytAction = document.getElementById('turboYtActionContainer');
            if (ytAction) ytAction.remove();
            closeDropdown();
          }
        }
      });
    } catch {}
  }

  // Comprehensive YouTube itag map for 4K / 2K / 1080p / 720p / 480p / 360p / Audio
  const YOUTUBE_ITAG_MAP = {
    // 4K (2160p) & 8K
    '402': { quality: '4320p 8K', label: '4320p 8K Ultra HD', badge: '8K', format: 'MP4', isHD: true },
    '272': { quality: '4320p 8K', label: '4320p 8K Ultra HD', badge: '8K', format: 'WebM', isHD: true },
    '315': { quality: '2160p 4K 60fps', label: '2160p 4K 60fps Ultra HD', badge: '4K', format: 'WebM', isHD: true },
    '313': { quality: '2160p 4K', label: '2160p 4K Ultra HD', badge: '4K', format: 'WebM', isHD: true },
    '401': { quality: '2160p 4K', label: '2160p 4K Ultra HD', badge: '4K', format: 'MP4', isHD: true },
    '337': { quality: '2160p 4K 60fps HDR', label: '2160p 4K 60fps HDR Ultra HD', badge: '4K', format: 'WebM', isHD: true },
    '701': { quality: '2160p 4K 60fps HDR', label: '2160p 4K 60fps HDR Ultra HD', badge: '4K', format: 'MP4', isHD: true },
    '138': { quality: '2160p 4K', label: '2160p 4K Ultra HD', badge: '4K', format: 'MP4', isHD: true },

    // 1440p (2K)
    '308': { quality: '1440p 2K 60fps', label: '1440p 2K 60fps Quad HD', badge: '2K', format: 'WebM', isHD: true },
    '271': { quality: '1440p 2K', label: '1440p 2K Quad HD', badge: '2K', format: 'WebM', isHD: true },
    '400': { quality: '1440p 2K', label: '1440p 2K Quad HD', badge: '2K', format: 'MP4', isHD: true },
    '336': { quality: '1440p 2K 60fps HDR', label: '1440p 2K 60fps HDR', badge: '2K', format: 'WebM', isHD: true },
    '700': { quality: '1440p 2K 60fps HDR', label: '1440p 2K 60fps HDR', badge: '2K', format: 'MP4', isHD: true },

    // 1080p Full HD
    '299': { quality: '1080p Full HD 60fps', label: '1080p Full HD 60fps', badge: '1080P', format: 'MP4', isHD: true },
    '303': { quality: '1080p Full HD 60fps', label: '1080p Full HD 60fps', badge: '1080P', format: 'WebM', isHD: true },
    '137': { quality: '1080p Full HD', label: '1080p Full HD', badge: '1080P', format: 'MP4', isHD: true },
    '248': { quality: '1080p Full HD', label: '1080p Full HD', badge: '1080P', format: 'WebM', isHD: true },
    '399': { quality: '1080p Full HD', label: '1080p Full HD', badge: '1080P', format: 'MP4', isHD: true },
    '335': { quality: '1080p Full HD HDR', label: '1080p Full HD HDR', badge: '1080P', format: 'WebM', isHD: true },
    '699': { quality: '1080p Full HD HDR', label: '1080p Full HD HDR', badge: '1080P', format: 'MP4', isHD: true },
    '37':  { quality: '1080p Full HD', label: '1080p Full HD (Video + Audio)', badge: '1080P', format: 'MP4', isHD: true, isMuxed: true },

    // 720p HD
    '298': { quality: '720p HD 60fps', label: '720p HD 60fps', badge: '720P', format: 'MP4', isHD: true },
    '302': { quality: '720p HD 60fps', label: '720p HD 60fps', badge: '720P', format: 'WebM', isHD: true },
    '136': { quality: '720p HD', label: '720p HD', badge: '720P', format: 'MP4', isHD: true },
    '247': { quality: '720p HD', label: '720p HD', badge: '720P', format: 'WebM', isHD: true },
    '398': { quality: '720p HD', label: '720p HD', badge: '720P', format: 'MP4', isHD: true },
    '334': { quality: '720p HD HDR', label: '720p HD HDR', badge: '720P', format: 'WebM', isHD: true },
    '698': { quality: '720p HD HDR', label: '720p HD HDR', badge: '720P', format: 'MP4', isHD: true },
    '22':  { quality: '720p HD', label: '720p HD (Video + Audio)', badge: '720P', format: 'MP4', isHD: true, isMuxed: true },

    // 480p SD
    '135': { quality: '480p SD', label: '480p SD', badge: '480P', format: 'MP4', isHD: false },
    '244': { quality: '480p SD', label: '480p SD', badge: '480P', format: 'WebM', isHD: false },
    '397': { quality: '480p SD', label: '480p SD', badge: '480P', format: 'MP4', isHD: false },

    // 360p SD
    '18':  { quality: '360p', label: '360p (Video + Audio)', badge: '360P', format: 'MP4', isHD: false, isMuxed: true },
    '134': { quality: '360p', label: '360p SD', badge: '360P', format: 'MP4', isHD: false },
    '243': { quality: '360p', label: '360p SD', badge: '360P', format: 'WebM', isHD: false },
    '396': { quality: '360p', label: '360p SD', badge: '360P', format: 'MP4', isHD: false },

    // Audio Streams
    '140': { quality: 'Audio Only', label: 'Audio M4A (128 kbps)', badge: 'AUDIO', format: 'M4A', type: 'audio', isHD: false },
    '141': { quality: 'Audio Only', label: 'Audio M4A (256 kbps)', badge: 'AUDIO', format: 'M4A', type: 'audio', isHD: false },
    '251': { quality: 'Audio Only', label: 'Audio WebM (160 kbps Opus)', badge: 'AUDIO', format: 'WebM', type: 'audio', isHD: false },
    '250': { quality: 'Audio Only', label: 'Audio WebM (70 kbps Opus)', badge: 'AUDIO', format: 'WebM', type: 'audio', isHD: false },
    '249': { quality: 'Audio Only', label: 'Audio WebM (50 kbps Opus)', badge: 'AUDIO', format: 'WebM', type: 'audio', isHD: false }
  };

  // Stream Registries
  let ytMediaData = null; // { title, videoId, duration, formats, itagMeta }
  let currentVideoId = '';
  const genericStreams = []; // Array of { url, quality, label, format, size, type, itag, badge }
  let ytResolvedStreams = [];
  let isResolvingYt = false;
  let lastResolvedVideoId = '';

  function fetchResolvedYouTubeStreams() {
    if (!window.location.hostname.includes('youtube.com') || isResolvingYt || !isExtensionValid()) return;
    const currentUrl = window.location.href;
    if (!currentUrl.includes('/watch') && !currentUrl.includes('/shorts')) return;
    const curV = new URLSearchParams(window.location.search).get('v');
    if (curV && curV === lastResolvedVideoId && ytResolvedStreams.length > 0) return;

    isResolvingYt = true;
    renderDropdownItems();
    safeSendMessage({ action: 'resolveYouTube', url: currentUrl }, (res) => {
      isResolvingYt = false;
      if (res && res.success && Array.isArray(res.streams) && res.streams.length > 0) {
        ytResolvedStreams = res.streams;
        lastResolvedVideoId = res.videoId || curV || '';
        renderDropdownItems();
        positionDropdown();
      }
    });
  }

  function cleanTitle(title) {
    return String(title || 'Video')
      .replace(/ - YouTube$/, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  function cleanPageTitle() {
    return cleanTitle(document.title);
  }

  function getActiveVideoTitle() {
    // 1. YouTube metadata in DOM
    try {
      const ytH1 = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
      if (ytH1 && ytH1.textContent && ytH1.textContent.trim()) {
        return cleanTitle(ytH1.textContent.trim());
      }
    } catch {}

    // 2. ytMediaData if matching current video
    try {
      const curV = new URLSearchParams(window.location.search).get('v');
      if (ytMediaData && ytMediaData.title && (!curV || ytMediaData.videoId === curV)) {
        return ytMediaData.title;
      }
    } catch {}

    // 3. Fallback to page title
    return cleanPageTitle();
  }

  function clearStreamsForNewVideo(newId, newTitle) {
    genericStreams.length = 0;
    ytMediaData = null;
    if (newId !== lastResolvedVideoId) {
      ytResolvedStreams = [];
    }
    currentVideoId = newId;

    const t = newTitle || getActiveVideoTitle();
    const dropdownEl = activeDropdown || activeGrabber;
    if (dropdownEl) {
      const titleEl = dropdownEl.querySelector('#turboIdmTitle');
      if (titleEl) {
        titleEl.textContent = t;
        titleEl.title = t;
      }
      const listEl = dropdownEl.querySelector('#turboIdmList');
      if (listEl) {
        listEl.innerHTML = `
          <div class="turbo-idm-empty">
            <p>Scanning video stream qualities...<br>Play the video to capture high-definition stream.</p>
          </div>
        `;
      }
    }

    injectYouTubeActionButton();

    // Tell background script to wipe old streams for this tab
    safeSendMessage({
      action: 'turbo:tab-video-changed',
      videoId: newId
    });
  }

  window.addEventListener('TURBO_YT_VIDEO_CHANGED', (e) => {
    const detail = e.detail || {};
    clearStreamsForNewVideo(detail.videoId, detail.title);
  });

  // Fast polling to detect URL query parameter change (v=...)
  const urlWatchTimer = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(urlWatchTimer);
      return;
    }
    try {
      const v = new URLSearchParams(window.location.search).get('v') || '';
      if (v && v !== currentVideoId) {
        clearStreamsForNewVideo(v, getActiveVideoTitle());
      }
    } catch {}
  }, 300);

  function getQualityFromDimensions(w, h) {
    const maxDim = Math.max(w || 0, h || 0);
    const minDim = Math.min(w || 0, h || 0);
    if (minDim >= 2100 || maxDim >= 3800) return '2160p 4K';
    if (minDim >= 1400 || maxDim >= 2500) return '1440p 2K';
    if (minDim >= 1000 || maxDim >= 1800) return '1080p Full HD';
    if (minDim >= 700 || maxDim >= 1200) return '720p HD';
    if (minDim >= 460 || maxDim >= 800) return '480p SD';
    if (minDim >= 340 || maxDim >= 600) return '360p';
    return 'Video';
  }

  function addGenericMediaStream(stream) {
    if (!stream || !stream.url) return;

    let itag = stream.itag;
    if (!itag) {
      try {
        itag = new URL(stream.url).searchParams.get('itag');
      } catch {}
    }

    const itagInfo = itag ? YOUTUBE_ITAG_MAP[String(itag)] : null;
    const isAudio = stream.type === 'audio' ||
      stream.contentType?.startsWith('audio/') ||
      itagInfo?.type === 'audio' ||
      itagInfo?.format === 'M4A';

    let format = itagInfo?.format || stream.format;
    if (!format) {
      const extMatch = stream.url.match(/\.(mp4|webm|mkv|m4v|mov|avi|flv|m3u8|ts|mp3|m4a|ogg)(\?|$)/i);
      format = extMatch ? extMatch[1].toUpperCase() : (isAudio ? 'M4A' : 'MP4');
    }

    let quality = itagInfo?.quality;
    if (!quality) {
      if (currentTargetVideo && currentTargetVideo.videoWidth > 0 && !isAudio) {
        quality = getQualityFromDimensions(currentTargetVideo.videoWidth, currentTargetVideo.videoHeight);
      } else {
        quality = stream.quality || (isAudio ? 'Audio' : 'Video');
      }
    }

    let size = stream.size || '';
    if (itag && ytMediaData?.itagMeta?.[String(itag)]?.size) {
      size = ytMediaData.itagMeta[String(itag)].size;
    }

    const label = itagInfo?.label || `${quality} (${format})`;
    const badge = itagInfo?.badge || null;
    const isHD = itagInfo ? itagInfo.isHD : /720|1080|1440|2160|4K|2K|HD/i.test(quality);

    const existingIdx = genericStreams.findIndex(s => s.url === stream.url || (itag && s.itag === itag));
    const streamItem = {
      url: stream.url,
      quality,
      label,
      badge,
      format,
      type: isAudio ? 'audio' : 'video',
      isHD,
      size,
      itag: itag || null
    };

    if (existingIdx >= 0) {
      genericStreams[existingIdx] = { ...genericStreams[existingIdx], ...streamItem };
    } else {
      genericStreams.push(streamItem);
    }

    if (activeGrabber && isDropdownOpen) {
      renderDropdownItems();
    }
  }

  // Listen for YouTube Formats emitted by yt-helper.js
  window.addEventListener('TURBO_YT_FORMATS', (e) => {
    if (!mediaGrabberEnabled) return;
    if (e.detail) {
      const curV = new URLSearchParams(window.location.search).get('v') || '';
      if (curV && e.detail.videoId && e.detail.videoId !== curV) {
        // Discard stale formats for old video
        return;
      }
      ytMediaData = e.detail;
      currentVideoId = e.detail.videoId || curV;

      // Update sizes on any existing genericStreams if itagMeta has them
      if (ytMediaData.itagMeta) {
        for (const s of genericStreams) {
          if (s.itag && ytMediaData.itagMeta[String(s.itag)]?.size && !s.size) {
            s.size = ytMediaData.itagMeta[String(s.itag)].size;
          }
        }
      }

      const dropdownEl = activeDropdown || activeGrabber;
      if (dropdownEl) {
        const titleEl = dropdownEl.querySelector('#turboIdmTitle');
        if (titleEl && ytMediaData.title) {
          titleEl.textContent = ytMediaData.title;
          titleEl.title = ytMediaData.title;
        }
        if (isDropdownOpen) {
          renderDropdownItems();
        }
      }

      injectYouTubeActionButton();

      const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player') || document.querySelector('video');
      if (ytPlayer) {
        showGrabberFor(ytPlayer);
      }
    }
  });

  // Ask for YouTube formats on load
  window.dispatchEvent(new CustomEvent('TURBO_REQUEST_YT_FORMATS'));

  function ensureDropdown() {
    if (activeDropdown) return activeDropdown;

    activeDropdown = document.createElement('div');
    activeDropdown.id = 'turboIdmDropdown';
    activeDropdown.className = 'turbo-idm-dropdown';
    activeDropdown.innerHTML = `
      <div class="turbo-idm-dropdown-header">
        <div class="turbo-idm-header-top">
          <span class="turbo-idm-brand">⚡ TDM Accelerator</span>
          <button type="button" class="turbo-idm-close" id="turboIdmCloseBtn" title="Close">✕</button>
        </div>
        <div class="turbo-idm-title" id="turboIdmTitle">Video Title</div>
      </div>
      <div class="turbo-idm-stream-list" id="turboIdmList">
        <div class="turbo-idm-empty">
          <p>Scanning video stream qualities...<br>Play the video to capture high-definition stream.</p>
        </div>
      </div>
    `;

    const closeBtn = activeDropdown.querySelector('#turboIdmCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      });
    }

    activeDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    const mountTarget = document.fullscreenElement || document.body;
    mountTarget.appendChild(activeDropdown);
    return activeDropdown;
  }

  function ensureGrabber() {
    if (activeGrabber) return activeGrabber;

    activeGrabber = document.createElement('div');
    activeGrabber.className = 'turbo-idm-bar';
    activeGrabber.innerHTML = `
      <div class="turbo-idm-btn" id="turboIdmMainBtn" title="Download Video (TDM)">
        <span class="turbo-idm-icon">⚡</span>
      </div>
    `;

    const mainBtn = activeGrabber.querySelector('#turboIdmMainBtn');
    mainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown(mainBtn);
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

  function injectYouTubeActionButton() {
    if (!mediaGrabberEnabled) return;
    if (!window.location.hostname.includes('youtube.com')) return;

    const menu = document.querySelector('#top-level-buttons-computed, ytd-menu-renderer #top-level-buttons-computed');
    if (!menu) return;

    let container = document.getElementById('turboYtActionContainer');
    if (container) {
      if (menu.contains(container)) {
        return; // already inserted in the active menu
      }
      container.remove();
    }

    container = document.createElement('div');
    container.id = 'turboYtActionContainer';
    container.className = 'turbo-yt-action-container';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'turboYtActionBtn';
    btn.className = 'turbo-yt-pill';
    btn.title = 'Download Video (Turbo Download Manager)';
    btn.setAttribute('aria-label', 'Download with Turbo');

    const icon = document.createElement('span');
    icon.className = 'turbo-yt-pill-icon';
    icon.textContent = '⚡';

    const text = document.createElement('span');
    text.className = 'turbo-yt-pill-text';
    text.textContent = 'Download';

    btn.appendChild(icon);
    btn.appendChild(text);
    container.appendChild(btn);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown(btn);
    });

    const likeBtn = menu.querySelector('segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer, :first-child');
    if (likeBtn) {
      menu.insertBefore(container, likeBtn);
    } else {
      menu.prepend(container);
    }
  }

  function getAvailableMediaStreams() {
    const results = [];
    const seenUrls = new Set();
    const seenLabels = new Set();

    // 0. High-Fidelity Resolved YouTube Streams from TDM Backend (4K, 2K, 1080p, 720p, 480p, 360p, Audio)
    if (Array.isArray(ytResolvedStreams) && ytResolvedStreams.length > 0) {
      for (const s of ytResolvedStreams) {
        if (s.url && !seenUrls.has(s.url)) {
          results.push({ ...s });
          seenUrls.add(s.url);
          seenLabels.add(s.label);
        }
      }
    }

    // 1. YouTube Helper Formats (from internal player response)
    if (ytMediaData && Array.isArray(ytMediaData.formats)) {
      for (const f of ytMediaData.formats) {
        if (f.url && !seenUrls.has(f.url)) {
          let size = f.size || '';
          if (f.itag && ytMediaData.itagMeta?.[String(f.itag)]?.size) {
            size = ytMediaData.itagMeta[String(f.itag)].size;
          }
          results.push({
            ...f,
            size
          });
          seenUrls.add(f.url);
          seenLabels.add(f.label);
        }
      }
    }

    // 2. Streams sniffed by webRequest in background.js (including 4K, 2K, 1080p, 720p, 480p, 360p, Audio)
    for (const stream of genericStreams) {
      if (stream.url && !seenUrls.has(stream.url)) {
        let itag = stream.itag;
        if (!itag) {
          try {
            itag = new URL(stream.url).searchParams.get('itag');
          } catch {}
        }

        const itagInfo = itag ? YOUTUBE_ITAG_MAP[String(itag)] : null;
        let quality = itagInfo?.quality || stream.quality;
        let badge = itagInfo?.badge || stream.badge;
        let format = itagInfo?.format || stream.format;
        let isHD = itagInfo ? itagInfo.isHD : stream.isHD;
        const isAudio = stream.type === 'audio' ||
          stream.contentType?.startsWith('audio/') ||
          itagInfo?.type === 'audio' ||
          itagInfo?.format === 'M4A';

        if ((!quality || quality === 'Video') && currentTargetVideo && currentTargetVideo.videoWidth > 0 && !isAudio) {
          quality = getQualityFromDimensions(currentTargetVideo.videoWidth, currentTargetVideo.videoHeight);
          isHD = /720|1080|1440|2160|4K|2K|HD/i.test(quality);
        }

        let size = stream.size || '';
        if (itag && ytMediaData?.itagMeta?.[String(itag)]?.size) {
          size = ytMediaData.itagMeta[String(itag)].size;
        }

        const qualityName = quality || (isAudio ? 'Audio' : 'Video');
        const formatName = format || (isAudio ? 'M4A' : 'MP4');
        const label = itagInfo?.label || `${qualityName} (${formatName})`;

        if (!seenLabels.has(label)) {
          results.push({
            url: stream.url,
            quality: qualityName,
            badge,
            label,
            format: formatName,
            type: isAudio ? 'audio' : 'video',
            isHD,
            size,
            itag
          });
          seenUrls.add(stream.url);
          seenLabels.add(label);
        }
      }
    }


    // 4. Current active video element direct source (for direct mp4 sites)
    if (currentTargetVideo && !window.location.hostname.includes('youtube.com')) {
      const src = currentTargetVideo.currentSrc || currentTargetVideo.src;
      if (src && !src.startsWith('blob:') && !src.startsWith('data:') && !seenUrls.has(src)) {
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
        seenUrls.add(src);
      }

      // Inspect <source> children
      const sources = currentTargetVideo.querySelectorAll('source');
      sources.forEach(source => {
        const sUrl = source.src;
        if (sUrl && !sUrl.startsWith('blob:') && !seenUrls.has(sUrl)) {
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
          seenUrls.add(sUrl);
        }
      });
    }

    // Strict descending sort: 8K, 4K, 2K, 1080p, 720p, 480p, 360p, 240p, 144p, Audio
    const getRank = (item) => {
      if (item.type === 'audio') return 10;
      const text = `${item.badge || ''} ${item.quality || ''} ${item.label || ''}`.toUpperCase();
      if (text.includes('8K') || text.includes('4320')) return 110;
      if (text.includes('4K') || text.includes('2160')) return 100;
      if (text.includes('2K') || text.includes('1440')) return 90;
      if (text.includes('1080')) return 80;
      if (text.includes('720')) return item.isMuxed ? 75 : 70;
      if (text.includes('480')) return 60;
      if (text.includes('360')) return item.isMuxed ? 55 : 50;
      if (text.includes('240')) return 40;
      if (text.includes('144')) return 30;
      return 45;
    };
    results.sort((a, b) => getRank(b) - getRank(a));

    return results;
  }

  function renderDropdownItems() {
    ensureDropdown();
    const dropdown = activeDropdown || activeGrabber;
    if (!dropdown) return;
    const listEl = dropdown.querySelector('#turboIdmList');
    const titleEl = dropdown.querySelector('#turboIdmTitle');

    const videoTitle = getActiveVideoTitle();
    if (titleEl) {
      titleEl.textContent = videoTitle;
      titleEl.title = videoTitle;
    }

    const streams = getAvailableMediaStreams();

    if (streams.length === 0) {
      const isYt = window.location.hostname.includes('youtube.com');
      const emptyMsg = (isYt && isResolvingYt)
        ? '⚡ Analyzing all video qualities (4K, 1080p, 720p)...<br>Turbo Engine is fetching direct streams.'
        : 'Scanning video stream qualities...<br>Play the video to capture high-definition stream.';
      listEl.innerHTML = `
        <div class="turbo-idm-empty">
          <p>${emptyMsg}</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = streams.map((stream, idx) => {
      const isAudio = stream.type === 'audio';
      const q = String(stream.quality || '').toUpperCase();
      const l = String(stream.label || '').toUpperCase();

      let pillText = stream.badge || 'SD';
      let pillClass = 'sd';

      if (isAudio) {
        pillText = 'AUDIO';
        pillClass = 'audio';
      } else if (q.includes('8K') || l.includes('8K')) {
        pillText = '8K';
        pillClass = 'hd pill-4k';
      } else if (q.includes('4K') || q.includes('2160') || l.includes('4K') || l.includes('2160')) {
        pillText = '4K';
        pillClass = 'hd pill-4k';
      } else if (q.includes('2K') || q.includes('1440') || l.includes('2K') || l.includes('1440')) {
        pillText = '2K';
        pillClass = 'hd pill-2k';
      } else if (q.includes('1080') || l.includes('1080')) {
        pillText = '1080P';
        pillClass = 'hd pill-1080';
      } else if (q.includes('720') || l.includes('720')) {
        pillText = '720P';
        pillClass = 'hd pill-720';
      } else if (q.includes('480') || l.includes('480')) {
        pillText = '480P';
        pillClass = 'sd';
      } else if (q.includes('360') || l.includes('360')) {
        pillText = '360P';
        pillClass = 'sd';
      } else if (stream.isHD) {
        pillText = 'HD';
        pillClass = 'hd';
      }

      const icon = isAudio ? '🎵' : '🎬';
      const sizeText = stream.size ? `<span class="turbo-idm-size">${escapeHtml(stream.size)}</span>` : '';
      const subInfo = `${escapeHtml(stream.format || 'MP4')}${stream.isMuxed ? ' · Video + Audio' : (isAudio ? ' · Audio Only' : ' · Video Stream')}`;

      return `
        <div class="turbo-idm-row" data-index="${idx}">
          <div class="turbo-idm-row-left">
            <span class="turbo-idm-media-icon">${icon}</span>
            <div class="turbo-idm-quality-info">
              <div class="turbo-idm-quality-top">
                <span class="turbo-idm-pill ${pillClass}">${escapeHtml(pillText)}</span>
                <span class="turbo-idm-quality-label">${escapeHtml(stream.label)}</span>
              </div>
              <div class="turbo-idm-quality-sub">${subInfo}</div>
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
        const qTag = stream.badge || stream.quality || '';
        const qualSuffix = qTag ? ` [${qTag.replace(/\s+/g, '_')}]` : '';
        const finalFilename = `${videoTitle}${qualSuffix}.${ext}`;

        safeSendMessage({
          action: 'downloadUrl',
          url: stream.url,
          filename: stream.filename || finalFilename,
          referer: window.location.href,
          origin: window.location.origin
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

  function toggleDropdown(triggerEl) {
    if (isDropdownOpen) {
      const wasSameTrigger = !triggerEl || activeTriggerEl === triggerEl || (activeTriggerEl && triggerEl && activeTriggerEl.id === triggerEl.id);
      closeDropdown();
      if (!wasSameTrigger) {
        openDropdown(triggerEl);
      }
    } else {
      openDropdown(triggerEl);
    }
  }

  function openDropdown(triggerEl) {
    ensureDropdown();
    activeTriggerEl = triggerEl || null;
    isDropdownOpen = true;
    activeDropdown.classList.add('is-open');

    if (activeGrabber && (!triggerEl || triggerEl === activeGrabber || activeGrabber.contains(triggerEl))) {
      activeGrabber.classList.add('is-open');
    }
    if (triggerEl && triggerEl.classList && triggerEl.classList.contains('turbo-yt-pill')) {
      triggerEl.classList.add('is-active');
    }

    // Request latest player formats from page context
    window.dispatchEvent(new CustomEvent('TURBO_REQUEST_YT_FORMATS'));

    // Request direct backend resolved streams (4K, 2K, 1080p, 720p, Audio)
    fetchResolvedYouTubeStreams();

    // Query latest streams from background
    safeSendMessage({ action: 'getTabMedia' }, (res) => {
      if (res && Array.isArray(res.streams)) {
        res.streams.forEach(addGenericMediaStream);
      }
      renderDropdownItems();
      positionDropdown();
    });

    renderDropdownItems();
    positionDropdown();
  }

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.classList.remove('is-open');
    }
    if (activeGrabber) {
      activeGrabber.classList.remove('is-open');
    }
    const ytPill = document.querySelector('.turbo-yt-pill');
    if (ytPill) ytPill.classList.remove('is-active');
    isDropdownOpen = false;
    activeTriggerEl = null;
  }

  function positionDropdown() {
    if (!isDropdownOpen || !activeDropdown) return;

    const fullscreenEl = document.fullscreenElement;
    if (fullscreenEl && activeDropdown.parentElement !== fullscreenEl) {
      fullscreenEl.appendChild(activeDropdown);
    } else if (!fullscreenEl && activeDropdown.parentElement !== document.body) {
      document.body.appendChild(activeDropdown);
    }

    let trigger = activeTriggerEl;
    if (!trigger || !document.contains(trigger)) {
      trigger = document.getElementById('turboYtActionBtn') || activeGrabber;
    }
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const dropdownWidth = Math.min(390, window.innerWidth - 24);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Decide if opening upwards or downwards
    if (spaceBelow < 300 && spaceAbove > 260) {
      activeDropdown.style.top = 'auto';
      activeDropdown.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
    } else {
      activeDropdown.style.top = `${Math.round(rect.bottom + 8)}px`;
      activeDropdown.style.bottom = 'auto';
    }

    // Horizontal positioning:
    if (rect.right > window.innerWidth / 2 && (rect.left + dropdownWidth > window.innerWidth)) {
      const rightMargin = Math.max(12, Math.round(window.innerWidth - rect.right));
      activeDropdown.style.left = 'auto';
      activeDropdown.style.right = `${rightMargin}px`;
    } else {
      const leftPos = Math.max(12, Math.min(Math.round(rect.left), window.innerWidth - dropdownWidth - 12));
      activeDropdown.style.left = `${leftPos}px`;
      activeDropdown.style.right = 'auto';
    }
  }

  function positionGrabber(targetEl) {
    if (!activeGrabber) return;
    const isYouTube = window.location.hostname.includes('youtube.com');
    const fullscreenEl = document.fullscreenElement;

    // On YouTube: Always anchor strictly inside the main player container at the top-right corner
    if (isYouTube) {
      const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (ytPlayer) {
        if (activeGrabber.parentElement !== ytPlayer) {
          ytPlayer.appendChild(activeGrabber);
        }
        activeGrabber.style.position = 'absolute';
        activeGrabber.style.top = '14px';
        activeGrabber.style.right = '18px';
        activeGrabber.style.left = 'auto';
        activeGrabber.style.bottom = 'auto';
        activeGrabber.style.zIndex = '2147483647';
        return;
      }
    }

    // In fullscreen mode, mount inside fullscreen element so it stays on top
    if (fullscreenEl && activeGrabber.parentElement !== fullscreenEl) {
      fullscreenEl.appendChild(activeGrabber);
      activeGrabber.style.position = 'absolute';
      activeGrabber.style.top = '16px';
      activeGrabber.style.right = '16px';
      activeGrabber.style.left = 'auto';
      activeGrabber.style.bottom = 'auto';
      return;
    }

    if (!fullscreenEl && activeGrabber.parentElement !== document.body) {
      document.body.appendChild(activeGrabber);
    }

    const rect = targetEl ? targetEl.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    // Pin the 34px icon button strictly to the top-right corner of the video
    activeGrabber.style.position = 'absolute';
    activeGrabber.style.top = `${window.scrollY + rect.top + 10}px`;
    activeGrabber.style.left = `${window.scrollX + rect.right - 46}px`;
    activeGrabber.style.right = 'auto';
    activeGrabber.style.bottom = 'auto';
    activeGrabber.style.zIndex = '2147483647';
  }

  function isDecorativeOrCoveredVideo(el) {
    if (!el || !document.contains(el)) return true;

    // Filter out thumbnail previews, tiny preview players, or miniature elements
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!rect || rect.width < 320 || rect.height < 180) {
      return true;
    }

    // Must be in viewport
    if (rect.bottom < 50 || rect.top > window.innerHeight - 50 || rect.right < 50 || rect.left > window.innerWidth - 50) {
      return true;
    }

    // Must be visible
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity || '1') < 0.1) {
      return true;
    }

    // Exclude background decorative autoplay loops without controls
    if (el.tagName === 'VIDEO') {
      if (el.autoplay && el.loop && el.muted && !el.controls) return true;
      if (style.position === 'fixed' || style.position === 'absolute') {
        if (el.clientWidth >= window.innerWidth * 0.9 && el.clientHeight >= window.innerHeight * 0.9) {
          return true;
        }
      }
      if (style.pointerEvents === 'none') return true;
    }

    // Exclude elements inside background containers, modals, or dialogs
    if (el.closest?.('.bg-video, .background-video, #bg-video, [aria-hidden="true"], [inert]')) {
      return true;
    }

    // Exclude YouTube homepage and search thumbnail preview elements
    if (el.closest?.('ytd-thumbnail, ytd-video-preview, #inline-preview-player, ytd-rich-grid-media, ytd-compact-video-renderer')) {
      return true;
    }

    // Check if an overlay, modal, form dialog or input is covering the video
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight) {
      const topEl = document.elementFromPoint(centerX, centerY);
      if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
        if (topEl.closest?.('dialog, [role="dialog"], form, .modal, .popup, input, textarea, select')) {
          return true;
        }
      }
    }

    return false;
  }

  function showGrabberFor(videoEl) {
    if (!mediaGrabberEnabled) return;
    if (!videoEl) return;
    if (isDecorativeOrCoveredVideo(videoEl)) return;

    if (window.location.hostname.includes('youtube.com')) {
      injectYouTubeActionButton();
      const isFullscreen = !!document.fullscreenElement;
      const hasActionBtn = !!document.getElementById('turboYtActionContainer');
      const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (ytPlayer && (isFullscreen || !hasActionBtn)) {
        currentTargetVideo = ytPlayer;
        const grabber = ensureGrabber();
        positionGrabber(ytPlayer);
        grabber.classList.add('is-visible');
        clearTimeout(hideTimer);
        return;
      }
      return;
    }

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
    if (!mediaGrabberEnabled) return;
    // YouTube specific player hook
    if (window.location.hostname.includes('youtube.com')) {
      injectYouTubeActionButton();
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

      const v = (ytPlayer ? ytPlayer.querySelector('video') : null) || document.querySelector('video');
      if (v && !v._turboVideoHooked) {
        v._turboVideoHooked = true;
        currentTargetVideo = v;
        const syncStreams = () => {
          safeSendMessage({ action: 'getTabMedia' }, (res) => {
            if (res && Array.isArray(res.streams)) {
              res.streams.forEach(addGenericMediaStream);
            }
          });
        };
        v.addEventListener('play', syncStreams);
        v.addEventListener('playing', syncStreams);
        v.addEventListener('loadedmetadata', syncStreams);
      }
      return;
    }

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
        // Collect detected streams in the background without popping up over forms
        safeSendMessage({ action: 'getTabMedia' }, (res) => {
          if (res && Array.isArray(res.streams)) {
            res.streams.forEach(addGenericMediaStream);
          }
        });
      });
    });
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target;

    // Immediately hide if user is interacting with forms, dialogs, or inputs
    if (target.closest?.('form, dialog, [role="dialog"], input, textarea, select, .modal, .popup')) {
      if (!isDropdownOpen && activeGrabber) {
        activeGrabber.classList.remove('is-visible');
      }
      return;
    }

    // On YouTube: strictly only care about the main #movie_player
    if (window.location.hostname.includes('youtube.com')) {
      const ytPlayer = target.closest?.('#movie_player') || (target.id === 'movie_player' ? target : null);
      if (ytPlayer) {
        showGrabberFor(ytPlayer);
      }
      return;
    }

    if (target.tagName === 'VIDEO') {
      showGrabberFor(target);
    }
  }, true);

  // Close dropdown on click outside or escape
  document.addEventListener('click', (e) => {
    if (!isDropdownOpen) return;
    if (activeDropdown && activeDropdown.contains(e.target)) return;
    if (activeTriggerEl && activeTriggerEl.contains(e.target)) return;
    if (activeGrabber && activeGrabber.contains(e.target)) return;
    closeDropdown();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDropdownOpen) {
      closeDropdown();
    }
  });

  // SPA navigation listeners on YouTube
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(injectYouTubeActionButton, 300);
  });
  window.addEventListener('spfdone', () => {
    setTimeout(injectYouTubeActionButton, 300);
  });

  window.addEventListener('scroll', () => {
    if (isDropdownOpen) {
      positionDropdown();
    }
    if (currentTargetVideo && activeGrabber && activeGrabber.classList.contains('is-visible')) {
      positionGrabber(currentTargetVideo);
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (isDropdownOpen) {
      positionDropdown();
    }
    if (currentTargetVideo && activeGrabber) {
      positionGrabber(currentTargetVideo);
    }
    injectYouTubeActionButton();
  });

  document.addEventListener('fullscreenchange', () => {
    if (isDropdownOpen) {
      positionDropdown();
    }
    if (currentTargetVideo && activeGrabber) {
      positionGrabber(currentTargetVideo);
    }
  });

  // Regular scan for dynamic SPA video insertion
  const scanInterval = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(scanInterval);
      return;
    }
    scanForVideos();
  }, 1500);
  scanForVideos();

  // Initial getTabMedia check
  safeSendMessage({ action: 'getTabMedia' }, (res) => {
    if (res && Array.isArray(res.streams)) {
      res.streams.forEach(addGenericMediaStream);
    }
  });
})();
