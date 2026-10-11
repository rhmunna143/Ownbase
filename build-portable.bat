@echo off
setlocal enabledelayedexpansion
title Native Windows Server Hub - Build Portable EXE

echo ======================================================================
echo    NATIVE WINDOWS SERVER HUB - PORTABLE (.EXE) BUILD SCRIPT
echo    Target: Windows x64 Standalone Portable Executable
echo    Zero-Installation / Registry-Free / Self-Contained
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
echo [3/3] Packaging Standalone Portable .exe into release\ ...
call npx electron-builder --win portable:x64
if %ERRORLEVEL% neq 0 (
    echo [ERROR] electron-builder packaging failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ======================================================================
echo  [SUCCESS] Portable Windows Executable built successfully!
echo.
echo  Artifact Location:
echo  release\Native Windows Server Hub-Portable-0.1.0.exe
echo ======================================================================
echo.

pause
