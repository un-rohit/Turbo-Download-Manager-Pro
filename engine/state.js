import fs from 'node:fs';
import path from 'node:path';
import { MultiInterfaceDownload } from './downloader.js';

class DownloadManager {
  constructor() {
    this.downloads = new Map();
    this.historyFile = path.join(process.cwd(), 'downloads-history.json');
    this.history = this.loadHistory();
    this.globalListeners = new Set();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
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
          status: snapshot.status,
          completedAt: new Date().toISOString()
        };
        if (existingIdx >= 0) {
          this.history[existingIdx] = item;
        } else {
          this.history.unshift(item);
        }
        this.saveHistory();
      }
    });

    task.start();
    return task;
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
}

export const downloadManager = new DownloadManager();
