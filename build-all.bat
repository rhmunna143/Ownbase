@echo off
setlocal enabledelayedexpansion
title Native Windows Server Hub - Build All Distribution Packages

echo ======================================================================
echo    NATIVE WINDOWS SERVER HUB - COMPLETE BUILD PIPELINE
echo    Building: Portable .exe + NSIS Installer .exe (x64)
echo ======================================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH.
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
echo [3/3] Packaging Both NSIS Setup + Portable .exe into release\ ...
call npx electron-builder --win nsis:x64 portable:x64
if %ERRORLEVEL% neq 0 (
    echo [ERROR] electron-builder packaging failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ======================================================================
echo  [SUCCESS] All distribution packages built successfully!
echo.
echo  Output Directory:
echo    release\
echo.
echo  Artifacts Created:
echo    1. Setup Installer : Native Windows Server Hub-Setup-0.1.0.exe
echo    2. Portable Binary : Native Windows Server Hub-Portable-0.1.0.exe
echo ======================================================================
echo.

pause
