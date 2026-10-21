import os from 'os';
import { volumeManager } from '../storage/volumes';

export interface MetricSample {
  timestamp: string;
  cpu: {
    systemUsagePct: number;
    daemonUsagePct: number;
    cores: number;
  };
  memory: {
    daemonRssMb: number;
    daemonHeapUsedMb: number;
    systemTotalMb: number;
    systemFreeMb: number;
    systemUsagePct: number;
  };
  storage: {
    volumes: Array<{
      driveLetter: string;
      totalGb: number;
      freeGb: number;
      usedPct: number;
    }>;
  };
}

export class MetricsCollector {
  private samples: MetricSample[] = [];
  private maxSamples = 60;
  private prevCpuUsage = process.cpuUsage();
  private prevCpuTime = Date.now();
  private intervalTimer?: NodeJS.Timeout;

  constructor(autoStart = true) {
    if (autoStart) {
      this.collectSample();
      this.intervalTimer = setInterval(() => {
        this.collectSample();
      }, 5000);
    }
  }

  public stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }

  public async collectSample(): Promise<MetricSample> {
    const now = Date.now();
    const timeDeltaMs = Math.max(1, now - this.prevCpuTime);
    const cpuDelta = process.cpuUsage(this.prevCpuUsage);

    this.prevCpuTime = now;
    this.prevCpuUsage = process.cpuUsage();

    // Calculate daemon CPU %
    const totalCpuTimeMicros = cpuDelta.user + cpuDelta.system;
    const timeDeltaMicros = timeDeltaMs * 1000;
    const cores = os.cpus().length || 1;
    const daemonCpuPct = Math.min(100, Math.round((totalCpuTimeMicros / (timeDeltaMicros * cores)) * 100));

    // Calculate system CPU % from os.loadavg() or rough estimate
    const loadAvg = os.loadavg()[0];
    const systemCpuPct = Math.min(100, Math.round((loadAvg / cores) * 100)) || daemonCpuPct;

    // Memory stats
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const systemUsagePct = Math.round(((totalMem - freeMem) / totalMem) * 100);

    // Storage stats
    const volumesSummary: MetricSample['storage']['volumes'] = [];
    try {
      const volumes = volumeManager.getCachedVolumes();
      for (const v of volumes) {
        const total = Number(v.totalBytes);
        const free = Number(v.freeBytes);
        const totalGb = Math.round((total / (1024 * 1024 * 1024)) * 10) / 10;
        const freeGb = Math.round((free / (1024 * 1024 * 1024)) * 10) / 10;
        const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
        volumesSummary.push({
          driveLetter: v.driveLetter,
          totalGb,
          freeGb,
          usedPct,
        });
      }
    } catch {}

    const sample: MetricSample = {
      timestamp: new Date().toISOString(),
      cpu: {
        systemUsagePct: systemCpuPct,
        daemonUsagePct: daemonCpuPct,
        cores,
      },
      memory: {
        daemonRssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        daemonHeapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
        systemTotalMb: Math.round(totalMem / (1024 * 1024)),
        systemFreeMb: Math.round(freeMem / (1024 * 1024)),
        systemUsagePct,
      },
      storage: {
        volumes: volumesSummary,
      },
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    return sample;
  }

  public getLatest(): MetricSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  public getHistory(): MetricSample[] {
    return [...this.samples];
  }
}

export const metricsCollector = new MetricsCollector();
