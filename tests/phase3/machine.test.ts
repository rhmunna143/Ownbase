import { describe, it, expect, vi } from 'vitest';
import { ServiceStateMachine } from '../../src/daemon/supervisor/machine';

describe('Phase 3 - Item 3.2: Formal Service State Machine', () => {
  it('initializes to stopped state by default', () => {
    const sm = new ServiceStateMachine('test-1', 'Test Service');
    expect(sm.currentState).toBe('stopped');
  });

  it('allows valid sequential transitions: stopped -> starting -> running -> stopping -> stopped', () => {
    const sm = new ServiceStateMachine('test-1', 'Test Service');
    const events: string[] = [];

    sm.on('transition', (evt) => {
      events.push(`${evt.from}->${evt.to}`);
    });

    expect(sm.transition('starting')).toBe(true);
    expect(sm.currentState).toBe('starting');

    expect(sm.transition('running')).toBe(true);
    expect(sm.currentState).toBe('running');

    expect(sm.transition('stopping')).toBe(true);
    expect(sm.currentState).toBe('stopping');

    expect(sm.transition('stopped')).toBe(true);
    expect(sm.currentState).toBe('stopped');

    expect(events).toEqual([
      'stopped->starting',
      'starting->running',
      'running->stopping',
      'stopping->stopped',
    ]);
  });

  it('handles abnormal crash and backoff: running -> crashed -> backoff -> starting', () => {
    const sm = new ServiceStateMachine('test-2', 'Crash Service');
    sm.transition('starting');
    sm.transition('running');

    expect(sm.transition('crashed', 'Process exited with non-zero code')).toBe(true);
    expect(sm.currentState).toBe('crashed');

    expect(sm.transition('backoff', 'Backing off for 2s')).toBe(true);
    expect(sm.currentState).toBe('backoff');

    expect(sm.transition('starting')).toBe(true);
    expect(sm.currentState).toBe('starting');
  });

  it('handles circuit breaker trip: crashed -> failed', () => {
    const sm = new ServiceStateMachine('test-3', 'Loop Service');
    sm.transition('starting');
    sm.transition('crashed');

    expect(sm.transition('failed', 'Circuit breaker tripped')).toBe(true);
    expect(sm.currentState).toBe('failed');
  });

  it('throws on illegal transitions (e.g. stopped -> running without starting)', () => {
    const sm = new ServiceStateMachine('test-4', 'Illegal Transition');
    expect(() => sm.transition('running')).toThrow(/Invalid state transition/);
    expect(sm.currentState).toBe('stopped');
  });

  it('is a no-op when transitioning to the current state', () => {
    const sm = new ServiceStateMachine('test-5', 'No-op Service');
    expect(sm.transition('stopped')).toBe(true);
    expect(sm.currentState).toBe('stopped');
  });
});
