import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

function sanitizeFilename(value) {
  const candidate = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const sanitized = candidate
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 240);
  const filename = sanitized || 'download.bin';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ? `_${filename}` : filename;
}

function formatByteCount(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index++) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(1)} ${unit}`;
}

function requestWithRedirects(urlStr, options = {}, redirectCount = 0, usedDefaultRoute = false) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(err);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error(`Unsupported download protocol: ${parsed.protocol}`));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      ...options,
      timeout: options.timeout || 30000,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`
    }, (res) => {
      res.tdmLocalAddress = options.localAddress || null;
      res.tdmUsedDefaultRoute = usedDefaultRoute;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && location) {
        if (redirectCount >= 10) {
          res.resume();
          return reject(new Error('Too many redirects while opening download URL'));
        }
        const redirectUrl = new URL(location, parsed).toString();
        res.resume();
        requestWithRedirects(redirectUrl, options, redirectCount + 1, usedDefaultRoute).then(resolve, reject);
        return;
      }
      resolve({ response: res, finalUrl: parsed.toString() });
    });

    req.setTimeout(options.timeout || 30000, () => {
      req.destroy(new Error(`Request timed out after ${Math.round((options.timeout || 30000) / 1000)} seconds`));
    });
    req.on('error', (err) => {
      if (err.code === 'EADDRNOTAVAIL' && options.localAddress && !usedDefaultRoute) {
        const { localAddress, family, ...defaultRouteOptions } = options;
        requestWithRedirects(urlStr, defaultRouteOptions, redirectCount, true).then(resolve, reject);
        return;
      }
      reject(err);
    });
    req.end();
  });
}

/**
 * Downloads a file slice with a bound localAddress adapter.
 */
function requestChunk({ urlStr, localAddress, start, end, expectedTotal, signal }) {
  return requestWithRedirects(urlStr, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Range': `bytes=${start}-${end}`,
        'Accept-Encoding': 'identity'
      },
      signal,
      ...(localAddress ? {
        localAddress,
        ...(!localAddress.includes(':') ? { family: 4 } : {})
      } : {})
    }).then(({ response: res }) => new Promise((resolve, reject) => {
      const contentRange = res.headers['content-range'];
      const match = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
      const validRange = res.statusCode === 206 && match &&
        Number(match[1]) === start && Number(match[2]) >= start &&
        (match[3] === '*' || Number(match[3]) === expectedTotal);
      if (!validRange) {
        const status = res.statusCode;
        // Some servers ignore Range and stream the entire file with HTTP 200.
        // Destroy that response immediately; draining it can waste gigabytes
        // for every segment before the single-connection fallback starts.
        res.destroy();
        const resourceChanged = status === 206 && match && match[3] !== '*' && Number(match[3]) !== expectedTotal;
        const reason = resourceChanged
          ? 'The remote file size changed during the download; restarting from the latest version'
          : status === 200
          ? 'The server does not support byte-range requests (HTTP 200 ignored Range)'
          : `Server returned HTTP ${status} without a valid byte range`;
        return reject(new Error(reason));
      }
      resolve(res);
    }));
}

/**
 * Probes the target resource for size, filename, and range support using Range: bytes=0-0.
 */
export function probeUrl(urlStr) {
  return requestWithRedirects(urlStr, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TurboDownloadManager/1.0',
        'Range': 'bytes=0-0',
        'Accept-Encoding': 'identity'
      }
    }).then(({ response: res, finalUrl }) => new Promise((resolve, reject) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const status = res.statusCode;
        res.resume();
        return reject(new Error(`Server returned HTTP ${status} while probing download URL`));
      }
      let contentLength = 0;
      let supportsRanges = false;

      const contentRange = res.headers['content-range'];
      if (contentRange) {
        const match = contentRange.match(/\/(\d+|\*)/);
        if (match && match[1] !== '*') {
          contentLength = parseInt(match[1], 10);
          supportsRanges = res.statusCode === 206 && contentLength > 0;
        }
      }
      if (res.statusCode !== 206) {
        contentLength = parseInt(res.headers['content-length'] || '0', 10);
      }

      const disposition = res.headers['content-disposition'] || '';
      let filename = 'download.bin';
      const match = disposition.match(/filename\*?=['"]?(?:UTF-8'')?([^'";]+)['"]?/i);
      if (match && match[1]) {
        try {
          filename = decodeURIComponent(match[1]);
        } catch {
          filename = match[1];
        }
      } else {
        const basename = path.basename(new URL(finalUrl).pathname);
        if (basename && basename.length > 0 && !basename.includes('=')) {
          filename = basename;
        }
      }
      filename = sanitizeFilename(filename);

      res.destroy(); // Consume no further bytes

      resolve({
        url: finalUrl,
        filename,
        contentLength,
        supportsRanges,
        etag: res.headers['etag'] || null,
        contentType: res.headers['content-type'] || 'application/octet-stream'
      });
    }));
}

/**
 * Multi-Interface Download Task.
 */
export class MultiInterfaceDownload {
  constructor(options) {
    this.id = options.id || Math.random().toString(36).substring(2, 9);
    this.url = options.url;
    this.outputDir = options.outputDir || process.cwd();
    this.filename = sanitizeFilename(options.filename || 'download.bin');
    this.outputPath = path.join(this.outputDir, this.filename);
    this.connectionsPerInterface = options.connectionsPerInterface || 2;
    this.interfaces = options.interfaces || []; // Array of { name, address, label, type }
    this.allowDefaultRoute = options.allowDefaultRoute ?? this.interfaces.length === 0;
    this.unavailableInterfaces = new Set();
    this.totalConnections = Math.max(1, this.interfaces.length * this.connectionsPerInterface);

    this.status = 'idle'; // idle, downloading, paused, completed, error
    this.contentLength = 0;
    this.supportsRanges = null;
    this.forceSingleConnection = false;
    this.fallbackReason = null;
    this.segments = [];
    this.downloadedBytes = 0;
    this.startTime = null;
    this.endTime = null;
    this.error = null;

    this.pausedInterfaces = new Set(options.pausedInterfaces || []);
    this.activeStreams = new Map(); // segId -> { stream, adapterAddress }

    // Per-interface telemetry: address -> { bytesDownloaded, currentSpeed, label, type, paused }
    this.interfaceStats = {};
    this.interfaces.forEach((iface) => {
      this.interfaceStats[iface.address] = {
        name: iface.name,
        address: iface.address,
        label: iface.label,
        type: iface.type,
        bytesDownloaded: 0,
        currentSpeed: 0,
        activeStreams: 0,
        paused: this.pausedInterfaces.has(iface.address)
      };
    });
    // Keep OS-routed traffic separate when a bound adapter address is stale or unavailable.
    this.defaultRouteStats = { bytesDownloaded: 0, currentSpeed: 0 };

    this.fd = null;
    this.abortController = null;
    this.speedTimer = null;
    this.lastSampleBytes = 0;
    this.lastSampleTime = Date.now();
    this.currentSpeed = 0; // Bytes/sec total
    this.listeners = new Set();
  }

  onUpdate(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch {}
    }
  }

  pauseInterface(address) {
    this.pausedInterfaces.add(address);
    if (this.interfaceStats[address]) {
      this.interfaceStats[address].paused = true;
      this.interfaceStats[address].currentSpeed = 0;
      this.interfaceStats[address].activeStreams = 0;
    }

    let pauseSingleConnection = false;
    // Abort active streams on this interface
    for (const [segId, entry] of this.activeStreams.entries()) {
      if (entry.adapterAddress === address) {
        if (entry.isFallback) pauseSingleConnection = true;
        try {
          if (entry.stream) entry.stream.destroy();
        } catch {}
        this.activeStreams.delete(segId);
      }
    }

    // A single-connection transfer cannot move to another adapter mid-stream.
    if (pauseSingleConnection) {
      this.pause();
      return;
    }

    // Free active segments belonging to this interface so others can pick them up
    for (const seg of this.segments) {
      if (seg.active && !seg.done && seg.interfaceAddress === address) {
        seg.active = false;
      }
    }

    this.notify();
  }

  resumeInterface(address) {
    this.pausedInterfaces.delete(address);
    if (this.interfaceStats[address]) {
      this.interfaceStats[address].paused = false;
    }
    this.notify();
  }

  isInterfacePaused(address) {
    return this.pausedInterfaces.has(address);
  }

  isAllDone() {
    if (this.contentLength > 0 && this.downloadedBytes >= this.contentLength) {
      return true;
    }
    return false;
  }

  findOrStealWork(workerAddress) {
    // 1. Look for any pending segment that is not done and not active
    for (const seg of this.segments) {
      if (!seg.done && !seg.active && seg.currentOffset <= seg.end) {
        seg.interfaceAddress = workerAddress;
        return seg;
      }
    }

    // 2. Dynamic Work Stealing:
    // If no free segments exist, find the active in-flight segment with the most remaining bytes!
    const MIN_STEAL_BYTES = 2 * 1024 * 1024; // 2 MB minimum to justify Range split
    let candidate = null;
    let maxRemaining = 0;

    for (const seg of this.segments) {
      if (seg.active && !seg.done) {
        const remaining = seg.end - seg.currentOffset + 1;
        if (remaining > maxRemaining && remaining >= MIN_STEAL_BYTES) {
          maxRemaining = remaining;
          candidate = seg;
        }
      }
    }

    if (candidate) {
      const remaining = candidate.end - candidate.currentOffset + 1;
      const half = Math.floor(remaining / 2);
      const oldEnd = candidate.end;
      const splitPoint = candidate.end - half;

      // Shorten the candidate's boundary
      candidate.end = splitPoint;

      // Create the new stolen segment with the second half
      const newSeg = {
        id: this.segments.length + 1,
        interfaceAddress: workerAddress,
        start: splitPoint + 1,
        end: oldEnd,
        currentOffset: splitPoint + 1,
        downloaded: 0,
        active: false,
        done: false
      };

      this.segments.push(newSeg);
      return newSeg;
    }

    return null;
  }

  getSnapshot() {
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      outputPath: this.outputPath,
      status: this.status,
      contentLength: this.contentLength,
      downloadedBytes: this.downloadedBytes,
      progress: this.contentLength > 0 ? Math.min(1, (this.downloadedBytes / this.contentLength)) : 0,
      allowDefaultRoute: this.allowDefaultRoute,
      waitingForAdapter: this.status === 'downloading' && !this.allowDefaultRoute &&
        (this.interfaces.length === 0 || this.interfaces.every(iface => this.pausedInterfaces.has(iface.address))),
      currentSpeed: this.currentSpeed,
      etaSeconds: this.currentSpeed > 0 ? Math.max(0, Math.round((this.contentLength - this.downloadedBytes) / this.currentSpeed)) : 0,
      supportsRanges: this.supportsRanges,
      transferMode: this.supportsRanges === false || this.forceSingleConnection
        ? 'single-connection'
        : (this.supportsRanges ? 'segmented' : 'checking'),
      forceSingleConnection: this.forceSingleConnection,
      fallbackReason: this.fallbackReason,
      interfaces: Object.values(this.interfaceStats).map(i => ({
        ...i,
        paused: this.pausedInterfaces.has(i.address)
      })),
      defaultRoute: { ...this.defaultRouteStats },
      segments: this.segments.map(s => ({
        id: s.id,
        interfaceAddress: s.interfaceAddress,
        start: s.start,
        end: s.end,
        currentOffset: s.currentOffset,
        downloaded: s.downloaded,
        total: s.end - s.start + 1,
        active: s.active,
        done: s.done
      })),
      error: this.error
    };
  }

  async start() {
    if (this.status === 'downloading') return;
    const isResuming = this.status === 'paused';

    // Only probe on initial run, not on resume
    if (this.contentLength === 0) {
      this.status = 'probing';
      this.notify();

      try {
        const probe = await probeUrl(this.url);
        this.url = probe.url;
        this.contentLength = probe.contentLength;
        this.supportsRanges = probe.supportsRanges;
        if (probe.filename && this.filename === 'download.bin') {
          this.filename = probe.filename;
          this.outputPath = path.join(this.outputDir, this.filename);
        }
      } catch (probeErr) {
        this.status = 'error';
        this.error = probeErr.message;
        this.notify();
        return;
      }
    }

    try {
      this.abortController = new AbortController();
      this.status = 'downloading';
      if (!this.startTime) this.startTime = Date.now();
      this.startSpeedTracker();

      if (this.supportsRanges && this.contentLength > 0 && !this.forceSingleConnection) {
        try {
          await this.startMultiInterfaceDownload(isResuming);
        } catch (multiError) {
          if (this.status === 'paused' || this.status === 'cancelled') return;
          if (/does not support byte-range requests|HTTP 200 ignored Range/i.test(multiError.message || '')) {
            this.supportsRanges = false;
          }
          this.forceSingleConnection = true;
          this.fallbackReason = multiError.message || 'The segmented transfer failed.';
          this.resetForSingleConnectionFallback();
          this.error = `Multi-interface attempt failed (${multiError.message}); retrying with one connection.`;
          this.notify();
          try {
            await this.startFallbackDownload();
          } catch (fallbackError) {
            throw new Error(`${this.error} Single-connection retry also failed (${fallbackError.message}).`);
          }
        }
      } else {
        await this.startFallbackDownload();
      }

      // If user paused or cancelled during download, DO NOT mark as completed!
      if (this.status === 'paused' || this.status === 'cancelled') {
        return;
      }

      // Only mark completed if all segments are done or downloadedBytes >= contentLength
      if (this.downloadedBytes > 0 && (this.contentLength === 0 || this.downloadedBytes === this.contentLength)) {
        this.contentLength = this.downloadedBytes;
        this.status = 'completed';
        this.error = null;
        this.endTime = Date.now();
        this.currentSpeed = 0;
        this.notify();
      }
    } catch (err) {
      if (this.status === 'paused' || this.status === 'cancelled' || this.abortController?.signal?.aborted) return;
      this.status = 'error';
      const isInterruptedStream = /aborted|closed|ended early|socket|timeout|reset/i.test(err.message || '');
      if (this.supportsRanges === false && this.downloadedBytes > 0 && isInterruptedStream) {
        const total = this.contentLength > 0 ? ` of ${formatByteCount(this.contentLength)}` : '';
        this.error = `Connection interrupted after ${formatByteCount(this.downloadedBytes)}${total}. This server does not support byte-range requests, so Turbo cannot resume the partial file; resuming will restart from the beginning.`;
      } else {
        this.error = err.message || 'The download failed for an unknown reason.';
      }
      this.notify();
    } finally {
      this.cleanup();
    }
  }

  startSpeedTracker() {
    let lastInterfaceBytes = {};
    for (const addr in this.interfaceStats) {
      lastInterfaceBytes[addr] = this.interfaceStats[addr].bytesDownloaded;
    }
    let lastDefaultRouteBytes = this.defaultRouteStats.bytesDownloaded;
    this.lastSampleBytes = this.downloadedBytes;
    this.lastSampleTime = Date.now();

    this.speedTimer = setInterval(() => {
      const now = Date.now();
      const deltaSec = (now - this.lastSampleTime) / 1000;
      if (deltaSec <= 0) return;

      const deltaTotal = this.downloadedBytes - this.lastSampleBytes;
      this.currentSpeed = Math.max(0, Math.round(deltaTotal / deltaSec));

      for (const addr in this.interfaceStats) {
        const delta = this.interfaceStats[addr].bytesDownloaded - (lastInterfaceBytes[addr] || 0);
        this.interfaceStats[addr].currentSpeed = Math.max(0, Math.round(delta / deltaSec));
        lastInterfaceBytes[addr] = this.interfaceStats[addr].bytesDownloaded;
      }
      const defaultRouteDelta = this.defaultRouteStats.bytesDownloaded - lastDefaultRouteBytes;
      this.defaultRouteStats.currentSpeed = Math.max(0, Math.round(defaultRouteDelta / deltaSec));
      lastDefaultRouteBytes = this.defaultRouteStats.bytesDownloaded;

      this.lastSampleBytes = this.downloadedBytes;
      this.lastSampleTime = now;
      this.notify();
    }, 500);
  }

  async startMultiInterfaceDownload(preserveExistingFile = false) {
    // 1. Open target file without truncating if resuming
    if (this.fd === null) {
      const fileExists = fs.existsSync(this.outputPath);
      this.fd = fs.openSync(this.outputPath, preserveExistingFile && fileExists ? 'r+' : 'w+');
      fs.ftruncateSync(this.fd, this.contentLength);
    }

    // 2. Partition file into initial slices (e.g. 16 or 24 slices)
    if (!this.supportsRanges || this.contentLength <= 0) {
      this.segments = [];
    } else if (this.segments.length === 0) {
      const initialCount = Math.max(16, this.totalConnections * 2);
      const chunkSize = Math.floor(this.contentLength / initialCount);
      const availableInterfaces = this.interfaces.length > 0 ? this.interfaces : [{ address: null, label: 'Default Gateway' }];

      for (let i = 0; i < initialCount; i++) {
        const assignedIface = availableInterfaces[i % availableInterfaces.length];
        const start = i * chunkSize;
        const end = (i === initialCount - 1) ? this.contentLength - 1 : (i + 1) * chunkSize - 1;

        this.segments.push({
          id: i + 1,
          interfaceAddress: assignedIface.address,
          start,
          end,
          currentOffset: start,
          downloaded: 0,
          active: false,
          done: false
        });
      }
    } else {
      // Resuming existing segments
      this.segments.forEach(seg => {
        seg.active = false;
        if (seg.currentOffset > seg.end) {
          seg.done = true;
        }
      });
    }

    this.notify();

    // 3. Worker loop per connection slot with dynamic work-stealing
    let workerFailure = null;
    const runWorker = async (adapterAddress) => {
      while (this.status === 'downloading' && !workerFailure) {
        const hasUsableInterface = this.interfaces.some(iface =>
          !this.pausedInterfaces.has(iface.address) && !this.unavailableInterfaces.has(iface.address)
        ) || this.allowDefaultRoute;
        if (!hasUsableInterface) {
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        // If this adapter is paused by user, wait
        if (this.pausedInterfaces.has(adapterAddress) && !this.unavailableInterfaces.has(adapterAddress)) {
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        const workerAddress = this.unavailableInterfaces.has(adapterAddress) ? null : adapterAddress;
        const seg = this.findOrStealWork(workerAddress);
        if (!seg) {
          if (this.isAllDone()) break;
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        try {
          await this.downloadSegment(seg, workerAddress);
        } catch (err) {
          workerFailure = err;
        }
      }
    };

    // 4. Launch workers across all configured network adapters
    const availableInterfaces = this.interfaces.length > 0 ? this.interfaces : [{ address: null }];
    const workersPerIface = Math.max(1, this.connectionsPerInterface || 2);
    const workerPromises = [];

    for (const iface of availableInterfaces) {
      for (let w = 0; w < workersPerIface; w++) {
        workerPromises.push(runWorker(iface.address));
      }
    }

    await Promise.all(workerPromises);
    if (workerFailure) throw workerFailure;
    if (this.status === 'downloading' && this.downloadedBytes !== this.contentLength) {
      throw new Error(`Download incomplete (${this.downloadedBytes} of ${this.contentLength} bytes received)`);
    }
  }

  async downloadSegment(seg, adapterAddress) {
    if (seg.done || seg.currentOffset > seg.end) {
      seg.done = true;
      return;
    }

    if (this.pausedInterfaces.has(adapterAddress)) {
      seg.active = false;
      return;
    }

    seg.active = true;
    const routes = [];
    const addRoute = (address) => {
      const route = address || null;
      if (routes.includes(route)) return;
      if (route === null ? this.allowDefaultRoute :
        (!this.pausedInterfaces.has(route) && !this.unavailableInterfaces.has(route))) routes.push(route);
    };
    addRoute(adapterAddress);
    this.interfaces.forEach(iface => addRoute(iface.address));
    if (this.allowDefaultRoute) {
      addRoute(null); // Use the OS route when no adapter is available or a bound address has disappeared.
    }
    if (routes.length === 0) {
      seg.active = false;
      return;
    }
    const maxAttempts = Math.min(6, Math.max(3, routes.length * 2));
    let lastError = null;

    this.notify();
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (this.status !== 'downloading') return;
        let route = routes[attempt % routes.length];
        if (route && (this.pausedInterfaces.has(route) || this.unavailableInterfaces.has(route))) continue;

        seg.interfaceAddress = route;
        if (route && this.interfaceStats[route]) this.interfaceStats[route].activeStreams++;
        this.notify();

        try {
          const stream = await requestChunk({
            urlStr: this.url,
            localAddress: route,
            start: seg.currentOffset,
            end: seg.end,
            expectedTotal: this.contentLength,
            signal: this.abortController.signal
          });
          if (stream.tdmUsedDefaultRoute && route) {
            this.unavailableInterfaces.add(route);
            this.allowDefaultRoute = true;
            if (this.interfaceStats[route]) {
              this.interfaceStats[route].activeStreams = Math.max(0, this.interfaceStats[route].activeStreams - 1);
            }
            route = null;
            seg.interfaceAddress = null;
            this.notify();
          }
          this.activeStreams.set(seg.id, { stream, adapterAddress: route });

          await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (err) => {
              if (settled) return;
              settled = true;
              if (err) reject(err);
              else resolve();
            };

            stream.on('data', (chunk) => {
              if (this.status !== 'downloading' || this.pausedInterfaces.has(route)) {
                stream.destroy();
                return finish();
              }

              try {
                const remaining = seg.end - seg.currentOffset + 1;
                if (remaining <= 0) {
                  stream.destroy();
                  seg.done = true;
                  return finish();
                }

                const toWrite = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
                fs.writeSync(this.fd, toWrite, 0, toWrite.length, seg.currentOffset);
                seg.currentOffset += toWrite.length;
                seg.downloaded += toWrite.length;
                this.downloadedBytes += toWrite.length;

                if (route && this.interfaceStats[route]) {
                  this.interfaceStats[route].bytesDownloaded += toWrite.length;
                } else {
                  this.defaultRouteStats.bytesDownloaded += toWrite.length;
                }

                if (seg.currentOffset > seg.end) {
                  stream.destroy();
                  seg.done = true;
                  finish();
                }
              } catch (writeErr) {
                stream.destroy();
                finish(writeErr);
              }
            });

            stream.on('end', () => {
              if (seg.currentOffset > seg.end) {
                seg.done = true;
                finish();
              } else {
                finish(new Error(`Segment ${seg.id} ended before all requested bytes arrived`));
              }
            });
            stream.on('error', finish);
            stream.on('aborted', () => {
              if (seg.currentOffset <= seg.end) {
                finish(new Error(`Segment ${seg.id} was aborted before completion`));
              }
            });
          });

          if (this.status !== 'downloading') return;
          if (route && this.pausedInterfaces.has(route)) continue;
          if (seg.currentOffset > seg.end) {
            seg.done = true;
            return;
          }
          throw new Error(`Segment ${seg.id} did not finish`);
        } catch (err) {
          if (this.status !== 'downloading') return;
          if (route && this.pausedInterfaces.has(route)) continue;
          lastError = err;
          if (/does not support byte-range requests|without a valid byte range|remote file size changed/i.test(err.message || '')) {
            throw err;
          }
        } finally {
          this.activeStreams.delete(seg.id);
          if (route && this.interfaceStats[route]) {
            this.interfaceStats[route].activeStreams = Math.max(0, this.interfaceStats[route].activeStreams - 1);
          }
          this.notify();
        }

        if (attempt + 1 < maxAttempts) {
          const delayMs = Math.min(1500, 250 * (2 ** Math.min(attempt, 3)));
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      throw new Error(`Segment ${seg.id} failed after ${maxAttempts} attempts: ${lastError?.message || 'network route unavailable'}`);
    } finally {
      seg.active = false;
      this.notify();
    }
  }

  resetForSingleConnectionFallback() {
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch {}
      this.fd = null;
    }
    this.segments = [];
    this.downloadedBytes = 0;
    this.currentSpeed = 0;
    this.defaultRouteStats.bytesDownloaded = 0;
    this.defaultRouteStats.currentSpeed = 0;
    this.interfaces.forEach(iface => {
      const stats = this.interfaceStats[iface.address];
      if (stats) {
        stats.bytesDownloaded = 0;
        stats.currentSpeed = 0;
        stats.activeStreams = 0;
      }
    });
    this.abortController = new AbortController();
    if (this.speedTimer) clearInterval(this.speedTimer);
    this.speedTimer = null;
    this.startSpeedTracker();
  }

  async startFallbackDownload() {
    let route;
    while (this.status === 'downloading' && route === undefined) {
      const availableInterface = this.interfaces.find(iface =>
        !this.pausedInterfaces.has(iface.address) && !this.unavailableInterfaces.has(iface.address)
      );
      if (availableInterface) route = availableInterface.address;
      else if (this.allowDefaultRoute) route = null;
      else await new Promise(resolve => setTimeout(resolve, 400));
    }
    if (this.status !== 'downloading') return;

    let resumeOffset = this.supportsRanges && this.contentLength > 0 ? this.downloadedBytes : 0;

    const resetFallbackProgress = () => {
      this.downloadedBytes = 0;
      this.currentSpeed = 0;
      this.defaultRouteStats.bytesDownloaded = 0;
      this.defaultRouteStats.currentSpeed = 0;
      for (const address in this.interfaceStats) {
        this.interfaceStats[address].bytesDownloaded = 0;
        this.interfaceStats[address].currentSpeed = 0;
        this.interfaceStats[address].activeStreams = 0;
      }
      this.segments = [];
      if (this.fd !== null) {
        try { fs.closeSync(this.fd); } catch {}
      }
      this.fd = null;
      if (this.speedTimer) clearInterval(this.speedTimer);
      this.speedTimer = null;
      this.startSpeedTracker();
      this.fd = fs.openSync(this.outputPath, 'w+');
    };

    // Without range support a partial file cannot be resumed safely. Start over
    // once, and avoid retry loops that would repeatedly transfer gigabytes.
    if (resumeOffset === 0 && this.downloadedBytes > 0) resetFallbackProgress();
    if (this.fd === null) this.fd = fs.openSync(this.outputPath, resumeOffset > 0 ? 'r+' : 'w+');
    if (resumeOffset === 0) fs.ftruncateSync(this.fd, 0);
    let responseBytes = 0;

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      const headers = {
        'User-Agent': 'Mozilla/5.0 TurboDownloadManager/1.0',
        'Accept-Encoding': 'identity'
      };
      if (resumeOffset > 0) headers.Range = `bytes=${resumeOffset}-`;
      requestWithRedirects(this.url, {
        method: 'GET',
        signal: this.abortController.signal,
        headers,
        ...(route ? { localAddress: route, ...(!route.includes(':') ? { family: 4 } : {}) } : {})
      }).then(({ response: res, finalUrl }) => {
        if (res.tdmUsedDefaultRoute && route) {
          this.unavailableInterfaces.add(route);
          this.allowDefaultRoute = true;
          route = null;
        }
        this.url = finalUrl;
        if (this.status !== 'downloading' || (route && this.pausedInterfaces.has(route))) {
          res.destroy();
          return finish();
        }
        if (resumeOffset > 0 && res.statusCode === 200) {
          // The server stopped honoring ranges; use this full response as a
          // clean restart instead of appending a duplicate copy to the file.
          resumeOffset = 0;
          responseBytes = 0;
          this.supportsRanges = false;
          resetFallbackProgress();
          this.notify();
        } else if (resumeOffset > 0) {
          const range = res.headers['content-range']?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
          if (res.statusCode !== 206 || !range || Number(range[1]) !== resumeOffset) {
            res.resume();
            return reject(new Error('The server did not return the requested resume range'));
          }
          if (range[3] !== '*') this.contentLength = Number(range[3]);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }
        this.activeStreams.set('fallback', { stream: res, adapterAddress: route, isFallback: true });
        res.once('close', () => this.activeStreams.delete('fallback'));
        const responseLength = parseInt(res.headers['content-length'] || '0', 10);
        if (res.statusCode === 200 && responseLength > 0) {
          // The full GET response is authoritative; a range probe may have
          // reported a stale size for a changing or redirected resource.
          this.contentLength = responseLength;
        }
        res.on('data', (chunk) => {
          if (this.status !== 'downloading') {
            res.destroy();
            return finish();
          }
          try {
            fs.writeSync(this.fd, chunk, 0, chunk.length, resumeOffset + responseBytes);
            responseBytes += chunk.length;
            this.downloadedBytes = resumeOffset + responseBytes;
            if (route && this.interfaceStats[route]) {
              this.interfaceStats[route].bytesDownloaded += chunk.length;
            } else {
              this.defaultRouteStats.bytesDownloaded += chunk.length;
            }
            // Chunked responses have no declared total. Keep the displayed
            // total at least as large as the bytes received until EOF confirms it.
            if (this.contentLength > 0 && this.downloadedBytes > this.contentLength) {
              this.contentLength = this.downloadedBytes;
            }
          } catch (writeErr) {
            res.destroy();
            finish(new Error(`Could not write the download to disk: ${writeErr.message}`));
          }
        });
        res.on('end', () => {
          if (this.downloadedBytes === 0) {
            return finish(new Error('The server returned an empty file; download was not completed'));
          }
          if (this.contentLength > 0 && this.downloadedBytes !== this.contentLength) {
            return finish(new Error(`Download ended early (${this.downloadedBytes} of ${this.contentLength} bytes)`));
          }
          this.contentLength = this.downloadedBytes;
          finish();
        });
        res.on('error', (err) => {
          if (this.status === 'paused' || this.status === 'cancelled') return finish();
          finish(err);
        });
        res.on('aborted', () => {
          if (this.status === 'paused' || this.status === 'cancelled') return finish();
          finish(new Error('The server closed the connection before the file finished downloading'));
        });
      }).catch((err) => {
        if (this.status === 'paused' || this.status === 'cancelled') return finish();
        finish(err);
      });
    });
  }

  pause() {
    if (this.status !== 'downloading' && this.status !== 'probing') return;
    this.status = 'paused';
    if (this.abortController) {
      this.abortController.abort();
    }
    this.cleanup();
    this.currentSpeed = 0;
    this.segments.forEach(s => { s.active = false; });
    for (const addr in this.interfaceStats) {
      this.interfaceStats[addr].currentSpeed = 0;
      this.interfaceStats[addr].activeStreams = 0;
    }
    this.notify();
  }

  resume() {
    if (this.status !== 'paused') return;
    this.start();
  }

  cancel() {
    this.status = 'cancelled';
    if (this.abortController) {
      this.abortController.abort();
    }
    this.cleanup();
    try {
      if (fs.existsSync(this.outputPath)) {
        fs.unlinkSync(this.outputPath);
      }
    } catch {}
    this.currentSpeed = 0;
    this.notify();
  }

  cleanup() {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch {}
      this.fd = null;
    }
  }
}
