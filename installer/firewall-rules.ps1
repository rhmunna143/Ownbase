# Requires Administrative Privileges
$ErrorActionPreference = "SilentlyContinue"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Ownbase Inbound Firewall Configuration" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Administrative privileges required to modify firewall rules. Please run as Administrator."
    exit 1
}

# 1. Clean up legacy or internal service exposure firewall rules
Write-Host "[1/3] Cleaning up obsolete internal firewall rules..." -ForegroundColor Yellow
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

# 2. Add inbound 80 (HTTP) and 443 (HTTPS) rules across All profiles (including Tailscale & LAN)
Write-Host "[2/3] Adding inbound 80/443 rules for Caddy Edge Reverse Proxy..." -ForegroundColor Yellow

# HTTP Port 80 (Allowed on Private profile & Tailscale)
Remove-NetFirewallRule -Name "Ownbase-Caddy-HTTP-80" -ErrorAction SilentlyContinue
New-NetFirewallRule -Name "Ownbase-Caddy-HTTP-80" `
    -DisplayName "Ownbase Reverse Proxy (HTTP Port 80)" `
    -Description "Allows inbound HTTP traffic to Ownbase Caddy reverse proxy across -Profile Private and Tailscale interfaces" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 80 `
    -Action Allow `
    -Profile Any | Out-Null

# HTTPS Port 443 (Allowed on Private profile & Tailscale)
Remove-NetFirewallRule -Name "Ownbase-Caddy-HTTPS-443" -ErrorAction SilentlyContinue
New-NetFirewallRule -Name "Ownbase-Caddy-HTTPS-443" `
    -DisplayName "Ownbase Reverse Proxy (HTTPS Port 443)" `
    -Description "Allows inbound HTTPS traffic to Ownbase Caddy reverse proxy across -Profile Private and Tailscale interfaces" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 443 `
    -Action Allow `
    -Profile Any | Out-Null

# 3. Add explicit Tailscale CGNAT subnet (100.64.0.0/10) remote access rules
Write-Host "[3/3] Configuring Tailscale WireGuard mesh VPN inbound rule (100.64.0.0/10)..." -ForegroundColor Yellow
Remove-NetFirewallRule -Name "Ownbase-Tailscale-Inbound" -ErrorAction SilentlyContinue
New-NetFirewallRule -Name "Ownbase-Tailscale-Inbound" `
    -DisplayName "Ownbase Tailscale Remote Access (All Web Ports)" `
    -Description "Allows inbound HTTP/HTTPS/Daemon traffic from Tailscale mobile and remote devices (100.64.0.0/10)" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 80, 443, 3000, 3001, 8080 `
    -RemoteAddress 100.64.0.0/10 `
    -Action Allow `
    -Profile Any | Out-Null

Write-Host "Inbound firewall successfully configured: Ports 80 & 443 open for web traffic, Tailscale mesh subnet permitted." -ForegroundColor Green
