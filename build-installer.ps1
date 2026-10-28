<#
.SYNOPSIS
    Builds the NSIS Setup Installer .exe for Native Windows Server Hub.
.DESCRIPTION
    Compiles Next.js static export, compiles Electron TypeScript,
    and packages the Windows NSIS Setup Wizard installer with desktop & start menu shortcuts.
#>

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   NATIVE WINDOWS SERVER HUB - INSTALLER (.EXE) BUILD SCRIPT" -ForegroundColor Cyan
Write-Host "   Target: Windows x64 NSIS Setup Wizard Installer" -ForegroundColor Cyan
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

Write-Host "`n[3/3] Packaging NSIS Setup Wizard .exe into release\ ..." -ForegroundColor Yellow
npx electron-builder --win nsis:x64
if ($LASTEXITCODE -ne 0) {
    Write-Error "electron-builder packaging failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

node scripts/finalize-release.js

$pkg = Get-Content -Raw -Path "package.json" | ConvertFrom-Json
$ver = $pkg.version
$pName = if ($pkg.productName) { $pkg.productName } else { "Ownbase" }

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host " [SUCCESS] Windows Setup Installer built successfully!" -ForegroundColor Green
Write-Host ""
Write-Host " Output File:" -ForegroundColor White
Write-Host "   release\${pName}-Setup-${ver}.exe" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
