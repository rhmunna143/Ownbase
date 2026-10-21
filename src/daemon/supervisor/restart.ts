import { RestartPolicy } from './spec';
import { logger } from '../core/logger';

export interface RestartPolicyConfig {
  policy: RestartPolicy;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitter?: boolean;
  maxCrashCount?: number;
  crashWindowMs?: number;
  stableRunMs?: number;
}

export class RestartController {
  private policy: RestartPolicy;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private backoffFactor: number;
  private jitter: boolean;
  private maxCrashCount: number;
  private crashWindowMs: number;
  private stableRunMs: number;

  private crashTimestamps: number[] = [];
  private consecutiveCrashes: number = 0;
  private runningTimer: NodeJS.Timeout | null = null;
  private isCircuitTripped: boolean = false;

  constructor(config: RestartPolicyConfig) {
    this.policy = config.policy || 'always';
    this.baseDelayMs = config.baseDelayMs ?? 1000;
    this.maxDelayMs = config.maxDelayMs ?? 60000;
    this.backoffFactor = config.backoffFactor ?? 2;
    this.jitter = config.jitter ?? true;
    this.maxCrashCount = config.maxCrashCount ?? 5;
    this.crashWindowMs = config.crashWindowMs ?? 300000; // 5 minutes
    this.stableRunMs = config.stableRunMs ?? 30000; // 30 seconds
  }

  public onStarted(): void {
    if (this.runningTimer) {
      clearTimeout(this.runningTimer);
    }

    // After stableRunMs without exiting, reset backoff
    this.runningTimer = setTimeout(() => {
      this.consecutiveCrashes = 0;
      this.crashTimestamps = [];
      logger.info('supervisor', 'Process achieved stable run threshold; restart backoff reset.');
    }, this.stableRunMs);
  }

  public shouldRestart(exitCode: number | null): { restart: boolean; delayMs: number; circuitTripped: boolean } {
    if (this.runningTimer) {
      clearTimeout(this.runningTimer);
      this.runningTimer = null;
    }

    if (this.isCircuitTripped) {
      return { restart: false, delayMs: 0, circuitTripped: true };
    }

    if (this.policy === 'never') {
      return { restart: false, delayMs: 0, circuitTripped: false };
    }

    // 'on-failure' only restarts if abnormal exit (non-zero or null/signal)
    if (this.policy === 'on-failure' && exitCode === 0) {
      return { restart: false, delayMs: 0, circuitTripped: false };
    }

    const now = Date.now();
    this.crashTimestamps.push(now);
    this.consecutiveCrashes += 1;

    // Prune crashes outside of the window
    this.crashTimestamps = this.crashTimestamps.filter((ts) => now - ts <= this.crashWindowMs);

    // Circuit breaker check
    if (this.crashTimestamps.length >= this.maxCrashCount) {
      this.isCircuitTripped = true;
      logger.error(
        'supervisor',
        `Crash loop detected (${this.crashTimestamps.length} exits in ${Math.round(
          this.crashWindowMs / 1000
        )}s). Circuit breaker tripped; transitioning to failed.`
      );
      return { restart: false, delayMs: 0, circuitTripped: true };
    }

    // Calculate exponential backoff delay: baseDelay * (factor ^ (consecutive - 1))
    const exponent = Math.max(0, this.consecutiveCrashes - 1);
    let delay = this.baseDelayMs * Math.pow(this.backoffFactor, exponent);
    delay = Math.min(delay, this.maxDelayMs);

    // Add jitter: ±20%
    if (this.jitter) {
      const jitterFraction = 0.2;
      const jitterAmount = delay * jitterFraction * (Math.random() * 2 - 1);
      delay = Math.max(this.baseDelayMs, Math.round(delay + jitterAmount));
    }

    return { restart: true, delayMs: delay, circuitTripped: false };
  }

  public reset(): void {
    if (this.runningTimer) {
      clearTimeout(this.runningTimer);
      this.runningTimer = null;
    }
    this.crashTimestamps = [];
    this.consecutiveCrashes = 0;
    this.isCircuitTripped = false;
  }

  public get consecutiveCrashCount(): number {
    return this.consecutiveCrashes;
  }

  public get isTripped(): boolean {
    return this.isCircuitTripped;
  }
}
