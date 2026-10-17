import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/**
 * Downloads a file slice with a bound localAddress adapter.
 */
function requestChunk({ urlStr, localAddress, start, end, signal }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Range': `bytes=${start}-${end}`,
        'Accept-Encoding': 'identity'
      },
      signal
    };

    if (localAddress) {
      options.localAddress = localAddress;
      if (!localAddress.includes(':')) {
        options.family = 4;
      }
    }

    const req = client.request(options, (res) => {
      if (res.statusCode !== 206) {
        return reject(new Error(`Server returned HTTP ${res.statusCode} (expected 206 Partial Content)`));
      }
      resolve(res);
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Probes the target resource for size, filename, and range support using Range: bytes=0-0.
 */
export function probeUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request({
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TurboDownloadManager/1.0',
        'Range': 'bytes=0-0'
      }
    }, (res) => {
      let contentLength = parseInt(res.headers['content-length'] || '0', 10);
      let supportsRanges = res.statusCode === 206;

      const contentRange = res.headers['content-range'];
      if (contentRange) {
        const match = contentRange.match(/\/(\d+|\*)/);
        if (match && match[1] !== '*') {
          contentLength = parseInt(match[1], 10);
          supportsRanges = true;
        }
      }

      const disposition = res.headers['content-disposition'] || '';
      let filename = 'download.bin';
      const match = disposition.match(/filename\*?=['"]?(?:UTF-8'')?([^'";]+)['"]?/i);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1]);
      } else {
        const basename = path.basename(parsed.pathname);
        if (basename && basename.length > 0 && !basename.includes('=')) {
          filename = basename;
        }
      }

      res.destroy(); // Consume no further bytes

      resolve({
        url: urlStr,
        filename,
        contentLength,
        supportsRanges,
        etag: res.headers['etag'] || null,
        contentType: res.headers['content-type'] || 'application/octet-stream'
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Multi-Interface Download Task.
 */
export class MultiInterfaceDownload {
  constructor(options) {
    this.id = options.id || Math.random().toString(36).substring(2, 9);
    this.url = options.url;
    this.outputDir = options.outputDir || process.cwd();
    this.filename = options.filename || 'download.bin';
    this.outputPath = path.join(this.outputDir, this.filename);
    this.connectionsPerInterface = options.connectionsPerInterface || 2;
    this.interfaces = options.interfaces || []; // Array of { name, address, label, type }
    this.totalConnections = Math.max(1, this.interfaces.length * this.connectionsPerInterface);

    this.status = 'idle'; // idle, downloading, paused, completed, error
    this.contentLength = 0;
    this.supportsRanges = false;
    this.segments = [];
    this.downloadedBytes = 0;
    this.startTime = null;
    this.endTime = null;
    this.error = null;

    // Per-interface telemetry: address -> { bytesDownloaded, currentSpeed, label, type }
    this.interfaceStats = {};
    this.interfaces.forEach((iface) => {
      this.interfaceStats[iface.address] = {
        name: iface.name,
        address: iface.address,
        label: iface.label,
        type: iface.type,
        bytesDownloaded: 0,
        currentSpeed: 0,
        activeStreams: 0
      };
    });

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
      currentSpeed: this.currentSpeed,
      etaSeconds: this.currentSpeed > 0 ? Math.max(0, Math.round((this.contentLength - this.downloadedBytes) / this.currentSpeed)) : 0,
      interfaces: Object.values(this.interfaceStats),
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

    // Only probe on initial run, not on resume
    if (this.contentLength === 0) {
      this.status = 'probing';
      this.notify();

      try {
        const probe = await probeUrl(this.url);
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

      if (this.supportsRanges && this.contentLength > 0) {
        await this.startMultiInterfaceDownload();
      } else {
        await this.startFallbackDownload();
      }

      // If user paused or cancelled during download, DO NOT mark as completed!
      if (this.status === 'paused' || this.status === 'cancelled') {
        return;
      }

      // Only mark completed if all segments are done or downloadedBytes >= contentLength
      if (this.downloadedBytes >= this.contentLength || (this.segments.length > 0 && this.segments.every(s => s.done))) {
        this.status = 'completed';
        this.endTime = Date.now();
        this.currentSpeed = 0;
        this.notify();
      }
    } catch (err) {
      if (this.status === 'paused' || this.status === 'cancelled' || this.abortController?.signal?.aborted) return;
      this.status = 'error';
      this.error = err.message;
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
    this.lastSampleBytes = this.downloadedBytes;
    this.lastSampleTime = Date.now();

    this.speedTimer = setInterval(() => {
      const now = Date.now();
      const deltaSec = (now - this.lastSampleTime) / 1000;
      if (deltaSec <= 0) return;

      const deltaTotal = this.downloadedBytes - this.lastSampleBytes;
      this.currentSpeed = Math.round(deltaTotal / deltaSec);

      for (const addr in this.interfaceStats) {
        const delta = this.interfaceStats[addr].bytesDownloaded - (lastInterfaceBytes[addr] || 0);
        this.interfaceStats[addr].currentSpeed = Math.round(delta / deltaSec);
        lastInterfaceBytes[addr] = this.interfaceStats[addr].bytesDownloaded;
      }

      this.lastSampleBytes = this.downloadedBytes;
      this.lastSampleTime = now;
      this.notify();
    }, 500);
  }

  async startMultiInterfaceDownload() {
    // 1. Open target file without truncating if resuming
    if (this.fd === null) {
      const fileExists = fs.existsSync(this.outputPath);
      this.fd = fs.openSync(this.outputPath, fileExists ? 'r+' : 'w+');
      if (!fileExists) {
        fs.ftruncateSync(this.fd, this.contentLength);
      }
    }

    // 2. Partition file into totalConnections slices only on initial start
    if (this.segments.length === 0) {
      const count = Math.max(1, this.totalConnections);
      const chunkSize = Math.floor(this.contentLength / count);
      const availableInterfaces = this.interfaces.length > 0 ? this.interfaces : [{ address: null, label: 'Default Gateway' }];

      for (let i = 0; i < count; i++) {
        const assignedIface = availableInterfaces[i % availableInterfaces.length];
        const start = i * chunkSize;
        const end = (i === count - 1) ? this.contentLength - 1 : (i + 1) * chunkSize - 1;

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

    // 3. Launch segment download workers concurrently with exact boundary clamping
    const downloadSegment = async (seg) => {
      if (seg.done || seg.currentOffset > seg.end) {
        seg.done = true;
        return;
      }

      seg.active = true;
      if (seg.interfaceAddress && this.interfaceStats[seg.interfaceAddress]) {
        this.interfaceStats[seg.interfaceAddress].activeStreams++;
      }
      this.notify();

      try {
        const stream = await requestChunk({
          urlStr: this.url,
          localAddress: seg.interfaceAddress,
          start: seg.currentOffset,
          end: seg.end,
          signal: this.abortController.signal
        });

        await new Promise((resolve, reject) => {
          stream.on('data', (chunk) => {
            if (this.status !== 'downloading') {
              stream.destroy();
              return resolve();
            }

            try {
              const remaining = seg.end - seg.currentOffset + 1;
              if (remaining <= 0) {
                stream.destroy();
                return resolve();
              }

              const toWrite = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
              fs.writeSync(this.fd, toWrite, 0, toWrite.length, seg.currentOffset);

              seg.currentOffset += toWrite.length;
              seg.downloaded += toWrite.length;
              this.downloadedBytes += toWrite.length;

              if (seg.interfaceAddress && this.interfaceStats[seg.interfaceAddress]) {
                this.interfaceStats[seg.interfaceAddress].bytesDownloaded += toWrite.length;
              }

              if (seg.currentOffset > seg.end) {
                stream.destroy();
                return resolve();
              }
            } catch (writeErr) {
              return reject(writeErr);
            }
          });

          stream.on('end', () => {
            seg.active = false;
            if (seg.currentOffset > seg.end) {
              seg.done = true;
            }
            if (seg.interfaceAddress && this.interfaceStats[seg.interfaceAddress]) {
              this.interfaceStats[seg.interfaceAddress].activeStreams = Math.max(0, this.interfaceStats[seg.interfaceAddress].activeStreams - 1);
            }
            resolve();
          });

          stream.on('error', (err) => {
            seg.active = false;
            if (seg.interfaceAddress && this.interfaceStats[seg.interfaceAddress]) {
              this.interfaceStats[seg.interfaceAddress].activeStreams = Math.max(0, this.interfaceStats[seg.interfaceAddress].activeStreams - 1);
            }
            if (this.status === 'paused' || this.status === 'cancelled' || this.abortController?.signal?.aborted) {
              return resolve();
            }
            reject(err);
          });
        });
      } catch (err) {
        seg.active = false;
        if (seg.interfaceAddress && this.interfaceStats[seg.interfaceAddress]) {
          this.interfaceStats[seg.interfaceAddress].activeStreams = Math.max(0, this.interfaceStats[seg.interfaceAddress].activeStreams - 1);
        }
        if (this.status === 'paused' || this.status === 'cancelled' || this.abortController?.signal?.aborted) return;
        throw err;
      }
    };

    // Run unfinished segments concurrently
    const unfinished = this.segments.filter(s => !s.done && s.currentOffset <= s.end);
    if (unfinished.length === 0) {
      return;
    }
    await Promise.all(unfinished.map(downloadSegment));
  }

  async startFallbackDownload() {
    this.fd = fs.openSync(this.outputPath, 'w');
    const parsed = new URL(this.url);
    const client = parsed.protocol === 'https:' ? https : http;

    await new Promise((resolve, reject) => {
      const req = client.get(this.url, { signal: this.abortController.signal }, (res) => {
        res.on('data', (chunk) => {
          if (this.status !== 'downloading') {
            req.destroy();
            return resolve();
          }
          fs.writeSync(this.fd, chunk, 0, chunk.length);
          this.downloadedBytes += chunk.length;
        });
        res.on('end', resolve);
        res.on('error', (err) => {
          if (this.status === 'paused' || this.status === 'cancelled') return resolve();
          reject(err);
        });
      });
      req.on('error', (err) => {
        if (this.status === 'paused' || this.status === 'cancelled') return resolve();
        reject(err);
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
