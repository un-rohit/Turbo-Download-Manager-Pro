[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Turbo Download Manager Pro - Windows Installer       " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$repo = "un-rohit/Turbo-Download-Manager-Pro"
$fallbackTag = "v1.0.0"
$resolvedTag = $fallbackTag

try {
    Write-Host "[1/3] Resolving latest official release from GitHub..." -ForegroundColor Gray
    $apiUrl = "https://api.github.com/repos/$repo/releases/latest"
    $headers = @{ "User-Agent" = "TurboDownloadManager-Installer" }
    $latestRelease = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    if ($latestRelease -and $latestRelease.tag_name) {
        $resolvedTag = $latestRelease.tag_name
        Write-Host "      Detected latest release: $resolvedTag" -ForegroundColor Green
    }
} catch {
    Write-Host "      Using default stable release: $resolvedTag" -ForegroundColor Gray
}

$installerFileName = "Turbo-Download-Manager-Setup.exe"
$releaseUrl = "https://github.com/$repo/releases/download/$resolvedTag/$installerFileName"
$installerPath = Join-Path $env:TEMP $installerFileName

Write-Host "[2/3] Downloading $installerFileName ($resolvedTag)..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri $releaseUrl -OutFile $installerPath -UseBasicParsing
} catch {
    if ($resolvedTag -ne $fallbackTag) {
        Write-Host "      Retrying with fallback release $fallbackTag..." -ForegroundColor Yellow
        $fallbackUrl = "https://github.com/$repo/releases/download/$fallbackTag/$installerFileName"
        Invoke-WebRequest -Uri $fallbackUrl -OutFile $installerPath -UseBasicParsing
    } else {
        throw $_
    }
}

Write-Host "[3/3] Launching Turbo Download Manager installer..." -ForegroundColor Green
Start-Process -FilePath $installerPath
Write-Host ""
Write-Host "Setup launched! Follow the on-screen installer instructions." -ForegroundColor Green

