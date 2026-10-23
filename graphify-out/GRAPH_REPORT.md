# Graph Report - REA  (2026-10-24)

## Corpus Check
- 51 files · ~88,808 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 19 file(s) not represented in the graph (top: .css 9, (none) 3, .zip 2)

## Summary
- 707 nodes · 1206 edges · 36 communities (32 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b0fb6ecf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- electron-main.cjs
- public/app.js
- manifest.json
- turbo-download-manager-windows-portable/public/app.js
- Turbo Download Manager Pro ⚡
- package.json
- MultiInterfaceDownload
- initHeroVisualizer
- extension/yt-helper.js
- Turbo Download Manager — Chrome / Edge Integration Extension
- background.js
- extension/popup.js
- AGENTS.md
- extension/content.js
- GEMINI.md
- copilot-instructions.md
- vercel.json
- extension/generate-icons.js
- MultiInterfaceDownload
- turbo-download-manager-extension/manifest.json
- turbo-download-manager-windows-portable/extension/manifest.json
- turbo-download-manager-windows-portable/package.json
- server.js
- Turbo Download Manager Pro ⚡
- turbo-download-manager-extension/background.js
- turbo-download-manager-windows-portable/extension/background.js
- Turbo Download Manager — Chrome / Edge Integration Extension
- Turbo Download Manager — Chrome / Edge Integration Extension
- turbo-download-manager-extension/popup.js
- turbo-download-manager-windows-portable/extension/popup.js
- turbo-download-manager-extension/content.js
- turbo-download-manager-windows-portable/extension/content.js
- turbo-download-manager-extension/yt-helper.js
- turbo-download-manager-windows-portable/extension/yt-helper.js
- turbo-download-manager-windows-portable/server.js

## God Nodes (most connected - your core abstractions)
1. `MultiInterfaceDownload` - 22 edges
2. `MultiInterfaceDownload` - 22 edges
3. `downloadManager` - 20 edges
4. `downloadManager` - 20 edges
5. `QuantumEnergyFlowCanvas` - 16 edges
6. `handleRequest()` - 16 edges
7. `QuantumEnergyFlowCanvas` - 16 edges
8. `handleRequest()` - 16 edges
9. `renderDropdownItems()` - 9 edges
10. `renderDropdownItems()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `handleRequest()` --calls--> `probeUrl()`  [EXTRACTED]
  server.js → engine/downloader.js
- `getVerifiedNetworkInterfaces()` --calls--> `getNetworkInterfaces()`  [EXTRACTED]
  server.js → engine/network.js
- `handleRequest()` --calls--> `getNetworkInterfaces()`  [EXTRACTED]
  server.js → engine/network.js
- `handleRequest()` --calls--> `runAdapterSpeedTest()`  [EXTRACTED]
  server.js → engine/speedtest.js
- `handleRequest()` --calls--> `extractYouTubeVideoId()`  [EXTRACTED]
  server.js → engine/yt-resolver.js

## Import Cycles
- None detected.

## Communities (36 total, 4 thin omitted)

### Community 0 - "electron-main.cjs"
Cohesion: 0.12
Nodes (10): { app, BrowserWindow, Tray, Menu, nativeImage, shell }, fs, gotTheLock, path, startServer(), { app, BrowserWindow, Tray, Menu, nativeImage, shell }, fs, gotTheLock (+2 more)

### Community 1 - "public/app.js"
Cohesion: 0.06
Nodes (46): acceptNewDownload(), activeDownloads, appAlert(), appConfirm(), appDialogQueue, applySpeedTestResult(), appPrompt(), closeDownloadMenus() (+38 more)

### Community 2 - "manifest.json"
Cohesion: 0.10
Nodes (20): action, default_icon, default_popup, background, service_worker, content_scripts, 128, 16 (+12 more)

### Community 3 - "turbo-download-manager-windows-portable/public/app.js"
Cohesion: 0.06
Nodes (46): acceptNewDownload(), activeDownloads, appAlert(), appConfirm(), appDialogQueue, applySpeedTestResult(), appPrompt(), closeDownloadMenus() (+38 more)

### Community 4 - "Turbo Download Manager Pro ⚡"
Cohesion: 0.13
Nodes (14): 🧩 Browser Extension Setup (15 Seconds), 📥 Downloads, Extension Features:, Installation Steps:, ⚡ Key Highlights, 🌐 Landing Page, 📄 License, Method 1: Instant Run (No Installation) (+6 more)

### Community 6 - "package.json"
Cohesion: 0.10
Nodes (20): author, description, devDependencies, electron, @electron/packager, electron, @electron/packager, keywords (+12 more)

### Community 7 - "MultiInterfaceDownload"
Cohesion: 0.09
Nodes (9): formatByteCount(), getRequestHeaders(), MultiInterfaceDownload, probeUrl(), requestChunk(), requestWithRedirects(), sanitizeFilename(), downloadManager (+1 more)

### Community 8 - "initHeroVisualizer"
Cohesion: 0.29
Nodes (4): initHeroVisualizer(), initSpeedCalculator(), formatTime(), update()

### Community 9 - "extension/yt-helper.js"
Cohesion: 0.40
Nodes (9): cleanTitle(), extractFormats(), formatBytes(), getCurrentVideoId(), getCurrentVideoTitle(), getPlayerResponse(), handleVideoSwitch(), notifyFormats() (+1 more)

### Community 10 - "Turbo Download Manager — Chrome / Edge Integration Extension"
Cohesion: 0.50
Nodes (3): How to Install into Chrome / Edge (Takes 15 Seconds), Turbo Download Manager — Chrome / Edge Integration Extension, Verify Connection

### Community 11 - "background.js"
Cohesion: 0.22
Nodes (10): ensureDesktopAppRunning(), formatByteCount(), getQualityLabelFromItag(), mediaHeadersCache, pingDesktopServer(), readJsonResponse(), registerMediaStream(), sendToTurboDownloader() (+2 more)

### Community 12 - "extension/popup.js"
Cohesion: 0.31
Nodes (7): busyDownloadActions, checkServerStatus(), downloadState, escapeHtml(), formatBytes(), formatSpeed(), renderDownloads()

### Community 14 - "extension/content.js"
Cohesion: 0.19
Nodes (24): addGenericMediaStream(), askWhereToDownload(), cleanPageTitle(), cleanTitle(), clearStreamsForNewVideo(), closeDropdown(), ensureDropdown(), ensureGrabber() (+16 more)

### Community 17 - "vercel.json"
Cohesion: 0.50
Nodes (3): builds, routes, version

### Community 19 - "extension/generate-icons.js"
Cohesion: 0.14
Nodes (15): crc32(), crcTable, createPNG(), iconsDir, makeChunk(), crc32(), crcTable, createPNG() (+7 more)

### Community 20 - "MultiInterfaceDownload"
Cohesion: 0.09
Nodes (9): formatByteCount(), getRequestHeaders(), MultiInterfaceDownload, probeUrl(), requestChunk(), requestWithRedirects(), sanitizeFilename(), downloadManager (+1 more)

### Community 21 - "turbo-download-manager-extension/manifest.json"
Cohesion: 0.10
Nodes (20): action, default_icon, default_popup, background, service_worker, content_scripts, 128, 16 (+12 more)

### Community 22 - "turbo-download-manager-windows-portable/extension/manifest.json"
Cohesion: 0.10
Nodes (20): action, default_icon, default_popup, background, service_worker, content_scripts, 128, 16 (+12 more)

### Community 23 - "turbo-download-manager-windows-portable/package.json"
Cohesion: 0.10
Nodes (20): author, description, devDependencies, electron, @electron/packager, electron, @electron/packager, keywords (+12 more)

### Community 25 - "server.js"
Cohesion: 0.07
Nodes (39): appDir, projectRoot, server, categorizeInterface(), getNetworkInterfaces(), isVirtualMachineInterface(), testInterfaceConnectivity(), describeSpeedTestError() (+31 more)

### Community 27 - "Turbo Download Manager Pro ⚡"
Cohesion: 0.13
Nodes (14): 🧩 Browser Extension Setup (15 Seconds), 📥 Downloads, Extension Features:, Installation Steps:, ⚡ Key Highlights, 🌐 Landing Page, 📄 License, Method 1: Instant Run (No Installation) (+6 more)

### Community 28 - "turbo-download-manager-extension/background.js"
Cohesion: 0.22
Nodes (10): ensureDesktopAppRunning(), formatByteCount(), getQualityLabelFromItag(), mediaHeadersCache, pingDesktopServer(), readJsonResponse(), registerMediaStream(), sendToTurboDownloader() (+2 more)

### Community 29 - "turbo-download-manager-windows-portable/extension/background.js"
Cohesion: 0.22
Nodes (10): ensureDesktopAppRunning(), formatByteCount(), getQualityLabelFromItag(), mediaHeadersCache, pingDesktopServer(), readJsonResponse(), registerMediaStream(), sendToTurboDownloader() (+2 more)

### Community 30 - "Turbo Download Manager — Chrome / Edge Integration Extension"
Cohesion: 0.50
Nodes (3): How to Install into Chrome / Edge (Takes 15 Seconds), Turbo Download Manager — Chrome / Edge Integration Extension, Verify Connection

### Community 31 - "Turbo Download Manager — Chrome / Edge Integration Extension"
Cohesion: 0.50
Nodes (3): How to Install into Chrome / Edge (Takes 15 Seconds), Turbo Download Manager — Chrome / Edge Integration Extension, Verify Connection

### Community 32 - "turbo-download-manager-extension/popup.js"
Cohesion: 0.31
Nodes (7): busyDownloadActions, checkServerStatus(), downloadState, escapeHtml(), formatBytes(), formatSpeed(), renderDownloads()

### Community 33 - "turbo-download-manager-windows-portable/extension/popup.js"
Cohesion: 0.31
Nodes (7): busyDownloadActions, checkServerStatus(), downloadState, escapeHtml(), formatBytes(), formatSpeed(), renderDownloads()

### Community 34 - "turbo-download-manager-extension/content.js"
Cohesion: 0.19
Nodes (24): addGenericMediaStream(), askWhereToDownload(), cleanPageTitle(), cleanTitle(), clearStreamsForNewVideo(), closeDropdown(), ensureDropdown(), ensureGrabber() (+16 more)

### Community 35 - "turbo-download-manager-windows-portable/extension/content.js"
Cohesion: 0.19
Nodes (24): addGenericMediaStream(), askWhereToDownload(), cleanPageTitle(), cleanTitle(), clearStreamsForNewVideo(), closeDropdown(), ensureDropdown(), ensureGrabber() (+16 more)

### Community 36 - "turbo-download-manager-extension/yt-helper.js"
Cohesion: 0.40
Nodes (9): cleanTitle(), extractFormats(), formatBytes(), getCurrentVideoId(), getCurrentVideoTitle(), getPlayerResponse(), handleVideoSwitch(), notifyFormats() (+1 more)

### Community 37 - "turbo-download-manager-windows-portable/extension/yt-helper.js"
Cohesion: 0.40
Nodes (9): cleanTitle(), extractFormats(), formatBytes(), getCurrentVideoId(), getCurrentVideoTitle(), getPlayerResponse(), handleVideoSwitch(), notifyFormats() (+1 more)

### Community 39 - "turbo-download-manager-windows-portable/server.js"
Cohesion: 0.08
Nodes (35): categorizeInterface(), getNetworkInterfaces(), isVirtualMachineInterface(), testInterfaceConnectivity(), describeSpeedTestError(), runAdapterSpeedTest(), cleanTitle(), execFileAsync (+27 more)

## Knowledge Gaps
- **4 isolated node(s):** `@electron/packager`, `electron`, `@electron/packager`, `electron`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 260 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `downloadManager` connect `MultiInterfaceDownload` to `server.js`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `@electron/packager`, `electron`, `@electron/packager` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `electron-main.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.11695906432748537 - nodes in this community are weakly interconnected._
- **Why does `downloadManager` connect `MultiInterfaceDownload` to `server.js`, `turbo-download-manager-windows-portable/server.js`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Should `public/app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05641025641025641 - nodes in this community are weakly interconnected._
- **Why does `MultiInterfaceDownload` connect `MultiInterfaceDownload` to `server.js`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Should `manifest.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._