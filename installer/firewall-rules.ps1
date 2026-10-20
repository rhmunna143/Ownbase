# Requires Administrative Privileges
$ErrorActionPreference = "SilentlyContinue"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Ownbase Inbound Firewall Configuration (D3)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Administrative privileges required to modify firewall rules. Please run as Administrator."
    exit 1
}

# 1. Clean up legacy or dangerous port exposure rules (3001, 5432, 8080, 9000, 11434)
Write-Host "[1/2] Removing legacy internal service exposure firewall rules..." -ForegroundColor Yellow
$legacyRuleNames = @(
    "Ownbase-Internal-3001",
    "Ownbase-PostgreSQL-5432",
    "Ownbase-FileBrowser-8080",
    "Ownbase-MinIO-9000",
    "Ownbase-Ollama-11434"
)
foreach ($rule in $legacyRuleNames) {
    Remove-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue
}

# 2. Add strictly inbound 80 (HTTP) and 443 (HTTPS) rules for Caddy Edge Proxy on Private network profile
Write-Host "[2/2] Adding inbound 80/443 rules for Caddy Edge Reverse Proxy (Private Profile)..." -ForegroundColor Yellow

# HTTP Port 80
Remove-NetFirewallRule -Name "Ownbase-Caddy-HTTP-80" -ErrorAction SilentlyContinue
New-NetFirewallRule -Name "Ownbase-Caddy-HTTP-80" `
    -DisplayName "Ownbase Reverse Proxy (HTTP Port 80)" `
    -Description "Allows inbound HTTP traffic to Ownbase Caddy reverse proxy on Private networks" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 80 `
    -Action Allow `
    -Profile Private | Out-Null

# HTTPS Port 443
Remove-NetFirewallRule -Name "Ownbase-Caddy-HTTPS-443" -ErrorAction SilentlyContinue
New-NetFirewallRule -Name "Ownbase-Caddy-HTTPS-443" `
    -DisplayName "Ownbase Reverse Proxy (HTTPS Port 443)" `
    -Description "Allows inbound HTTPS traffic to Ownbase Caddy reverse proxy on Private networks" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 443 `
    -Action Allow `
    -Profile Private | Out-Null

Write-Host "Inbound firewall successfully hardened: Only ports 80 and 443 permitted (Private profile)." -ForegroundColor Green
