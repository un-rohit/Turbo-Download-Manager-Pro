import fs from 'node:fs';
import path from 'node:path';
import { MultiInterfaceDownload } from './downloader.js';

class DownloadManager {
  constructor() {
    this.downloads = new Map();
    this.historyFile = path.join(process.cwd(), 'downloads-history.json');
    this.historyNeedsRepair = false;
    this.history = this.loadHistory();
    if (this.historyNeedsRepair) this.saveHistory();
    this.globalListeners = new Set();
    this.disabledInterfaces = new Set();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const saved = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
        if (!Array.isArray(saved)) return [];
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
    } catch {}
    return [];
  }

  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history.slice(0, 50), null, 2), 'utf8');
    } catch {}
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
    return this.history;
  }

  removeHistoryItem(id) {
    const index = this.history.findIndex(item => item.id === id);
    if (index < 0) return false;
    this.history.splice(index, 1);
    this.saveHistory();
    return true;
  }

  getHistoryItem(id) {
    return this.history.find(item => item.id === id) || null;
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
