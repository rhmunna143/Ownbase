<#
.SYNOPSIS
    Builds both Portable and NSIS Installer executables for Native Windows Server Hub.
.DESCRIPTION
    Runs complete build pipeline and creates both Portable and Installer packages.
#>

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   NATIVE WINDOWS SERVER HUB - COMPLETE BUILD PIPELINE" -ForegroundColor Cyan
Write-Host "   Building: Portable .exe + NSIS Setup Installer .exe (x64)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not found in PATH. Please install Node.js v18+."
    exit 1
}

Write-Host "[1/3] Building Next.js Web Dashboard (Static Export)..." -ForegroundColor Yellow
npm run build:next
if ($LASTEXITCODE -ne 0) {
    Write-Error "Next.js build failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host "`n[2/3] Compiling Electron Main Process (TypeScript)..." -ForegroundColor Yellow
npm run build:electron
if ($LASTEXITCODE -ne 0) {
    Write-Error "Electron compilation failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host "`n[3/3] Packaging Both NSIS Installer & Portable .exe via electron-builder..." -ForegroundColor Yellow
npx electron-builder --win nsis:x64 portable:x64
if ($LASTEXITCODE -ne 0) {
    Write-Error "electron-builder packaging failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host " [SUCCESS] All distribution packages built successfully!" -ForegroundColor Green
Write-Host ""
Write-Host " Output Directory:" -ForegroundColor White
Write-Host "   dist\release\" -ForegroundColor White
Write-Host ""
Write-Host " Artifacts Created:" -ForegroundColor White
Write-Host "   1. Setup Installer : Native Windows Server Hub-Setup-0.1.0.exe" -ForegroundColor Green
Write-Host "   2. Portable Binary : Native Windows Server Hub-Portable-0.1.0.exe" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
