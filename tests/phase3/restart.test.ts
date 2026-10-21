import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RestartController } from '../../src/daemon/supervisor/restart';

describe('Phase 3 - Item 3.4: Restart Policy & Circuit Breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('policy "never" never restarts', () => {
    const rc = new RestartController({ policy: 'never' });
    const decision = rc.shouldRestart(1);
    expect(decision.restart).toBe(false);
  });

  it('policy "on-failure" restarts on non-zero exit code but not on code 0', () => {
    const rc = new RestartController({ policy: 'on-failure' });

    const cleanExit = rc.shouldRestart(0);
    expect(cleanExit.restart).toBe(false);

    const failExit = rc.shouldRestart(1);
    expect(failExit.restart).toBe(true);
    expect(failExit.delayMs).toBeGreaterThan(0);
  });

  it('policy "always" restarts even on clean exit 0', () => {
    const rc = new RestartController({ policy: 'always' });
    const decision = rc.shouldRestart(0);
    expect(decision.restart).toBe(true);
  });

  it('calculates exponential backoff for consecutive crashes', () => {
    const rc = new RestartController({
      policy: 'always',
      baseDelayMs: 1000,
      backoffFactor: 2,
      jitter: false, // disable jitter for deterministic math
      maxCrashCount: 10,
    });

    // Crash 1: 1000 * 2^0 = 1000ms
    const c1 = rc.shouldRestart(1);
    expect(c1.delayMs).toBe(1000);

    // Crash 2: 1000 * 2^1 = 2000ms
    const c2 = rc.shouldRestart(1);
    expect(c2.delayMs).toBe(2000);

    // Crash 3: 1000 * 2^2 = 4000ms
    const c3 = rc.shouldRestart(1);
    expect(c3.delayMs).toBe(4000);
  });

  it('trips circuit breaker when exceeding crash threshold in window', () => {
    const rc = new RestartController({
      policy: 'always',
      maxCrashCount: 3,
      crashWindowMs: 60000,
    });

    expect(rc.shouldRestart(1).circuitTripped).toBe(false);
    expect(rc.shouldRestart(1).circuitTripped).toBe(false);

    // 3rd crash hits threshold
    const trip = rc.shouldRestart(1);
    expect(trip.circuitTripped).toBe(true);
    expect(trip.restart).toBe(false);
    expect(rc.isTripped).toBe(true);

    // Subsequent checks stay tripped
    expect(rc.shouldRestart(1).restart).toBe(false);
  });

  it('resets backoff after stable run threshold is reached', () => {
    const rc = new RestartController({
      policy: 'always',
      baseDelayMs: 1000,
      jitter: false,
      stableRunMs: 10000,
    });

    rc.shouldRestart(1);
    rc.shouldRestart(1);
    expect(rc.consecutiveCrashCount).toBe(2);

    rc.onStarted();
    // Advance timers by stableRunMs
    vi.advanceTimersByTime(11000);

    expect(rc.consecutiveCrashCount).toBe(0);
  });
});
