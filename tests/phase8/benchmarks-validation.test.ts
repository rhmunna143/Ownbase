import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 8 - Item 8.1 & 8.2: Benchmark Dataset & Evaluation Evidence (PRD §8.1 & Acceptance A1)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const benchmarkDoc = path.join(rootDir, 'docs', 'evaluation', 'benchmarks.md');
  const benchmarkScript = path.join(rootDir, 'docs', 'evaluation', 'benchmark-runner.ps1');
  const securityMatrix = path.join(rootDir, 'docs', 'evaluation', 'security-isolation-matrix.md');
  const usabilityReport = path.join(rootDir, 'docs', 'evaluation', 'usability-report.md');
  const finalReport = path.join(rootDir, 'docs', 'evaluation', 'final-report.md');
  const defenseSlides = path.join(rootDir, 'docs', 'evaluation', 'defense-slides.md');

  it('verifies all evaluation and defense artifacts exist (PRD §8.1, §8.2, §8.3, §8.6 & A1)', () => {
    expect(fs.existsSync(benchmarkDoc), 'benchmarks.md must exist').toBe(true);
    expect(fs.existsSync(benchmarkScript), 'benchmark-runner.ps1 must exist').toBe(true);
    expect(fs.existsSync(securityMatrix), 'security-isolation-matrix.md must exist').toBe(true);
    expect(fs.existsSync(usabilityReport), 'usability-report.md must exist').toBe(true);
    expect(fs.existsSync(finalReport), 'final-report.md must exist').toBe(true);
    expect(fs.existsSync(defenseSlides), 'defense-slides.md must exist').toBe(true);
  });

  it('validates benchmark dataset contains required 3 runs with medians and ranges', () => {
    const content = fs.readFileSync(benchmarkDoc, 'utf8');

    // Platforms compared
    expect(content).toContain('Docker Desktop (WSL2 + Portainer)');
    expect(content).toContain('Phase 0 Prototype (`v0.1.0`)');
    expect(content).toContain('Ownbase Native Daemon (`v1.0.0-rc1`)');

    // 3 Runs + Median + Range table structure
    expect(content).toContain('Run 1');
    expect(content).toContain('Run 2');
    expect(content).toContain('Run 3');
    expect(content).toContain('Median');
    expect(content).toContain('Range');

    // Key metrics recorded
    expect(content).toContain('Idle RAM (Working Set)');
    expect(content).toContain('Cold Boot to Readiness');
    expect(content).toContain('App Deployment Time');
    expect(content).toContain('API Latency (p50)');
    expect(content).toContain('API Latency (p95)');

    // Assert Ownbase achieved PRD §7.3 SLA: API p95 under 100ms
    const p95Match = content.match(/API Latency \(p95\).*?\|\s*(?:\*\*)?([\d\.]+)\s*ms/i);
    expect(p95Match).not.toBeNull();
    const p95Val = parseFloat(p95Match![1]);
    expect(p95Val).toBeLessThan(100.0);

    // Assert Ownbase idle RAM meets target (< 150 MB)
    const ramMatch = content.match(/Ownbase Total Idle RAM.*?\|\s*(?:\*\*)?([\d\.]+)\s*MB/i);
    expect(ramMatch).not.toBeNull();
    const ramVal = parseFloat(ramMatch![1]);
    expect(ramVal).toBeLessThan(150.0);
  });

  it('validates reproducible benchmark runner script structure and parameters', () => {
    const script = fs.readFileSync(benchmarkScript, 'utf8');

    expect(script).toContain('param(');
    expect(script).toContain('$TargetUrl');
    expect(script).toContain('$RequestsCount');
    expect(script).toContain('$Concurrency');

    // Working set measurement of native processes
    expect(script).toContain('Get-Process');
    expect(script).toContain('WorkingSet64');

    // Latency measurement and percentiles
    expect(script).toContain('Invoke-WebRequest');
    expect(script).toContain('p50');
    expect(script).toContain('p95');
    expect(script).toContain('p99');

    // PRD §7.3 SLA assertion
    expect(script).toContain('p95 -lt 100.0');
  });

  it('validates usability evaluation report metrics (SUS score > 80, 5 participants)', () => {
    const content = fs.readFileSync(usabilityReport, 'utf8');

    expect(content).toContain('P1');
    expect(content).toContain('P2');
    expect(content).toContain('P3');
    expect(content).toContain('P4');
    expect(content).toContain('P5');

    expect(content).toContain('Task Completion Rate:** **100%**');
    expect(content).toContain('System Usability Scale');

    // SUS score assertion
    const susMatch = content.match(/Composite Mean SUS Score:\*\* \*\*([\d\.]+)/i);
    expect(susMatch).not.toBeNull();
    const susScore = parseFloat(susMatch![1]);
    expect(susScore).toBeGreaterThanOrEqual(80.0); // Grade A threshold
  });
});
