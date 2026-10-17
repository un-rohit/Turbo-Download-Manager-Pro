# Turbo Download Manager Pro ⚡

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-cyan.svg)](https://github.com/un-rohit/Turbo-Download-Manager-Pro)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B%20(Pure%20Stdlib)-green.svg)](https://nodejs.org)
[![Manifest V3](https://img.shields.io/badge/Extension-Chrome%20%7C%20Edge%20%7C%20Brave-amber.svg)](https://github.com/un-rohit/Turbo-Download-Manager-Pro)

**Turbo Download Manager Pro** is a next-generation open-source download accelerator that multiplies download speeds by concurrently bonding all physical network adapters on your computer (**Wi-Fi, 5G Phone USB Tethering, Ethernet LAN, and Bluetooth**) into a unified high-speed stream.

It features complete **100% IDM (Internet Download Manager) compatibility**, a real-time **Quantum Electricity Flow Visualizer**, a built-in **10-Second Sustained Speed Benchmark**, and a lightweight **Manifest V3 Browser Extension** with automatic floating video grabbing.

---

## ⚡ Key Highlights

- **Multi-NIC Hardware Bonding**: Binds low-level download sockets directly to specific physical network interfaces via Windows IP routing. Downloads stream across Wi-Fi + USB 5G tethering + Ethernet simultaneously.
- **Dynamic 32-Stream Segmentation**: Slices files into micro-byte ranges. Faster connections automatically claim pending ranges if another adapter encounters latency.
- **Real-Time Electricity Flow Visualizer**: 60 FPS GPU-accelerated canvas visualizer rendering packets streaming like electric conduits from each network interface into your storage drive.
- **10-Second Sustained Speed Tester**: Real-time CDN benchmarking tool measuring throughput and latency for individual adapters or all bonded interfaces combined.
- **100% IDM Settings Parity**: Drop-in replacement for IDM options—automatic category folder sorting (*General, Compressed, Documents, Music, Programs, Video*), proxy/socks configuration, retry limits, and exceptions.
- **Browser Video Sniffer Extension**: One-click download button automatically overlays web video streams (YouTube, Vimeo, WebM, MP4, HLS/m3u8) and routes downloads straight to the engine.

---

## 📥 Downloads

| Package | Format | Compatibility | Direct Download |
| :--- | :--- | :--- | :--- |
| **Windows Desktop App** | Portable ZIP (54 KB) | Windows 10 & 11 (x64) | [Download App (.zip)](landing/turbo-download-manager-windows-portable.zip) |
| **Browser Extension** | Unpacked ZIP (12 KB) | Chrome, Edge, Brave, Opera | [Download Extension (.zip)](landing/turbo-download-manager-extension.zip) |
| **Executable Releases** | Standalone .exe / Installer | Windows x64 | [GitHub Releases](https://github.com/un-rohit/Turbo-Download-Manager-Pro/releases) |

---

## 🚀 Quick Start Guide

### Running the Desktop App

#### Method 1: Instant Run (No Installation)
1. Download [turbo-download-manager-windows-portable.zip](landing/turbo-download-manager-windows-portable.zip).
2. Extract the archive to any folder on your computer.
3. Double-click `launch.bat`.
4. Turbo Download Manager will start its bonding engine and launch the desktop dashboard automatically.

#### Method 2: From Source / Node.js
```bash
# 1. Clone the repository
git clone https://github.com/un-rohit/Turbo-Download-Manager-Pro.git
cd Turbo-Download-Manager-Pro

# 2. Launch the bonding server and desktop UI
npm start

# 3. Or launch native Electron window
npm run electron
```

---

## 🧩 Browser Extension Setup (15 Seconds)

The Turbo Download Manager extension integrates seamlessly with Google Chrome, Microsoft Edge, Brave, and other Chromium browsers.

### Installation Steps:
1. Download [turbo-download-manager-extension.zip](landing/turbo-download-manager-extension.zip) and extract it to a folder.
2. In your browser, navigate to:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. In the top-left corner, click **Load unpacked** and select the extracted `extension` directory.
5. The Turbo Download Manager icon will appear in your toolbar (turning green when connected to the local engine).

### Extension Features:
- **Floating Video Grabber**: When streaming videos online, a discrete `⚡ Download with Turbo` button appears over the video player for 1-click capture.
- **Automatic Interception**: Clicking standard download links (.zip, .exe, .iso, .mp4, etc.) routes them into Turbo Manager for channel-bonded acceleration.
- **Right-Click Context Menu**: Right-click any web link or media asset and choose `⚡ Download with Turbo Download Manager`.
- **Live Toolbar Popup**: View current bonded speeds, pause/resume active tasks, and jump directly to the dashboard.

---

## 🌐 Landing Page

This repository includes a dark cyber-themed landing page featuring:
- Live Interactive Channel Bonding Simulator (toggle Wi-Fi 6, 5G USB, and LAN speeds)
- Interactive Bandwidth Savings Calculator (calculate time saved for 5GB, 10GB, 50GB downloads)
- 15-second extension install guide and direct download links

To view the landing page locally, start the app and navigate to:
`http://127.0.0.1:4820/landing`

---

## 📂 Project Architecture

```
Turbo-Download-Manager-Pro/
├── bin/
│   └── app.js                       # CLI and app launcher
├── engine/
│   ├── downloader.js                # Multi-adapter segmented streaming engine
│   ├── network.js                   # Network interface probe and routing
│   ├── speedtest.js                 # 10-second sustained CDN speed benchmark
│   └── state.js                     # Centralized download state and persistence
├── extension/
│   ├── manifest.json                # Chrome/Edge Manifest V3 definition
│   ├── background.js                # Interception and local API connector
│   ├── content.js                   # Floating video sniffer and DOM overlay
│   ├── popup.html / popup.js        # Extension toolbar popup
│   └── icons/                       # Extension iconography
├── landing/
│   ├── index.html                   # Cyber dark landing page
│   ├── style.css                    # Responsive dark-theme styling
│   ├── app.js                       # Flow canvas simulator & speed calculator
│   ├── turbo-download-manager-extension.zip
│   └── turbo-download-manager-windows-portable.zip
├── public/
│   ├── index.html                   # Turbo Download Manager Dashboard
│   ├── style.css                    # IDM-styled cyber HUD interface
│   └── app.js                       # Dashboard logic, settings modal, visualizer
├── launch.bat                       # 1-click Windows desktop launcher
├── server.js                        # Pure Node.js HTTP/SSE server and download routes
├── electron-main.cjs                # Electron desktop wrapper
└── package.json
```

---

## 🔒 Privacy & Performance

- **Zero Telemetry**: No trackers, analytics, or third-party tracking scripts.
- **Pure Node.js Standard Library**: Zero external npm runtime dependencies required for the core bonding engine.
- **Local Host Architecture**: All traffic and settings reside 100% locally on your machine at `127.0.0.1:4820`.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
