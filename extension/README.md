# Turbo Download Manager — Chrome / Edge Integration Extension

This extension integrates your browser with the **Turbo Download Manager** desktop application, providing:

- With **Use Turbo for browser downloads** on, supported HTTP/HTTPS downloads go only through Turbo. The page prompt starts Turbo after 3 seconds; choose **Cancel download** to stop it. Unsupported download types are stopped. If Turbo cannot accept a download, the extension reports the error and does not fall back to Chrome/Edge's downloader.
- Turn the toggle off to use your browser's normal save settings. Downloads already in progress in the browser are not changed.
- The extension popup shows active download progress with pause, resume, and cancel controls. Completed downloads include **Open file** and **Open folder** actions.

1. **Automatic Download Interception**: Catches browser downloads and routes them through multi-interface bonded downloading.
2. **Right-Click Context Menu**: Right-click any link, video, or image and select `⚡ Download with Turbo Download Manager`.
3. **On-Hover Media Grabber**: Automatically shows a download button on web videos and audio files.
4. **Live Toolbar HUD**: Displays current download speeds and bonded adapter counts directly in your browser.

---

### How to Install into Chrome / Edge (Takes 15 Seconds)

1. Open your browser and navigate to the extensions page:
   - In **Google Chrome**: type `chrome://extensions` in the address bar.
   - In **Microsoft Edge**: type `edge://extensions` in the address bar.
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. Click the **Load unpacked** button (in top-left).
4. Select this directory:
   ```
   D:\Projects\REA\extension
   ```
5. Click **Select Folder**. The **Turbo Download Manager Integration Module** will now appear in your browser toolbar!

---

### Verify Connection

1. Make sure the Turbo Download Manager app is running (double-click [launch.bat](file:///d:/Projects/REA/launch.bat)).
2. Click the Turbo Download Manager puzzle icon in your browser toolbar:
   - You should see the status indicator turn **`● CONNECTED`** (Emerald green).
   - Any file downloaded from the web will now automatically accelerate through Turbo Download Manager!
