@echo off
title Turbo Download Manager - Multi-Interface Download Accelerator
cd /d "%~dp0"

echo ========================================================
echo   TURBO DOWNLOAD MANAGER - Multi-Interface Accelerator
echo   Bonding Wi-Fi + USB Ethernet + LAN + Bluetooth
echo ========================================================
echo Starting local bonding server...

start msedge --app=http://127.0.0.1:4820 || start http://127.0.0.1:4820

node server.js
pause
