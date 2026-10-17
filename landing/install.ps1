$ErrorActionPreference = 'Stop'

$releaseUrl = 'https://github.com/un-rohit/Turbo-Download-Manager-Pro/releases/download/v1.0.0/Turbo-Download-Manager-Setup.exe'
$installerPath = Join-Path $env:TEMP 'Turbo-Download-Manager-Setup.exe'

Write-Host 'Downloading Turbo Download Manager Pro v1.0.0...'
Invoke-WebRequest -Uri $releaseUrl -OutFile $installerPath

Write-Host 'Launching the installer...'
Start-Process -FilePath $installerPath
