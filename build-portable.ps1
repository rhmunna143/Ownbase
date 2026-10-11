<#
.SYNOPSIS
    Builds the standalone Portable .exe for Native Windows Server Hub.
.DESCRIPTION
    Compiles Next.js static export, compiles Electron TypeScript,
    and packages the standalone portable binary with zero installer overhead.
#>

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   NATIVE WINDOWS SERVER HUB - PORTABLE (.EXE) BUILD SCRIPT" -ForegroundColor Cyan
Write-Host "   Target: Windows x64 Standalone Portable Executable" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Ensure Node and NPM are available
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

Write-Host "`n[3/3] Packaging Standalone Portable .exe via electron-builder..." -ForegroundColor Yellow
npx electron-builder --win portable:x64
if ($LASTEXITCODE -ne 0) {
    Write-Error "electron-builder packaging failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host " [SUCCESS] Portable Windows Executable built successfully!" -ForegroundColor Green
Write-Host ""
Write-Host " Output File:" -ForegroundColor White
Write-Host "   dist\release\Native Windows Server Hub-Portable-0.1.0.exe" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
