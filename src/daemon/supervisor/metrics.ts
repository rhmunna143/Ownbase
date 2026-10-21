import os from 'os';
import { ManagedJob, JobMetrics } from './jobhost';
import { eventBus } from '../core/events';

export interface ServiceMetricSample {
  serviceId: string;
  pid: number;
  cpuPercent: number;
  memoryMb: number;
  peakMemoryMb: number;
  activeProcesses: number;
  timestamp: string;
}

export class ServiceMetricsCollector {
  private serviceId: string;
  private job: ManagedJob;
  private history: ServiceMetricSample[] = [];
  private maxHistory: number = 60; // 60 samples * 5s = 5 minutes
  private previousCpuTimeMs: number = 0;
  private previousSampleTimestamp: number = Date.now();
  private numCores: number = os.cpus().length || 1;

  constructor(serviceId: string, job: ManagedJob) {
    this.serviceId = serviceId;
    this.job = job;
    this.previousSampleTimestamp = Date.now();
  }

  public sample(): ServiceMetricSample | null {
    const raw: JobMetrics | null = this.job.getMetrics();
    const now = Date.now();

    if (!raw) {
      return null;
    }

    const timeDeltaMs = Math.max(1, now - this.previousSampleTimestamp);
    let cpuPercent = 0;

    if (this.previousCpuTimeMs > 0 && raw.cpuTimeMs >= this.previousCpuTimeMs) {
      const cpuDeltaMs = raw.cpuTimeMs - this.previousCpuTimeMs;
      cpuPercent = Math.min(100, Math.round((cpuDeltaMs / (timeDeltaMs * this.numCores)) * 1000) / 10);
    }

    this.previousCpuTimeMs = raw.cpuTimeMs;
    this.previousSampleTimestamp = now;

    const memoryMb = Math.round(raw.currentMemoryBytes / (1024 * 1024));
    const peakMemoryMb = Math.round(raw.peakMemoryBytes / (1024 * 1024));

    const sample: ServiceMetricSample = {
      serviceId: this.serviceId,
      pid: raw.pid,
      cpuPercent,
      memoryMb,
      peakMemoryMb,
      activeProcesses: raw.activeProcesses,
      timestamp: new Date(now).toISOString(),
    };

    this.history.push(sample);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Emit to event bus for UI push streaming
    eventBus.emitEvent({
      type: 'log',
      data: {
        source: 'metrics',
        sample,
      },
    });

    return sample;
  }

  public getHistory(): ServiceMetricSample[] {
    return [...this.history];
  }

  public getLatest(): ServiceMetricSample | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }
}
