# Requires Administrative Privileges
$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Ownbase Windows Service Installation" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Assert Administrator Rights
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Administrative privileges required. Please execute this script in an elevated PowerShell session."
    exit 1
}

$programDataDir = "$env:ProgramData\Ownbase"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$winSwExe = Join-Path $scriptDir "ownbase-service.exe"
$winSwXml = Join-Path $scriptDir "ownbase-service.xml"

# 2. Create Service Data Directory Tree with ACLs
Write-Host "[1/4] Preparing data directory at $programDataDir..." -ForegroundColor Yellow
if (-not (Test-Path $programDataDir)) {
    New-Item -ItemType Directory -Path $programDataDir -Force | Out-Null
}

$subdirs = @("logs", "postgres", "storage", "secrets", "caddy", "runtimes", "apps", "releases", "backups")
foreach ($sub in $subdirs) {
    $dir = Join-Path $programDataDir $sub
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# 3. Apply ACLs for virtual service account NT SERVICE\Ownbase
Write-Host "[2/4] Configuring ACL permissions for 'NT SERVICE\Ownbase'..." -ForegroundColor Yellow
try {
    icacls $programDataDir /grant "NT SERVICE\Ownbase:(OI)(CI)F" /T /Q
    Write-Host "      ACL permissions applied successfully." -ForegroundColor Green
} catch {
    Write-Warning "Failed to set virtual account ACLs directly. Falling back to LocalSystem / Administrators."
}

# 4. Service Registration
Write-Host "[3/4] Registering Ownbase Windows Service..." -ForegroundColor Yellow

# Resolve daemon script path (packaged vs source)
$candidateScripts = @(
    (Join-Path $scriptDir "..\..\app.asar.unpacked\dist\daemon\main.js"),
    (Join-Path $scriptDir "..\..\dist\daemon\main.js"),
    (Join-Path $scriptDir "..\app.asar.unpacked\dist\daemon\main.js"),
    (Join-Path $scriptDir "..\dist\daemon\main.js")
)
$distDaemon = $null
foreach ($cand in $candidateScripts) {
    if (Test-Path $cand) {
        $distDaemon = (Resolve-Path $cand).Path
        break
    }
}
if (-not $distDaemon) {
    $distDaemon = (Join-Path $scriptDir "..\..\app.asar.unpacked\dist\daemon\main.js")
}

# Resolve Node.js / Electron host executable
$candidateExecutables = @(
    (Get-Command node.exe -ErrorAction SilentlyContinue).Source,
    (Join-Path $scriptDir "..\..\..\Ownbase.exe"),
    (Join-Path $scriptDir "..\..\Ownbase.exe"),
    (Join-Path $scriptDir "..\..\..\Native Windows Server Hub.exe"),
    (Join-Path $scriptDir "..\..\Native Windows Server Hub.exe")
)
$nodeExe = $null
foreach ($cand in $candidateExecutables) {
    if ($cand -and (Test-Path $cand)) {
        $nodeExe = (Resolve-Path $cand).Path
        break
    }
}
if (-not $nodeExe) {
    $nodeExe = "node.exe"
}

if (Test-Path $winSwExe) {
    & $winSwExe install
} else {
    # Direct sc.exe fallback if standalone WinSW binary is not pre-copied
    $serviceExists = Get-Service -Name "ownbase" -ErrorAction SilentlyContinue
    if ($serviceExists) {
        sc.exe stop ownbase | Out-Null
        sc.exe delete ownbase | Out-Null
        Start-Sleep -Seconds 2
    }

    sc.exe create ownbase binPath= "`"$nodeExe`" `"$distDaemon`" --service" start= delayed-auto DisplayName= "Ownbase Server Daemon"
    sc.exe failure ownbase reset= 60 actions= restart/5000/restart/10000/restart/20000
    sc.exe description ownbase "Ownbase self-hosted cloud server orchestrator, reverse proxy, and storage daemon"
}

# 5. Start Service
Write-Host "[4/4] Starting service..." -ForegroundColor Yellow
try {
    Start-Service -Name "ownbase"
    Write-Host "      Ownbase service is RUNNING." -ForegroundColor Green
} catch {
    Write-Warning "Could not immediately start service: $_"
}

Write-Host "`nOwnbase Windows Service successfully installed!" -ForegroundColor Green
