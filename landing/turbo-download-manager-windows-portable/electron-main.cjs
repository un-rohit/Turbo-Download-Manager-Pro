const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Set application branding name
app.name = 'TDM';
if (typeof app.setName === 'function') {
  app.setName('TDM');
}

// Register turbodownload:// custom URL protocol so browser extension can auto-launch the desktop app
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('turbodownload', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('turbodownload');
}

// Single instance lock to prevent duplicate processes and EADDRINUSE crashes
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance of Turbo Download Manager is already running; quit duplicate immediately
  app.quit();
} else {
  let mainWindow = null;
  let tray = null;
  const SERVER_URL = 'http://127.0.0.1:4820';

  app.on('second-instance', (event, commandLine) => {
    // When user launches a second instance or protocol wake-up (turbodownload://open), focus existing window!
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  async function startServer() {
    try {
      try {
        process.chdir(__dirname);
      } catch {}
      await import('./server.js');
      console.log('[Turbo Download Manager] Embedded backend server started successfully');
    } catch (err) {
      console.warn('[Turbo Download Manager] Server startup notice:', err.message);
    }
  }

  function createWindow() {
    const icoPath = path.join(__dirname, 'app.ico');
    const pngPath = path.join(__dirname, 'extension', 'icons', 'icon128.png');
    const iconPath = fs.existsSync(icoPath) ? icoPath : pngPath;

    mainWindow = new BrowserWindow({
      width: 1300,
      height: 860,
      minWidth: 420,
      minHeight: 480,
      title: 'Turbo Download Manager — Multi-Interface Accelerator',
      icon: iconPath,
      backgroundColor: '#060911',
      show: true,
      center: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    mainWindow.loadURL(SERVER_URL);

    mainWindow.webContents.on('did-fail-load', () => {
      // Retry loading if server was still binding
      setTimeout(() => {
        mainWindow.loadURL(SERVER_URL);
      }, 500);
    });

    mainWindow.on('ready-to-show', () => {
      mainWindow.show();
      mainWindow.focus();
    });

    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
      return false;
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  function createTray() {
    try {
      const icoPath = path.join(__dirname, 'app.ico');
      const pngPath = path.join(__dirname, 'extension', 'icons', 'icon16.png');
      const iconPath = fs.existsSync(icoPath) ? icoPath : pngPath;
      const trayIcon = nativeImage.createFromPath(iconPath);
      tray = new Tray(trayIcon);

      const contextMenu = Menu.buildFromTemplate([
        {
          label: '⚡ Open Turbo Download Manager',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Open Downloads Folder',
          click: () => {
            shell.openPath(app.getPath('downloads'));
          }
        },
        { type: 'separator' },
        {
          label: 'Exit Turbo Download Manager',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]);

      tray.setToolTip('Turbo Download Manager — Multi-Interface Turbo Downloader');
      tray.setContextMenu(contextMenu);

      tray.on('double-click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    } catch (err) {
      console.error('Tray creation error:', err);
    }
  }

  app.whenReady().then(async () => {
    await startServer();
    createWindow();
    createTray();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
  });
}
