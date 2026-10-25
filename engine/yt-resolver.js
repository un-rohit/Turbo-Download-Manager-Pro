import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const ytCache = new Map();

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return '';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function cleanTitle(title) {
  return String(title || 'YouTube_Video')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

let cachedPythonPath = null;
export async function resolvePythonPath() {
  if (cachedPythonPath) return cachedPythonPath;
  const candidates = [
    'python',
    'python3',
    'py',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe')
  ];

  for (const cmd of candidates) {
    if (!cmd) continue;
    try {
      if (cmd.includes('\\') && !fs.existsSync(cmd)) continue;
      await execFileAsync(cmd, ['-m', 'yt_dlp', '--version'], { timeout: 4000, windowsHide: true });
      cachedPythonPath = cmd;
      return cmd;
    } catch {}
  }
  return 'python';
}

export function extractYouTubeVideoId(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1).split('/')[0].split('?')[0];
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const match = url.pathname.match(/\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
  } catch {}
  return null;
}

export async function resolveYouTubeFormats(watchUrl) {
  const videoId = extractYouTubeVideoId(watchUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube video URL: video ID not found');
  }

  // Check cache (TTL: 1 hour)
  const cached = ytCache.get(videoId);
  if (cached && (Date.now() - cached.timestamp < 3600000)) {
    return cached.data;
  }

  const pythonCmd = await resolvePythonPath();
  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const args = [
    '-m', 'yt_dlp',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '-J',
    '--no-playlist',
    cleanUrl
  ];

  const { stdout } = await execFileAsync(pythonCmd, args, {
    maxBuffer: 25 * 1024 * 1024,
    timeout: 35000,
    windowsHide: true
  });

  const info = JSON.parse(stdout);
  const title = cleanTitle(info.title);
  const rawFormats = Array.isArray(info.formats) ? info.formats : [];

  // Sort formats by bitrate / size descending so highest quality is prioritized
  const sorted = [...rawFormats].sort((a, b) => {
    const aVal = (a.tbr || 0) * 1000 + (a.height || 0) * 10000 + (a.filesize || 0);
    const bVal = (b.tbr || 0) * 1000 + (b.height || 0) * 10000 + (b.filesize || 0);
    return bVal - aVal;
  });

  const candidateStreams = [];
  const seenQualities = new Set();

  for (const f of sorted) {
    if (!f.url || !f.url.startsWith('http')) continue;
    if (f.format_id?.startsWith('sb')) continue;
    if (f.protocol === 'm3u8_native' || f.protocol?.startsWith('m3u8')) continue;

    const isVideo = f.vcodec && f.vcodec !== 'none';
    const isAudio = f.acodec && f.acodec !== 'none';
    const isMuxed = isVideo && isAudio;

    const height = f.height || (f.resolution?.match(/(\d+)x(\d+)/)?.[2]) || 0;
    const width = f.width || (f.resolution?.match(/(\d+)x(\d+)/)?.[1]) || 0;
    const ext = (f.ext || 'mp4').toUpperCase();
    const size = f.filesize || f.filesize_approx || 0;

    let qualityLabel = '';
    let badge = '';
    let isHD = false;

    if (height >= 2160 || width >= 3840) {
      qualityLabel = '4K (2160p)';
      badge = '4K';
      isHD = true;
    } else if (height >= 1440 || width >= 2560) {
      qualityLabel = '2K (1440p)';
      badge = '2K';
      isHD = true;
    } else if (height >= 1080 || width >= 1920) {
      qualityLabel = '1080p Full HD';
      badge = '1080P';
      isHD = true;
    } else if (height >= 720 || width >= 1280) {
      qualityLabel = '720p HD';
      badge = '720P';
      isHD = true;
    } else if (height >= 480) {
      qualityLabel = '480p';
      badge = '480P';
    } else if (height >= 360) {
      qualityLabel = '360p';
      badge = '360P';
    } else if (height >= 240) {
      qualityLabel = '240p';
      badge = '240P';
    } else if (height > 0) {
      qualityLabel = `${height}p`;
      badge = `${height}P`;
    }

    if (isVideo && badge) {
      const qKey = `${badge}_${ext}`;
      if (seenQualities.has(qKey)) continue;
      seenQualities.add(qKey);

      candidateStreams.push({
        url: f.url,
        watchUrl: cleanUrl,
        isYouTube: true,
        quality: qualityLabel,
        badge,
        label: `${qualityLabel} ${ext}${isMuxed ? ' · Video + Audio' : ''}`,
        format: ext,
        type: 'video',
        isHD,
        isMuxed,
        size: formatBytes(size),
        contentLength: size,
        itag: f.format_id,
        filename: `${title} [${badge}].${ext.toLowerCase()}`
      });
    } else if (isAudio && !isVideo) {
      const isM4A = ext === 'M4A' || (f.mimeType && f.mimeType.includes('mp4'));
      const formatName = isM4A ? 'M4A' : 'WebM';
      const qKey = `AUDIO_${formatName}`;
      if (seenQualities.has(qKey)) continue;
      seenQualities.add(qKey);

      const abr = Math.round(f.abr || (f.tbr) || 128);
      candidateStreams.push({
        url: f.url,
        watchUrl: cleanUrl,
        isYouTube: true,
        quality: 'Audio',
        badge: 'MP3',
        label: `Audio Only (${formatName} · ${abr} kbps)`,
        format: formatName,
        type: 'audio',
        isHD: false,
        isMuxed: false,
        size: formatBytes(size),
        contentLength: size,
        itag: f.format_id,
        filename: `${title} [Audio].${formatName.toLowerCase()}`
      });
    }
  }

  // Priority ranking
  const rank = (s) => {
    if (s.type === 'audio') return 10;
    if (s.badge === '4K') return 100;
    if (s.badge === '2K') return 90;
    if (s.badge === '1080P') return 80;
    if (s.badge === '720P') return s.isMuxed ? 75 : 70;
    if (s.badge === '480P') return 60;
    if (s.badge === '360P') return s.isMuxed ? 55 : 50;
    if (s.badge === '240P') return 40;
    return 30;
  };
  candidateStreams.sort((a, b) => rank(b) - rank(a));

  const result = {
    title,
    videoId,
    duration: info.duration,
    thumbnail: info.thumbnail,
    streams: candidateStreams
  };

  ytCache.set(videoId, { data: result, timestamp: Date.now() });
  return result;
}
