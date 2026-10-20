# Requires Administrative Privileges
$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Ownbase Windows Service Uninstallation" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Administrative privileges required. Please execute this script in an elevated PowerShell session."
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$winSwExe = Join-Path $scriptDir "ownbase-service.exe"

# Stop service if running
Write-Host "[1/2] Stopping Ownbase service..." -ForegroundColor Yellow
$service = Get-Service -Name "ownbase" -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
    Stop-Service -Name "ownbase" -Force
}

# Remove service registration
Write-Host "[2/2] Removing service registration..." -ForegroundColor Yellow
if (Test-Path $winSwExe) {
    & $winSwExe uninstall
} else {
    sc.exe delete ownbase
}

Write-Host "`nOwnbase service cleanly removed." -ForegroundColor Green
Write-Host "Note: Data files in %ProgramData%\Ownbase have been preserved for data safety." -ForegroundColor Gray
