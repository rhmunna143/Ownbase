import { EventEmitter } from 'events';
import { logger } from '../core/logger';
import { eventBus } from '../core/events';

export type ServiceState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'backoff'
  | 'crashed'
  | 'failed';

export interface StateTransitionEvent {
  serviceId: string;
  from: ServiceState;
  to: ServiceState;
  reason?: string;
  timestamp: string;
}

export class ServiceStateMachine extends EventEmitter {
  private _currentState: ServiceState;
  private _serviceId: string;
  private _serviceName: string;

  private static readonly VALID_TRANSITIONS: Record<ServiceState, ServiceState[]> = {
    stopped: ['starting'],
    starting: ['running', 'crashed', 'failed', 'stopping', 'stopped'],
    running: ['stopping', 'crashed', 'failed', 'stopped'],
    stopping: ['stopped', 'failed'],
    backoff: ['starting', 'stopped', 'failed'],
    crashed: ['backoff', 'stopped', 'failed', 'starting'],
    failed: ['starting', 'stopped'],
  };

  constructor(serviceId: string, serviceName: string, initialState: ServiceState = 'stopped') {
    super();
    this._serviceId = serviceId;
    this._serviceName = serviceName;
    this._currentState = initialState;
  }

  public get currentState(): ServiceState {
    return this._currentState;
  }

  public canTransition(to: ServiceState): boolean {
    if (this._currentState === to) return true;
    const allowed = ServiceStateMachine.VALID_TRANSITIONS[this._currentState] || [];
    return allowed.includes(to);
  }

  public transition(to: ServiceState, reason?: string): boolean {
    if (this._currentState === to) {
      return true; // No-op
    }

    if (!this.canTransition(to)) {
      const msg = `Invalid state transition for "${this._serviceName}" (${this._serviceId}): ${this._currentState} -> ${to}`;
      logger.error('supervisor', msg);
      throw new Error(msg);
    }

    const from = this._currentState;
    this._currentState = to;

    const eventPayload: StateTransitionEvent = {
      serviceId: this._serviceId,
      from,
      to,
      reason,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      'supervisor',
      `State transition for "${this._serviceName}": ${from} -> ${to}${reason ? ` (${reason})` : ''}`
    );

    this.emit('transition', eventPayload);
    this.emit(to, eventPayload);

    // Publish to daemon eventBus
    eventBus.emitEvent({
      type: 'service-status',
      data: {
        serviceId: this._serviceId,
        name: this._serviceName,
        status: to,
        reason,
        timestamp: eventPayload.timestamp,
      },
    });

    return true;
  }

  public reset(state: ServiceState = 'stopped') {
    this._currentState = state;
  }
}
