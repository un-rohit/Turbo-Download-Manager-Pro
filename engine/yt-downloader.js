import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePythonPath, extractYouTubeVideoId, cleanTitle } from './yt-resolver.js';

let cachedFfmpegDir = null;
export function resolveFfmpegDir() {
  if (cachedFfmpegDir && fs.existsSync(path.join(cachedFfmpegDir, 'ffmpeg.exe'))) {
    return cachedFfmpegDir;
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const candidates = [
    path.join(rootDir, 'bin'),
    path.resolve(process.cwd(), 'bin'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-9.0.1-essentials_build', 'bin'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Turbo Download Manager', 'resources', 'app', 'bin'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps')
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'ffmpeg.exe')) || fs.existsSync(path.join(dir, 'ffmpeg'))) {
      cachedFfmpegDir = dir;
      // Also ensure it is in process.env.PATH so yt-dlp finds both ffmpeg and ffprobe
      if (!process.env.PATH.includes(dir)) {
        process.env.PATH = `${dir};${process.env.PATH}`;
      }
      return dir;
    }
  }
  return null;
}

function parseSpeedString(str) {
  if (!str) return 0;
  const match = str.trim().match(/([\d.]+)\s*([KMGT]?i?B\/s)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith('G')) return Math.round(val * 1024 * 1024 * 1024);
  if (unit.startsWith('M')) return Math.round(val * 1024 * 1024);
  if (unit.startsWith('K')) return Math.round(val * 1024);
  return Math.round(val);
}

function sanitizeFilename(value) {
  const candidate = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const sanitized = candidate
    .replace(/^["']+|["']+$/g, '')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 240);
  const filename = sanitized || 'youtube_video.mp4';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ? `_${filename}` : filename;
}

/**
 * YouTube Dedicated Download Task.
 * Uses yt-dlp with bundled/local FFmpeg to download and merge full-quality video + audio streams,
 * reporting live progress, speed, and ETA to the Turbo Download Manager UI.
 */
export class YouTubeDownloadTask {
  constructor(options = {}) {
    this.id = options.id || Math.random().toString(36).substring(2, 9);
    this.url = options.url || options.watchUrl;
    this.watchUrl = options.watchUrl || options.url;
    this.videoId = extractYouTubeVideoId(this.watchUrl) || extractYouTubeVideoId(this.url) || null;
    if (this.videoId) {
      this.watchUrl = `https://www.youtube.com/watch?v=${this.videoId}`;
    }

    this.outputDir = options.outputDir || process.cwd();
    this.filename = sanitizeFilename(options.filename || (this.videoId ? `YouTube_${this.videoId}.mp4` : 'youtube_video.mp4'));
    this.outputPath = path.join(this.outputDir, this.filename);

    this.badge = String(options.badge || options.quality || '').toUpperCase().trim();
    this.itag = options.itag ? String(options.itag) : null;
    this.isAudio = !!options.isAudio || this.badge === 'MP3' || this.badge === 'AUDIO' ||
      /\.(mp3|m4a|aac|opus|wav)$/i.test(this.filename) || String(options.format).toUpperCase() === 'MP3';

    this.format = options.format || (this.isAudio ? 'MP3' : 'MP4');
    this.status = 'idle'; // idle, probing, downloading, paused, completed, cancelled, error
    this.contentLength = Number(options.contentLength) || 0;
    this.downloadedBytes = 0;
    this.currentSpeed = 0;
    this.etaSeconds = 0;
    this.progress = 0;
    this.error = null;
    this.startTime = null;
    this.endTime = null;

    this.process = null;
    this.listeners = new Set();
    this.isPausedByUser = false;
    this.isCancelledByUser = false;
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
    const isSingleConn = false;
    return {
      id: this.id,
      url: this.watchUrl || this.url,
      filename: this.filename,
      outputPath: this.outputPath,
      status: this.status,
      contentLength: this.contentLength,
      downloadedBytes: this.downloadedBytes,
      progress: this.contentLength > 0 ? Math.min(1, this.downloadedBytes / this.contentLength) : (this.progress || 0),
      allowDefaultRoute: true,
      waitingForAdapter: false,
      currentSpeed: this.currentSpeed,
      etaSeconds: this.etaSeconds,
      supportsRanges: true,
      transferMode: 'youtube-stream',
      forceSingleConnection: false,
      fallbackReason: null,
      interfaces: [
        {
          name: 'Accelerated Stream',
          address: 'yt-dlp',
          label: 'YouTube High-Speed Stream',
          type: 'stream',
          bytesDownloaded: this.downloadedBytes,
          currentSpeed: this.currentSpeed,
          activeStreams: this.status === 'downloading' ? 1 : 0,
          paused: this.status === 'paused'
        }
      ],
      defaultRoute: { bytesDownloaded: this.downloadedBytes, currentSpeed: this.currentSpeed },
      segments: [],
      error: this.error
    };
  }

  pauseInterface() {}
  resumeInterface() {}

  pause() {
    this.isPausedByUser = true;
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch {}
      this.process = null;
    }
    this.status = 'paused';
    this.currentSpeed = 0;
    this.notify();
  }

  resume() {
    this.isPausedByUser = false;
    this.isCancelledByUser = false;
    this.status = 'downloading';
    this.error = null;
    this.notify();
    this.start();
  }

  cancel() {
    this.isCancelledByUser = true;
    if (this.process) {
      try { this.process.kill('SIGKILL'); } catch {}
      this.process = null;
    }
    this.status = 'cancelled';
    this.currentSpeed = 0;
    this.notify();

    // Clean up partial files
    setTimeout(() => {
      try {
        const dir = path.dirname(this.outputPath);
        const base = path.basename(this.outputPath, path.extname(this.outputPath));
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            if (f.startsWith(base) && (f.endsWith('.part') || f.endsWith('.ytdl'))) {
              try { fs.unlinkSync(path.join(dir, f)); } catch {}
            }
          }
        }
      } catch {}
    }, 500);
  }

  buildYtDlpArgs(ffmpegDir) {
    const args = [
      '-m', 'yt_dlp',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '--newline',
      '--no-playlist',
      '--no-colors',
      '--progress-template', 'download-progress:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress.eta)s',
      '-o', this.outputPath
    ];

    if (ffmpegDir) {
      args.push('--ffmpeg-location', ffmpegDir);
    }

    if (this.isAudio) {
      args.push('-x', '--audio-format', 'mp3', '-f', 'bestaudio/best');
    } else {
      let formatSelector = 'bestvideo+bestaudio/best';
      if (this.badge === '4K') {
        formatSelector = 'bestvideo[height<=?2160]+bestaudio/best[height<=?2160]/best';
      } else if (this.badge === '2K') {
        formatSelector = 'bestvideo[height<=?1440]+bestaudio/best[height<=?1440]/best';
      } else if (this.badge === '1080P') {
        formatSelector = 'bestvideo[height<=?1080]+bestaudio/best[height<=?1080]/best';
      } else if (this.badge === '720P') {
        formatSelector = 'bestvideo[height<=?720]+bestaudio/best[height<=?720]/best';
      } else if (this.badge === '480P') {
        formatSelector = 'bestvideo[height<=?480]+bestaudio/best[height<=?480]/best';
      } else if (this.badge === '360P') {
        formatSelector = 'bestvideo[height<=?360]+bestaudio/best[height<=?360]/best';
      } else if (this.itag && /^\d+$/.test(this.itag)) {
        formatSelector = `${this.itag}+bestaudio/best`;
      }
      args.push('-f', formatSelector, '--merge-output-format', 'mp4');
    }

    args.push(this.watchUrl);
    return args;
  }

  async start() {
    if (this.status === 'downloading' && this.process) return;
    this.isPausedByUser = false;
    this.isCancelledByUser = false;
    this.status = 'downloading';
    if (!this.startTime) this.startTime = Date.now();
    this.notify();

    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }

      const pythonCmd = await resolvePythonPath();
      const ffmpegDir = resolveFfmpegDir();
      const args = this.buildYtDlpArgs(ffmpegDir);

      const child = spawn(pythonCmd, args, { windowsHide: true });
      this.process = child;

      let lastStderr = '';

      child.stdout.on('data', (data) => {
        if (this.status !== 'downloading') return;
        const text = data.toString('utf8');
        const lines = text.split(/[\r\n]+/);
        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith('download-progress:')) {
            const raw = line.slice('download-progress:'.length);
            const [pctStr, downStr, totStr, estStr, spdStr, etaStr] = raw.split('|');

            const pct = parseFloat(String(pctStr || '').replace('%', '').trim()) / 100;
            if (!isNaN(pct)) this.progress = Math.max(0, Math.min(1, pct));

            const downloaded = parseInt(downStr, 10);
            if (!isNaN(downloaded) && downloaded >= 0) {
              this.downloadedBytes = downloaded;
            }

            const total = parseInt(totStr, 10) || parseInt(estStr, 10);
            if (!isNaN(total) && total > 0) {
              this.contentLength = Math.max(this.contentLength, total);
            }

            this.currentSpeed = parseSpeedString(spdStr);
            const eta = parseInt(etaStr, 10);
            if (!isNaN(eta) && eta >= 0) {
              this.etaSeconds = eta;
            }

            this.notify();
          }
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString('utf8');
        lastStderr = text.slice(-300);
      });

      child.on('close', (code) => {
        this.process = null;
        if (this.isPausedByUser || this.isCancelledByUser) return;

        if (code === 0) {
          // Resolve actual final file on disk (extension might be .mp3 if audio or .mp4 if video)
          let finalPath = this.outputPath;
          if (!fs.existsSync(finalPath)) {
            // Check potential alternative extension
            const altExt = this.isAudio ? '.mp3' : '.mp4';
            const candidate = path.join(this.outputDir, `${path.basename(this.outputPath, path.extname(this.outputPath))}${altExt}`);
            if (fs.existsSync(candidate)) {
              finalPath = candidate;
              this.outputPath = candidate;
              this.filename = path.basename(candidate);
            }
          }

          if (fs.existsSync(finalPath)) {
            const stat = fs.statSync(finalPath);
            // Verify file is not a bogus 31-byte text error
            if (stat.size <= 1024) {
              this.status = 'error';
              this.error = `Download failed: output file is too small (${stat.size} bytes).`;
              this.notify();
              return;
            }

            this.contentLength = stat.size;
            this.downloadedBytes = stat.size;
            this.progress = 1.0;
            this.status = 'completed';
            this.error = null;
            this.endTime = Date.now();
            this.currentSpeed = 0;
            this.etaSeconds = 0;
            this.notify();
          } else {
            this.status = 'error';
            this.error = 'Download finished but output file could not be found on disk.';
            this.notify();
          }
        } else {
          this.status = 'error';
          this.error = lastStderr.trim() || `YouTube download process exited with code ${code}`;
          this.currentSpeed = 0;
          this.notify();
        }
      });

      child.on('error', (err) => {
        this.process = null;
        if (this.isPausedByUser || this.isCancelledByUser) return;
        this.status = 'error';
        this.error = err.message;
        this.notify();
      });
    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      this.notify();
    }
  }
}
