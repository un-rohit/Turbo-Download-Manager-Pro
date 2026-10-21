# Graph Report - REA  (2026-10-21)

## Corpus Check
- 46 files · ~60,877 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: .css 9, (none) 3, .zip 2)

## Summary
- 561 nodes · 870 edges · 36 communities (23 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `22554817`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.js
- public/app.js
- manifest.json
- turbo-download-manager-windows-portable/public/app.js
- Turbo Download Manager Pro ⚡
- downloadManager
- package.json
- MultiInterfaceDownload
- initHeroVisualizer
- Turbo Download Manager — Chrome / Edge Integration Extension
- background.js
- extension/popup.js
- AGENTS.md
- extension/content.js
- GEMINI.md
- copilot-instructions.md
- vercel.json
- QuantumEnergyFlowCanvas
- MultiInterfaceDownload
- turbo-download-manager-extension/manifest.json
- turbo-download-manager-windows-portable/extension/manifest.json
- turbo-download-manager-windows-portable/package.json
- downloadManager
- electron-main.cjs
- QuantumEnergyFlowCanvas
- Turbo Download Manager Pro ⚡
- turbo-download-manager-extension/background.js
- turbo-download-manager-windows-portable/extension/background.js
- Turbo Download Manager — Chrome / Edge Integration Extension
- Turbo Download Manager — Chrome / Edge Integration Extension
- turbo-download-manager-extension/popup.js
- turbo-download-manager-windows-portable/extension/popup.js
- turbo-download-manager-extension/content.js
- turbo-download-manager-windows-portable/extension/content.js
- turbo-download-manager-windows-portable/server.js

## God Nodes (most connected - your core abstractions)
1. `MultiInterfaceDownload` - 22 edges
2. `MultiInterfaceDownload` - 22 edges
3. `downloadManager` - 19 edges
4. `downloadManager` - 19 edges
5. `QuantumEnergyFlowCanvas` - 16 edges
6. `QuantumEnergyFlowCanvas` - 16 edges
7. `handleRequest()` - 14 edges
8. `handleRequest()` - 14 edges
9. `Turbo Download Manager Pro ⚡` - 9 edges
10. `Turbo Download Manager Pro ⚡` - 9 edges

## Surprising Connections (you probably didn't know these)
- `handleRequest()` --calls--> `probeUrl()`  [EXTRACTED]
  server.js → engine/downloader.js
- `getVerifiedNetworkInterfaces()` --calls--> `getNetworkInterfaces()`  [EXTRACTED]
  server.js → engine/network.js
- `handleRequest()` --calls--> `getNetworkInterfaces()`  [EXTRACTED]
  server.js → engine/network.js
- `handleRequest()` --calls--> `runAdapterSpeedTest()`  [EXTRACTED]
  server.js → engine/speedtest.js
- `handleRequest()` --calls--> `probeUrl()`  [EXTRACTED]
  landing/turbo-download-manager-windows-portable/server.js → landing/turbo-download-manager-windows-portable/engine/downloader.js

## Import Cycles
- None detected.

## Communities (36 total, 13 thin omitted)

### Community 0 - "server.js"
Cohesion: 0.09
Nodes (27): categorizeInterface(), getNetworkInterfaces(), isVirtualMachineInterface(), testInterfaceConnectivity(), describeSpeedTestError(), runAdapterSpeedTest(), { spawn }, { spawn } (+19 more)

### Community 1 - "public/app.js"
Cohesion: 0.07
Nodes (45): acceptNewDownload(), activeDownloads, appAlert(), appConfirm(), appDialogQueue, applySpeedTestResult(), appPrompt(), closeDownloadMenus() (+37 more)

### Community 2 - "manifest.json"
Cohesion: 0.10
Nodes (19): action, default_icon, default_popup, background, service_worker, content_scripts, 128, 16 (+11 more)

### Community 3 - "turbo-download-manager-windows-portable/public/app.js"
Cohesion: 0.07
Nodes (45): acceptNewDownload(), activeDownloads, appAlert(), appConfirm(), appDialogQueue, applySpeedTestResult(), appPrompt(), closeDownloadMenus() (+37 more)

### Community 4 - "Turbo Download Manager Pro ⚡"
Cohesion: 0.13
Nodes (14): 🧩 Browser Extension Setup (15 Seconds), 📥 Downloads, Extension Features:, Installation Steps:, ⚡ Key Highlights, 🌐 Landing Page, 📄 License, Method 1: Instant Run (No Installation) (+6 more)

### Community 5 - "downloadManager"
Cohesion: 0.05
Nodes (23): appDir, projectRoot, server, downloadManager, resolveHistoryFile(), crc32(), crcTable, createPNG() (+15 more)

### Community 6 - "package.json"
Cohesion: 0.10
Nodes (19): author, description, devDependencies, electron, @electron/packager, electron, @electron/packager, keywords (+11 more)

### Community 7 - "MultiInterfaceDownload"
Cohesion: 0.20
Nodes (6): formatByteCount(), MultiInterfaceDownload, probeUrl(), requestChunk(), requestWithRedirects(), sanitizeFilename()

### Community 8 - "initHeroVisualizer"
Cohesion: 0.29
Nodes (4): initHeroVisualizer(), initSpeedCalculator(), formatTime(), update()

### Community 10 - "Turbo Download Manager — Chrome / Edge Integration Extension"
Cohesion: 0.50
Nodes (3): How to Install into Chrome / Edge (Takes 15 Seconds), Turbo Download Manager — Chrome / Edge Integration Extension, Verify Connection

### Community 12 - "extension/popup.js"
Cohesion: 0.31
Nodes (7): busyDownloadActions, checkServerStatus(), downloadState, escapeHtml(), formatBytes(), formatSpeed(), renderDownloads()

### Community 17 - "vercel.json"
Cohesion: 0.50
Nodes (3): builds, routes, version

### Community 20 - "MultiInterfaceDownload"
Cohesion: 0.20
Nodes (6): formatByteCount(), MultiInterfaceDownload, probeUrl(), requestChunk(), requestWithRedirects(), sanitizeFilename()

### Community 21 - "turbo-download-manager-extension/manifest.json"
Cohesion: 0.10
Nodes (19): action, default_icon, default_popup, background, service_worker, content_scripts, 128, 16 (+11 more)

### Community 22 - "turbo-download-manager-windows-portable/extension/manifest.json"
Cohesion: 0.10
Nodes (19): action, default_icon, default_popup, background, service_worker, content_scripts, 128, 16 (+11 more)

### Community 23 - "turbo-download-manager-windows-portable/package.json"
Cohesion: 0.10
Nodes (19): author, description, devDependencies, electron, @electron/packager, electron, @electron/packager, keywords (+11 more)

### Community 25 - "electron-main.cjs"
Cohesion: 0.12
Nodes (10): { app, BrowserWindow, Tray, Menu, nativeImage, shell }, fs, gotTheLock, path, startServer(), { app, BrowserWindow, Tray, Menu, nativeImage, shell }, fs, gotTheLock (+2 more)

### Community 27 - "Turbo Download Manager Pro ⚡"
Cohesion: 0.13
Nodes (14): 🧩 Browser Extension Setup (15 Seconds), 📥 Downloads, Extension Features:, Installation Steps:, ⚡ Key Highlights, 🌐 Landing Page, 📄 License, Method 1: Instant Run (No Installation) (+6 more)

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

### Community 36 - "turbo-download-manager-windows-portable/server.js"
Cohesion: 0.11
Nodes (25): categorizeInterface(), getNetworkInterfaces(), isVirtualMachineInterface(), testInterfaceConnectivity(), describeSpeedTestError(), runAdapterSpeedTest(), broadcastSSE(), __dirname (+17 more)

## Knowledge Gaps
- **4 isolated node(s):** `@electron/packager`, `electron`, `@electron/packager`, `electron`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 245 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `downloadManager` connect `downloadManager` to `server.js`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `@electron/packager`, `electron`, `@electron/packager` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09243697478991597 - nodes in this community are weakly interconnected._
- **Why does `downloadManager` connect `downloadManager` to `turbo-download-manager-windows-portable/server.js`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Should `public/app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06901960784313725 - nodes in this community are weakly interconnected._
- **Why does `MultiInterfaceDownload` connect `MultiInterfaceDownload` to `downloadManager`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Should `manifest.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._