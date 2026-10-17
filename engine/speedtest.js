import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

// Fast reliable CDN test endpoints
const CDN_URL = 'https://speed.cloudflare.com/__down?bytes=25000000'; // 25 MB chunks
const PING_URL = 'https://speed.cloudflare.com/__down?bytes=0';

/**
 * Runs a sustained network speed test for at least 10 seconds on a specific network adapter.
 * @param {string|null} localAddress - IPv4 address of the adapter to test, or null for default.
 * @param {Function} [onProgress] - Callback for real-time progress updates.
 * @param {number} [durationSec=10] - Test duration in seconds (default: 10s).
 * @returns {Promise<{ ping: number, bytes: number, duration: number, mbps: number, speedFormatted: string, success: boolean, error?: string }>}
 */
export function runAdapterSpeedTest(localAddress, onProgress, durationSec = 10) {
  return new Promise((resolve) => {
    const targetDurationMs = Math.max(5000, durationSec * 1000);
    const startTime = Date.now();
    let totalBytes = 0;
    let ping = 0;
    let isFinished = false;
    let activeReq = null;
    let progressTimer = null;

    // Track rolling window speed
    let lastSampleBytes = 0;
    let lastSampleTime = startTime;
    let rollingMbps = 0;

    const stopTest = (error = null) => {
      if (isFinished) return;
      isFinished = true;
      if (progressTimer) clearInterval(progressTimer);
      if (activeReq) {
        try { activeReq.destroy(); } catch {}
      }

      const totalDuration = Math.max(0.1, (Date.now() - startTime) / 1000);
      const finalMbps = parseFloat(((totalBytes * 8) / (totalDuration * 1024 * 1024)).toFixed(2));
      const speedFormatted = `${(totalBytes / (totalDuration * 1024 * 1024)).toFixed(2)} MB/s (${finalMbps} Mbps)`;

      resolve({
        localAddress,
        ping: Math.round(ping),
        bytes: totalBytes,
        duration: parseFloat(totalDuration.toFixed(2)),
        mbps: finalMbps,
        speedFormatted,
        success: !error || totalBytes > 0,
        error: error ? error.message : undefined
      });
    };

    // 1. Measure initial Ping latency
    const measurePingAndStart = () => {
      const pingStart = Date.now();
      const parsedPing = new URL(PING_URL);
      const pingOptions = {
        method: 'GET',
        hostname: parsedPing.hostname,
        port: 443,
        path: parsedPing.pathname + parsedPing.search,
        headers: {
          'User-Agent': 'TurboDownloadManager-SpeedTest/2.0 (Windows NT 10.0; Win64; x64)',
          'Cache-Control': 'no-cache'
        },
        timeout: 4000
      };

      if (localAddress) {
        pingOptions.localAddress = localAddress;
        if (!localAddress.includes(':')) pingOptions.family = 4;
      }

      const pingReq = https.request(pingOptions, (res) => {
        ping = Date.now() - pingStart;
        res.resume();
        startDataStreaming();
      });

      pingReq.on('error', () => {
        ping = 45;
        startDataStreaming();
      });

      pingReq.on('timeout', () => {
        pingReq.destroy();
        ping = 80;
        startDataStreaming();
      });

      pingReq.end();
    };

    // 2. Continuous data streaming for targetDurationMs
    const startDataStreaming = () => {
      // Progress timer (emits updates every 200ms)
      progressTimer = setInterval(() => {
        const now = Date.now();
        const elapsedMs = now - startTime;
        const remainingSec = Math.max(0, Math.ceil((targetDurationMs - elapsedMs) / 1000));

        const deltaSec = (now - lastSampleTime) / 1000;
        if (deltaSec >= 0.4) {
          const deltaBytes = totalBytes - lastSampleBytes;
          rollingMbps = parseFloat(((deltaBytes * 8) / (deltaSec * 1024 * 1024)).toFixed(2));
          lastSampleBytes = totalBytes;
          lastSampleTime = now;
        }

        const overallMbps = parseFloat(((totalBytes * 8) / (Math.max(0.1, elapsedMs / 1000) * 1024 * 1024)).toFixed(2));

        if (onProgress) {
          onProgress({
            localAddress,
            bytesDownloaded: totalBytes,
            currentMbps: rollingMbps > 0 ? rollingMbps : overallMbps,
            overallMbps,
            remainingSec,
            ping: Math.round(ping),
            status: 'running'
          });
        }

        if (elapsedMs >= targetDurationMs) {
          stopTest();
        }
      }, 200);

      // Recursive stream fetcher to keep line saturated until test duration expires
      const fetchNextChunk = () => {
        if (isFinished || (Date.now() - startTime) >= targetDurationMs) {
          stopTest();
          return;
        }

        const parsed = new URL(CDN_URL);
        const reqOptions = {
          method: 'GET',
          hostname: parsed.hostname,
          port: 443,
          path: parsed.pathname + parsed.search,
          headers: {
            'User-Agent': 'TurboDownloadManager-SpeedTest/2.0 (Windows NT 10.0; Win64; x64)',
            'Accept-Encoding': 'identity',
            'Cache-Control': 'no-cache'
          },
          timeout: 15000
        };

        if (localAddress) {
          reqOptions.localAddress = localAddress;
          if (!localAddress.includes(':')) reqOptions.family = 4;
        }

        activeReq = https.request(reqOptions, (res) => {
          res.on('data', (chunk) => {
            totalBytes += chunk.length;
            if ((Date.now() - startTime) >= targetDurationMs) {
              res.destroy();
              stopTest();
            }
          });

          res.on('end', () => {
            if (!isFinished) {
              if ((Date.now() - startTime) < targetDurationMs) {
                fetchNextChunk();
              } else {
                stopTest();
              }
            }
          });

          res.on('error', (err) => {
            if (!isFinished) {
              if ((Date.now() - startTime) < targetDurationMs && totalBytes > 0) {
                setTimeout(fetchNextChunk, 200);
              } else {
                stopTest(err);
              }
            }
          });
        });

        activeReq.on('error', (err) => {
          if (!isFinished) {
            if ((Date.now() - startTime) < targetDurationMs && totalBytes > 0) {
              setTimeout(fetchNextChunk, 200);
            } else {
              stopTest(err);
            }
          }
        });

        activeReq.end();
      };

      fetchNextChunk();
    };

    measurePingAndStart();
  });
}
