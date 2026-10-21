import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessSupervisor } from '../../src/daemon/supervisor/supervisor';
import { PrismaManager } from '../../src/daemon/db/prisma';
import { ServiceRecord } from '../../src/shared/types';

describe('Phase 3 - Item 3.1 & 3.2: Decoupled ProcessSupervisor Lifecycle', () => {
  let mockPrisma: any;
  let supervisor: ProcessSupervisor;

  beforeEach(() => {
    mockPrisma = {
      getClient: vi.fn().mockReturnValue({
        service: {
          update: vi.fn().mockResolvedValue({}),
          findMany: vi.fn().mockResolvedValue([]),
        },
      }),
      getServices: vi.fn().mockResolvedValue([]),
    };
    supervisor = new ProcessSupervisor(mockPrisma as any);
  });

  it('registers a service and applies recipe spec without hardcoded binary switches in supervisor', () => {
    const serviceRecord: ServiceRecord = {
      id: 'svc-test-1',
      name: 'Test Caddy',
      type: 'caddy',
      executable: 'caddy.exe',
      port: 80,
      status: 'stopped',
      autoStart: false,
      pid: null,
      description: 'Reverse proxy',
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const managed = supervisor.registerService(serviceRecord);
    expect(managed).toBeDefined();
    expect(managed.serviceId).toBe('svc-test-1');
    expect(managed.spec.templateId).toBe('caddy');
    expect(managed.spec.args).toEqual(['run']);
    expect(managed.status).toBe('stopped');
    expect(managed.stateMachine.currentState).toBe('stopped');
  });

  it('reports all registered statuses accurately', () => {
    const serviceRecord: ServiceRecord = {
      id: 'svc-test-2',
      name: 'File Manager',
      type: 'filebrowser',
      executable: 'filebrowser.exe',
      port: 8080,
      status: 'stopped',
      autoStart: false,
      pid: null,
      description: null,
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    supervisor.registerService(serviceRecord);
    const statuses = supervisor.getAllStatuses();

    expect(statuses['svc-test-2']).toBeDefined();
    expect(statuses['svc-test-2'].name).toBe('File Manager');
    expect(statuses['svc-test-2'].status).toBe('stopped');
  });

  it('records logs into service ring buffer and returns recent logs', () => {
    const serviceRecord: ServiceRecord = {
      id: 'svc-test-3',
      name: 'Log Test Service',
      type: 'custom',
      executable: 'test.exe',
      port: 3000,
      status: 'stopped',
      autoStart: false,
      pid: null,
      description: null,
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const managed = supervisor.registerService(serviceRecord);
    managed.logManager.appendLog('info', 'First log message');
    managed.logManager.appendLog('warn', 'Second log message');

    const logs = supervisor.getServiceLogs('svc-test-3');
    expect(logs.length).toBe(2);
    expect(logs[0].message).toBe('First log message');
    expect(logs[0].level).toBe('info');
    expect(logs[1].message).toBe('Second log message');
    expect(logs[1].level).toBe('warn');
  });
});
