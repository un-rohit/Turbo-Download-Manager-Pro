import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MultiInterfaceDownload } from './downloader.js';

function resolveHistoryFile() {
  if (process.env.TURBO_DATA_DIR) {
    return path.join(process.env.TURBO_DATA_DIR, 'downloads-history.json');
  }
  const candidates = [
    path.join(process.cwd(), 'downloads-history.json'),
    path.resolve(process.cwd(), '..', 'downloads-history.json')
  ];

  try {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    candidates.push(path.join(projectRoot, 'downloads-history.json'));
    candidates.push(path.resolve(projectRoot, '..', 'downloads-history.json'));
    candidates.push(path.resolve(projectRoot, '..', '..', 'downloads-history.json'));
  } catch {}

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

class DownloadManager {
  constructor() {
    this.downloads = new Map();
    this.historyFile = resolveHistoryFile();
    this.historyNeedsRepair = false;
    this.history = this.loadHistory();
    if (this.historyNeedsRepair) this.saveHistory();
    this.globalListeners = new Set();
    this.disabledInterfaces = new Set();
    this.registerExitHandlers();
  }

  loadHistory() {
    let raw = null;
    try {
      if (fs.existsSync(this.historyFile)) {
        raw = fs.readFileSync(this.historyFile, 'utf8');
      }
    } catch {}

    // If main history file is missing or corrupted, try backup
    if (!raw) {
      const bakFile = `${this.historyFile}.bak`;
      try {
        if (fs.existsSync(bakFile)) {
          raw = fs.readFileSync(bakFile, 'utf8');
          this.historyNeedsRepair = true;
        }
      } catch {}
    }

    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          if (saved.length > 50) this.historyNeedsRepair = true;
          return saved.slice(0, 50).map((item) => {
            if (item.status !== 'completed') return item;

            let fileStat = null;
            try {
              const filePath = item.outputPath && path.resolve(item.outputPath);
              if (filePath && fs.existsSync(filePath)) fileStat = fs.statSync(filePath);
            } catch {}

            const savedBytes = Number(item.downloadedBytes ?? item.contentLength) || 0;
            const updates = {};
            if (!item.completedAt && fileStat?.isFile()) {
              updates.completedAt = fileStat.mtime.toISOString();
            }
            if (savedBytes <= 0 && fileStat?.isFile() && fileStat.size > 0) {
              updates.contentLength = fileStat.size;
              updates.downloadedBytes = fileStat.size;
            } else if (savedBytes <= 0) {
              this.historyNeedsRepair = true;
              return { ...item, ...updates, status: 'error', downloadedBytes: 0, error: 'No file data was saved' };
            }

            if (Object.keys(updates).length) this.historyNeedsRepair = true;
            return Object.keys(updates).length ? { ...item, ...updates } : item;
          });
        }
      } catch {
        // Corrupted JSON: fallback to backup file if available
        const bakFile = `${this.historyFile}.bak`;
        try {
          if (fs.existsSync(bakFile)) {
            const bakRaw = fs.readFileSync(bakFile, 'utf8');
            const bakSaved = JSON.parse(bakRaw);
            if (Array.isArray(bakSaved)) {
              this.historyNeedsRepair = true;
              return bakSaved.slice(0, 50);
            }
          }
        } catch {}
      }
    }
    return [];
  }

  saveHistory() {
    try {
      const data = JSON.stringify(this.history.slice(0, 50), null, 2);
      const tmpFile = `${this.historyFile}.tmp.${process.pid}.${Date.now()}`;
      const bakFile = `${this.historyFile}.bak`;
      fs.writeFileSync(tmpFile, data, 'utf8');
      try {
        if (fs.existsSync(this.historyFile)) {
          fs.copyFileSync(this.historyFile, bakFile);
        }
      } catch {}
      fs.renameSync(tmpFile, this.historyFile);
    } catch {
      try {
        fs.writeFileSync(this.historyFile, JSON.stringify(this.history.slice(0, 50), null, 2), 'utf8');
      } catch {}
    }
  }

  registerExitHandlers() {
    const handleExit = () => {
      let hasChanges = false;
      for (const [id, task] of this.downloads.entries()) {
        try {
          const snapshot = task.getSnapshot();
          if (snapshot.status === 'downloading' || snapshot.status === 'paused' || snapshot.status === 'probing') {
            task.pause();
            const existingIdx = this.history.findIndex(h => h.id === snapshot.id);
            const item = {
              id: snapshot.id,
              url: snapshot.url,
              filename: snapshot.filename,
              outputPath: snapshot.outputPath,
              contentLength: snapshot.contentLength,
              downloadedBytes: snapshot.downloadedBytes,
              supportsRanges: snapshot.supportsRanges ?? null,
              fallbackReason: snapshot.fallbackReason || null,
              status: 'paused',
              error: null,
              completedAt: new Date().toISOString()
            };
            if (existingIdx >= 0) {
              this.history[existingIdx] = item;
            } else {
              this.history.unshift(item);
            }
            hasChanges = true;
          }
        } catch {}
      }
      if (hasChanges) {
        this.history = this.history.slice(0, 50);
        this.saveHistory();
      }
    };

    process.once('beforeExit', handleExit);
    process.once('SIGINT', () => { handleExit(); process.exit(0); });
    process.once('SIGTERM', () => { handleExit(); process.exit(0); });
  }

  onGlobalUpdate(cb) {
    this.globalListeners.add(cb);
    return () => this.globalListeners.delete(cb);
  }

  broadcast(event, data) {
    for (const listener of this.globalListeners) {
      try { listener(event, data); } catch {}
    }
  }

  createDownload(options) {
    const task = new MultiInterfaceDownload(options);
    this.downloads.set(task.id, task);

    task.onUpdate((snapshot) => {
      this.broadcast('download_update', snapshot);

      if (snapshot.status === 'completed' || snapshot.status === 'error') {
        const existingIdx = this.history.findIndex(h => h.id === snapshot.id);
        const item = {
          id: snapshot.id,
          url: snapshot.url,
          filename: snapshot.filename,
          outputPath: snapshot.outputPath,
          contentLength: snapshot.contentLength,
          downloadedBytes: snapshot.downloadedBytes,
          supportsRanges: snapshot.supportsRanges ?? null,
          fallbackReason: snapshot.fallbackReason || null,
          status: snapshot.status,
          error: snapshot.error || null,
          headers: task.customHeaders || null,
          completedAt: new Date().toISOString()
        };
        if (existingIdx >= 0) {
          this.history[existingIdx] = item;
        } else {
          this.history.unshift(item);
        }
        this.history = this.history.slice(0, 50);
        this.downloads.delete(snapshot.id);
        this.saveHistory();
      }
    });

    task.start();
    return task;
  }

  isInterfaceEnabled(address) {
    return !this.disabledInterfaces.has(address);
  }

  getDownload(id) {
    return this.downloads.get(id);
  }

  getAllActive() {
    return Array.from(this.downloads.values()).map(d => d.getSnapshot());
  }

  getHistory() {
    return this.history.map(item => {
      let fileExists = null;
      if (item.status === 'completed' && item.outputPath) {
        try {
          fileExists = fs.existsSync(item.outputPath) && fs.statSync(item.outputPath).isFile();
        } catch {
          fileExists = false;
        }

        // If not found at recorded outputPath, auto-check standard categories and Downloads folder
        if (!fileExists && item.filename) {
          const searchDirs = [
            path.join(os.homedir(), 'Downloads', 'TurboDownloadManager', 'Video'),
            path.join(os.homedir(), 'Downloads', 'TurboDownloadManager', 'General'),
            path.join(os.homedir(), 'Downloads', 'TurboDownloadManager', 'Programs'),
            path.join(os.homedir(), 'Downloads', 'TurboDownloadManager', 'Compressed'),
            path.join(os.homedir(), 'Downloads', 'TurboDownloadManager', 'Documents'),
            path.join(os.homedir(), 'Downloads', 'TurboDownloadManager'),
            path.join(os.homedir(), 'Downloads')
          ];
          for (const dir of searchDirs) {
            const candidate = path.join(dir, item.filename);
            try {
              if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                item.outputPath = candidate;
                fileExists = true;
                break;
              }
            } catch {}
          }
        }
      }
      return { ...item, ...(fileExists !== null ? { fileExists } : {}) };
    });
  }

  removeHistoryItem(id) {
    const index = this.history.findIndex(item => String(item.id) === String(id));
    if (index < 0) return false;
    this.history.splice(index, 1);
    this.saveHistory();
    return true;
  }

  getHistoryItem(id) {
    return this.history.find(item => String(item.id) === String(id)) || null;
  }

  pause(id) {
    const d = this.downloads.get(id);
    if (d) d.pause();
  }

  resume(id) {
    const d = this.downloads.get(id);
    if (d) d.resume();
  }

  cancel(id) {
    const d = this.downloads.get(id);
    if (d) {
      d.cancel();
      this.downloads.delete(id);
    }
  }

  toggleInterface(id, address, enabled) {
    const d = this.downloads.get(id);
    if (d) {
      if (enabled) {
        d.resumeInterface(address);
      } else {
        d.pauseInterface(address);
      }
    }
  }

  toggleGlobalInterface(address, enabled) {
    if (enabled) this.disabledInterfaces.delete(address);
    else this.disabledInterfaces.add(address);

    for (const d of this.downloads.values()) {
      if (enabled) {
        d.resumeInterface(address);
      } else {
        d.pauseInterface(address);
      }
    }
  }
}

export const downloadManager = new DownloadManager();
