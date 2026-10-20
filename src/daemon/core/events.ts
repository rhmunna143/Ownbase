import { EventEmitter } from 'events';

export type DaemonEvent =
  | { type: 'log'; data: any }
  | { type: 'service-status'; data: any }
  | { type: 'service-log'; data: any }
  | { type: 'postgres-status'; data: any }
  | { type: 'bootstrap-update'; data: any }
  | { type: 'route-change'; data: any };

export class EventBus extends EventEmitter {
  public emitEvent(event: DaemonEvent) {
    this.emit(event.type, event.data);
    this.emit('*', event);
  }
}

export const eventBus = new EventBus();
