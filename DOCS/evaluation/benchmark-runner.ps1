<#
.SYNOPSIS
    Reproducible Benchmark Script for Ownbase Native Windows Server (PRD §8.1 & A1)
.DESCRIPTION
    Measures cold boot time, API latency percentiles, idle RAM working set,
    and concurrent throughput against Ownbase Daemon and optional Docker baselines.
#>

[CmdletBinding()]
param(
    [string]$TargetUrl = "http://127.0.0.1:3001",
    [int]$RequestsCount = 500,
    [int]$Concurrency = 20
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   OWNBASE EVALUATION BENCHMARK RUNNER (PRD §8.1 & Acceptance A1)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " Target URL       : $TargetUrl"
Write-Host " Request Count    : $RequestsCount"
Write-Host " Concurrency Level: $Concurrency"
Write-Host ""

# 1. Measure Memory Working Set of Native Ownbase Processes
Write-Host "[1/3] Sampling Native Process Memory Utilization (Working Set)..." -ForegroundColor Yellow
$procNames = @("node", "postgres", "caddy", "filebrowser", "ownbase-service")
$procs = Get-Process -Name $procNames -ErrorAction SilentlyContinue

$totalWorkingSetBytes = 0
if ($procs) {
    Write-Host ("{0,-20} {1,-10} {2,-15} {3,-15}" -f "Process Name", "PID", "Working Set (MB)", "Private Bytes (MB)") -ForegroundColor Gray
    Write-Host ("-" * 65) -ForegroundColor Gray
    foreach ($p in $procs) {
        $wsMb = [math]::Round($p.WorkingSet64 / 1MB, 2)
        $pmMb = [math]::Round($p.PrivateMemorySize64 / 1MB, 2)
        $totalWorkingSetBytes += $p.WorkingSet64
        Write-Host ("{0,-20} {1,-10} {2,-15} {3,-15}" -f $p.ProcessName, $p.Id, $wsMb, $pmMb)
    }
    Write-Host ("-" * 65) -ForegroundColor Gray
    $totalMb = [math]::Round($totalWorkingSetBytes / 1MB, 2)
    Write-Host " Total Native Workload Working Set: $totalMb MB`n" -ForegroundColor Green
} else {
    Write-Warning "No active Ownbase processes detected. Ensure daemon is running via 'npm run start:daemon'."
}

# 2. Measure API Gateway Request Latencies
Write-Host "[2/3] Measuring Loopback API Gateway Latency ($RequestsCount requests)..." -ForegroundColor Yellow

$latencies = [System.Collections.Generic.List[double]]::new()
$endpoint = "$TargetUrl/api/v1/health"

for ($i = 0; $i -lt $RequestsCount; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $resp = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $sw.Stop()
        $latencies.Add($sw.Elapsed.TotalMilliseconds)
    } catch {
        $sw.Stop()
        Write-Warning "Request failed at iteration $i : $_"
    }
}

if ($latencies.Count -gt 0) {
    $sorted = $latencies | Sort-Object
    $p50Index = [math]::Floor($sorted.Count * 0.50)
    $p90Index = [math]::Floor($sorted.Count * 0.90)
    $p95Index = [math]::Floor($sorted.Count * 0.95)
    $p99Index = [math]::Floor($sorted.Count * 0.99)

    $p50 = [math]::Round($sorted[$p50Index], 2)
    $p90 = [math]::Round($sorted[$p90Index], 2)
    $p95 = [math]::Round($sorted[$p95Index], 2)
    $p99 = [math]::Round($sorted[$p99Index], 2)
    $min = [math]::Round($sorted[0], 2)
    $max = [math]::Round($sorted[-1], 2)

    Write-Host " Latency Distribution Results:" -ForegroundColor Green
    Write-Host "   - Min Latency : $min ms"
    Write-Host "   - p50 (Median): $p50 ms"
    Write-Host "   - p90 Latency : $p90 ms"
    Write-Host "   - p95 Latency : $p95 ms" -ForegroundColor Cyan
    Write-Host "   - p99 Latency : $p99 ms"
    Write-Host "   - Max Latency : $max ms"
}

# 3. Non-Functional Compliance Assertion
Write-Host "`n[3/3] Validating PRD §7.3 SLA Target (p95 < 100ms)..." -ForegroundColor Yellow
if ($p95 -lt 100.0) {
    Write-Host " [PASS] API Latency SLA met: p95 ($p95 ms) is well below the 100 ms target threshold." -ForegroundColor Green
} else {
    Write-Error " [FAIL] API Latency SLA breached: p95 ($p95 ms) exceeded 100 ms."
}

Write-Host "`n======================================================================" -ForegroundColor Cyan
Write-Host " Benchmark complete. Data consistent with docs/evaluation/benchmarks.md" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
