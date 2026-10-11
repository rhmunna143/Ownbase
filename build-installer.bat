@echo off
setlocal enabledelayedexpansion
title Native Windows Server Hub - Build Setup Installer EXE

echo ======================================================================
echo    NATIVE WINDOWS SERVER HUB - INSTALLER (.EXE) BUILD SCRIPT
echo    Target: Windows x64 NSIS Setup Wizard Installer
echo    Desktop Shortcuts / Start Menu / Program Files Integration
echo ======================================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH. Please install Node.js v18+.
    pause
    exit /b 1
)

:: Check NPM
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not found in PATH.
    pause
    exit /b 1
)

echo [1/3] Building Next.js Web Dashboard (Static Export)...
call npm run build:next
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Next.js build failed. Aborting.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Compiling Electron Main Process (TypeScript)...
call npm run build:electron
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Electron TypeScript compilation failed. Aborting.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Packaging NSIS Setup Wizard .exe via electron-builder...
call npx electron-builder --win nsis:x64
if %ERRORLEVEL% neq 0 (
    echo [ERROR] electron-builder packaging failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ======================================================================
echo  [SUCCESS] Installable Windows Setup EXE built successfully!
echo.
echo  Artifact Location:
echo  dist\release\Native Windows Server Hub-Setup-0.1.0.exe
echo ======================================================================
echo.

pause
