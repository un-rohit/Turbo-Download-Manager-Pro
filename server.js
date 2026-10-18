import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getNetworkInterfaces } from './engine/network.js';
import { probeUrl } from './engine/downloader.js';
import { downloadManager } from './engine/state.js';
import { runAdapterSpeedTest } from './engine/speedtest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const LANDING_DIR = path.join(__dirname, 'landing');
const PORT = process.env.PORT || 4820;
const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip'
};

const sseClients = new Set();
let verifiedInterfacesCache = null;
let verifiedInterfacesCacheExpiresAt = 0;
let verifiedInterfacesScanPromise = null;

async function getVerifiedNetworkInterfaces(forceRefresh = false) {
  if (!forceRefresh && verifiedInterfacesCache && Date.now() < verifiedInterfacesCacheExpiresAt) {
    return verifiedInterfacesCache;
  }
  if (verifiedInterfacesScanPromise) return verifiedInterfacesScanPromise;

  verifiedInterfacesScanPromise = getNetworkInterfaces(true)
    .then((interfaces) => {
      verifiedInterfacesCache = interfaces;
      verifiedInterfacesCacheExpiresAt = Date.now() + 15000;
      return interfaces;
    })
    .finally(() => {
      verifiedInterfacesScanPromise = null;
    });
  return verifiedInterfacesScanPromise;
}

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

downloadManager.onGlobalUpdate((event, data) => {
  broadcastSSE(event, data);
});

export function getSettings() {
  const defaultDir = path.join(os.homedir(), 'Downloads', 'TurboDownloadManager');
  const defaults = {
    // 1. Save To / Location (IDM Exact Structure)
    downloadDir: defaultDir,
    tempDir: path.join(os.tmpdir(), 'TurboDownloadManager-Temp'),
    autoCategorize: true,
    promptForSavePath: true,
    rememberLastPath: true,
    activeCategory: 'General',
    categories: {
      General: path.join(defaultDir, 'General'),
      Compressed: path.join(defaultDir, 'Compressed'),
      Documents: path.join(defaultDir, 'Documents'),
      Music: path.join(defaultDir, 'Music'),
      Programs: path.join(defaultDir, 'Programs'),
      Video: path.join(defaultDir, 'Video')
    },

    // 2. General (IDM Standard)
    launchOnStartup: true,
    monitorClipboard: true,
    autoStartFromClipboard: false,
    browserIntegration: {
      chrome: true,
      edge: true,
      firefox: true,
      brave: true,
      opera: true,
      vivaldi: true
    },
    captureKeyForce: 'Alt',
    captureKeyPrevent: 'Ctrl',

    // 3. File Types (IDM Complete List)
    fileTypes: "3GP 7Z AAC ACE AIF ARJ ASF AVI BIN BZ2 EXE GZ GZIP IMG ISO LZH M4A M4V MKV MOV MP3 MP4 MPA MPE MPEG MPG MSI MSU OGG OGV PDF PLJ PPS PPT PPTX QT R0* R1* RA RAR ROX RPM SEA SIT SITX TAR TIF TIFF TAZ TGZ TS TXT WAV WMA WMV WXZ XLS XLSX Z ZIP",
    exceptionsList: "*.update.microsoft.com\n*.windowsupdate.com\n*.google.com/generate_204\n*.msftconnecttest.com",

    // 4. Connection & Channel Bonding
    connectionType: "LAN / Wi-Fi High Speed",
    maxConnections: 16,
    connectionsPerAdapter: 4,
    bondingStrategy: "dynamic_bonded", // dynamic_bonded, round_robin, primary_failover
    speedLimitEnabled: false,
    speedLimitKbps: 0,
    retryAttempts: 5,
    timeoutSeconds: 30,

    // 5. Downloads & Automation
    showStartDialog: true,
    showCompleteDialog: true,
    showProgressWindow: true,
    postDownloadAction: "none", // none, open_file, open_folder, shutdown
    playSoundOnComplete: true,
    playSoundOnError: true,
    virusScanEnabled: false,
    virusScannerPath: "C:\\Program Files\\Windows Defender\\MpCmdRun.exe",
    virusScannerArgs: "-Scan -ScanType 3 -File \"%file%\"",

    // 6. Proxy / Socks
    proxyMode: "system", // none, system, manual
    proxyHttpHost: "",
    proxyHttpPort: 8080,
    proxySocksHost: "",
    proxySocksPort: 1080,
    proxyUser: "",
    proxyPass: "",

    // 7. Site Logins
    siteLogins: [
      { id: "1", pattern: "*.rapidgator.net", username: "", password: "" },
      { id: "2", pattern: "*.mega.nz", username: "", password: "" }
    ],

    // 8. Dial-Up / VPN / Network
    autoReconnect: true,
    reconnectInterval: 5,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return {
        ...defaults,
        ...saved,
        categories: { ...defaults.categories, ...(saved.categories || {}) },
        browserIntegration: { ...defaults.browserIntegration, ...(saved.browserIntegration || {}) }
      };
    }
  } catch (err) {
    console.error('Error reading settings:', err);
  }
  return defaults;
}

export function saveSettings(newSettings) {
  const current = getSettings();
  const merged = { ...current, ...newSettings };
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving settings:', err);
  }
  return merged;
}

export function resolveCategoryFolder(filename, settings) {
  const ext = path.extname(filename || '').toLowerCase().replace('.', '');
  if (!settings.autoCategorize) {
    return { category: 'General', folder: settings.downloadDir };
  }

  const mapping = {
    Compressed: ['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'img', 'tgz', 'bz2', 'xz', 'arj', 'ace', 'lzh', 'z', 'sea'],
    Programs: ['exe', 'msi', 'msu', 'apk', 'appx', 'msix', 'bat', 'cmd', 'bin', 'deb', 'rpm'],
    Video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'ts', 'mpg', 'mpeg', 'mpe', 'asf', 'qt'],
    Music: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aif', 'mpa'],
    Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'pps', 'tif', 'tiff']
  };

  for (const [category, exts] of Object.entries(mapping)) {
    if (exts.includes(ext)) {
      return {
        category,
        folder: settings.categories?.[category] || path.join(settings.downloadDir, category)
      };
    }
  }
  return {
    category: 'General',
    folder: settings.categories?.General || path.join(settings.downloadDir, 'General')
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function isAllowedRequestOrigin(origin) {
  if (origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`) return true;
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^moz-extension:\/\/[0-9a-f-]{36}$/i.test(origin);
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const trimmed = (body || '').trim();
        resolve(trimmed ? JSON.parse(trimmed) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export async function handleRequest(req, res) {
  const origin = req.headers.origin;
  if (origin && !isAllowedRequestOrigin(origin)) {
    return sendJson(res, 403, { error: 'Cross-origin requests are not allowed' });
  }

  // Permit the local dashboard and installed browser extension only.
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // In Vercel / Cloud serverless environment, default root / serves the public landing page!
  if (process.env.VERCEL) {
    if (url.pathname === '/' || url.pathname === '/landing' || url.pathname === '/landing/') {
      const landingFile = path.join(LANDING_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(landingFile).pipe(res);
    }
    const cleanPath = url.pathname.replace(/^\/landing\//, '').replace(/^\//, '');
    const checkLandingAsset = path.resolve(LANDING_DIR, cleanPath);
    if (isPathInside(LANDING_DIR, checkLandingAsset) && fs.existsSync(checkLandingAsset) && fs.statSync(checkLandingAsset).isFile()) {
      const ext = path.extname(checkLandingAsset).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(checkLandingAsset).pipe(res);
    }
  }

  // SSE stream
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    sseClients.add(res);

    // Initial snapshot
    res.write(`event: init\ndata: ${JSON.stringify({ active: downloadManager.getAllActive(), history: downloadManager.getHistory() })}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // Settings API
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      return sendJson(res, 200, getSettings());
    }
    if (req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const updated = saveSettings(body);
        return sendJson(res, 200, updated);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  // Browse Folder Native Dialog
  if (url.pathname === '/api/browse-folder' && req.method === 'POST') {
    const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select Turbo Download Manager Folder'; $d.ShowNewFolderButton = $true; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ Write-Output $d.SelectedPath }"`;
    exec(psCmd, (err, stdout) => {
      const selected = (stdout || '').trim();
      return sendJson(res, 200, { path: selected || null });
    });
    return;
  }

  // Browse File Native Dialog (for Antivirus Scanner, custom scripts)
  if (url.pathname === '/api/browse-file' && req.method === 'POST') {
    const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Select Program / Executable'; $d.Filter = 'Executable Files (*.exe)|*.exe|All Files (*.*)|*.*'; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ Write-Output $d.FileName }"`;
    exec(psCmd, (err, stdout) => {
      const selected = (stdout || '').trim();
      return sendJson(res, 200, { path: selected || null });
    });
    return;
  }

  // Network Speed Tester (Individual or All Adapters - 5s test, only on user demand)
  if (url.pathname === '/api/speedtest' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const targetAddress = body.address; // 'all', specific IP, or array
      const duration = Math.min(5, parseInt(body.duration, 10) || 5);
      const ifaces = await getNetworkInterfaces(false);
      // Filter candidates: prefer online, or fallback to all detected physical interfaces
      let candidateIfaces = ifaces.filter(i => i.online);
      if (candidateIfaces.length === 0) candidateIfaces = ifaces;

      if (targetAddress && targetAddress !== 'all') {
        // Individual adapter speed test (5s)
        broadcastSSE('speedtest_start', { address: targetAddress, duration });
        const result = await runAdapterSpeedTest(targetAddress, (prog) => {
          broadcastSSE('speedtest_progress', prog);
        }, duration);
        if (result && result.success && result.bytes > 0) {
          broadcastSSE('interface_status_update', { address: targetAddress, online: true });
        }
        broadcastSSE('speedtest_complete', result);
        return sendJson(res, 200, { result });
      } else {
        // Test all candidate interfaces concurrently (5s)
        broadcastSSE('speedtest_start', { address: 'all', count: candidateIfaces.length, duration });
        const results = await Promise.all(
          candidateIfaces.map(iface => runAdapterSpeedTest(iface.address, (prog) => {
            broadcastSSE('speedtest_progress', prog);
          }, duration))
        );

        let totalBytes = 0;
        let totalDuration = 0;
        let totalMbps = 0;
        results.forEach(r => {
          if (r.success) {
            totalBytes += r.bytes;
            totalDuration = Math.max(totalDuration, r.duration);
            totalMbps += r.mbps;
            if (r.localAddress && r.bytes > 0) {
              broadcastSSE('interface_status_update', { address: r.localAddress, online: true });
            }
          }
        });

        const aggregateResult = {
          adapters: results,
          totalMbps: parseFloat(totalMbps.toFixed(2)),
          totalSpeedFormatted: `${(totalBytes / (Math.max(0.1, totalDuration) * 1024 * 1024)).toFixed(2)} MB/s (${totalMbps.toFixed(2)} Mbps)`,
          activeCount: candidateIfaces.length
        };

        broadcastSSE('speedtest_complete', aggregateResult);
        return sendJson(res, 200, aggregateResult);
      }
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Network Interfaces API
  if (url.pathname === '/api/interfaces') {
    try {
      const verifyConnectivity = url.searchParams.get('verify') !== 'false';
      const forceRefresh = url.searchParams.get('refresh') === 'true';
      const ifaces = verifyConnectivity
        ? await getVerifiedNetworkInterfaces(forceRefresh)
        : await getNetworkInterfaces(false);
      return sendJson(res, 200, { interfaces: ifaces });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // URL Probe with Category Auto-Routing
  if (url.pathname === '/api/probe' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body.url) return sendJson(res, 400, { error: 'Missing url parameter' });
      const probe = await probeUrl(body.url);
      const settings = getSettings();
      const resolved = resolveCategoryFolder(probe.filename, settings);
      return sendJson(res, 200, {
        ...probe,
        category: resolved.category,
        suggestedFolder: resolved.folder
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Create Download Task
  if (url.pathname === '/api/downloads' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body.url) return sendJson(res, 400, { error: 'Missing url parameter' });

      const settings = getSettings();
      let downloadPath = body.outputDir;
      if (!downloadPath) {
        const resolved = resolveCategoryFolder(body.filename, settings);
        downloadPath = resolved.folder;
      }

      if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
      }

      // If requested, remember this path for the detected category
      if (body.rememberPath && body.category && settings.categories) {
        settings.categories[body.category] = downloadPath;
        saveSettings({ categories: settings.categories });
      }

      const task = downloadManager.createDownload({
        url: body.url,
        filename: body.filename,
        outputDir: downloadPath,
        interfaces: body.interfaces || [],
        connectionsPerInterface: body.connectionsPerInterface || settings.connectionsPerAdapter || 4
      });

      return sendJson(res, 201, task.getSnapshot());
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/api/downloads' && req.method === 'GET') {
    return sendJson(res, 200, {
      active: downloadManager.getAllActive(),
      history: downloadManager.getHistory()
    });
  }

  const historyActionMatch = url.pathname.match(/^\/api\/download-history\/([^/]+)\/(remove|delete-file)$/);
  if (historyActionMatch && req.method === 'POST') {
    const [, historyId, action] = historyActionMatch;
    const item = downloadManager.getHistoryItem(historyId);
    if (!item) return sendJson(res, 404, { error: 'Download history item not found' });

    if (action === 'delete-file') {
      try {
        if (item.outputPath) {
          const filePath = path.resolve(item.outputPath);
          if (fs.existsSync(filePath)) {
            if (!fs.statSync(filePath).isFile()) {
              return sendJson(res, 400, { error: 'The saved path is not a file' });
            }
            fs.unlinkSync(filePath);
          }
        }
        downloadManager.removeHistoryItem(historyId);
        return sendJson(res, 200, { ok: true, fileDeleted: true });
      } catch (err) {
        return sendJson(res, 500, { error: `Could not delete downloaded file: ${err.message}` });
      }
    }

    downloadManager.removeHistoryItem(historyId);
    return sendJson(res, 200, { ok: true, fileDeleted: false });
  }

  const pauseMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/pause$/);
  if (pauseMatch && req.method === 'POST') {
    downloadManager.pause(pauseMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  const resumeMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/resume$/);
  if (resumeMatch && req.method === 'POST') {
    downloadManager.resume(resumeMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  const cancelMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    downloadManager.cancel(cancelMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  const toggleIfaceMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/toggle-interface$/);
  if (toggleIfaceMatch && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const downloadId = toggleIfaceMatch[1];
      const enabled = body.enabled !== undefined ? !!body.enabled : !body.paused;
      downloadManager.toggleInterface(downloadId, body.address, enabled);
      return sendJson(res, 200, { ok: true, id: downloadId, address: body.address, enabled });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/api/interfaces/toggle' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const enabled = body.enabled !== undefined ? !!body.enabled : !body.paused;
      downloadManager.toggleGlobalInterface(body.address, enabled);
      return sendJson(res, 200, { ok: true, address: body.address, enabled });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/api/open-folder' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const settings = getSettings();
      let rawPath = body.path || body.dir || settings.downloadDir || path.join(os.homedir(), 'Downloads');

      // Normalize path for Windows
      const targetPath = path.resolve(rawPath);

      let args = [];
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
          args = [`/select,${targetPath}`];
        } else {
          args = [targetPath];
        }
      } else {
        // If file does not exist, check or create the parent directory
        const parentDir = path.extname(targetPath) ? path.dirname(targetPath) : targetPath;
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        args = [parentDir];
      }

      const child = spawn('explorer.exe', args, { detached: true, stdio: 'ignore' });
      child.unref();

      return sendJson(res, 200, { ok: true, target: targetPath, args });
    } catch (err) {
      console.error('[Turbo Download Manager] Error opening folder:', err);
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Direct Download Endpoints
  if (url.pathname === '/download/extension' || url.pathname === '/download/extension.zip' || url.pathname === '/turbo-download-manager-extension.zip') {
    const zipPath = path.join(LANDING_DIR, 'turbo-download-manager-extension.zip');
    if (fs.existsSync(zipPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="turbo-download-manager-extension.zip"'
      });
      return fs.createReadStream(zipPath).pipe(res);
    }
    return sendJson(res, 404, { error: 'Extension archive not found' });
  }

  if (url.pathname === '/download/app' || url.pathname === '/download/app.zip' || url.pathname === '/download/windows' || url.pathname === '/turbo-download-manager-windows-portable.zip') {
    const appZipPath = path.join(LANDING_DIR, 'turbo-download-manager-windows-portable.zip');
    if (fs.existsSync(appZipPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="turbo-download-manager-windows-portable.zip"'
      });
      return fs.createReadStream(appZipPath).pipe(res);
    }
    return sendJson(res, 404, { error: 'Application archive not found' });
  }

  // Landing Page Static File Serving
  if (url.pathname === '/landing' || url.pathname.startsWith('/landing/')) {
    const relPath = url.pathname === '/landing' || url.pathname === '/landing/' 
      ? 'index.html' 
      : url.pathname.replace(/^\/landing\//, '');
    let landingFilePath = path.resolve(LANDING_DIR, relPath);
    if (!isPathInside(LANDING_DIR, landingFilePath)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (!fs.existsSync(landingFilePath) || !fs.statSync(landingFilePath).isFile()) {
      landingFilePath = path.join(LANDING_DIR, 'index.html');
    }

    const ext = path.extname(landingFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(landingFilePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Error loading landing asset');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
    return;
  }

  // Dashboard Static File Serving
  let filePath = path.resolve(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
  if (!isPathInside(PUBLIC_DIR, filePath)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Error loading asset');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

const server = http.createServer(handleRequest);

export default async function handler(req, res) {
  return handleRequest(req, res);
}

if (!process.env.VERCEL) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Turbo Download Manager] Port ${PORT} already bound. Reusing existing instance.`);
    } else {
      console.error('[Turbo Download Manager] Server error:', err);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Turbo Download Manager] Server running at http://127.0.0.1:${PORT}`);
  });
}
