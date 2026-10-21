import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { HealthService } from '../../src/daemon/observability/health';
import { MetricsCollector } from '../../src/daemon/observability/metrics';
import { AlertManager } from '../../src/daemon/observability/alerts';

describe('Phase 7 - Item 7.4: Observability, Metrics & Alerting Engine (PRD §7.5)', () => {
  let healthService: HealthService;
  let metricsCollector: MetricsCollector;
  let alertManager: AlertManager;
  let mockPrismaManager: any;
  let mockSupervisor: any;
  let mockPostgresManager: any;
  let mockCaddyManager: any;
  let mockTailscaleManager: any;

  let activeSystemAlerts: any[] = [];
  let alertRules: any[] = [];
  let webhookServer: http.Server;
  let receivedWebhooks: any[] = [];
  let webhookPort = 3199;

  beforeAll(async () => {
    // Start local webhook mock listener
    await new Promise<void>((resolve) => {
      webhookServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            receivedWebhooks.push(JSON.parse(body));
          } catch {
            receivedWebhooks.push(body);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        });
      });
      webhookServer.listen(webhookPort, '127.0.0.1', () => resolve());
    });

    mockPrismaManager = {
      getClient: () => ({
        $queryRawUnsafe: async () => [{ '?column?': 1 }],
        alertRule: {
          findMany: async () => [...alertRules],
          findFirst: async ({ where }: any) => alertRules.find((r) => r.metric === where.metric) || null,
          create: async ({ data }: any) => {
            const rule = { ...data, id: 'rule-' + Math.random().toString(36).slice(2, 8), createdAt: new Date() };
            alertRules.push(rule);
            return rule;
          },
          update: async ({ where, data }: any) => {
            const idx = alertRules.findIndex((r) => r.id === where.id);
            if (idx >= 0) alertRules[idx] = { ...alertRules[idx], ...data };
            return alertRules[idx];
          },
        },
        systemAlert: {
          findMany: async ({ where }: any) => {
            if (where?.resolved === false) return activeSystemAlerts.filter((a) => !a.resolved);
            if (where?.resolved === true) return activeSystemAlerts.filter((a) => a.resolved);
            return [...activeSystemAlerts];
          },
          findFirst: async ({ where }: any) => {
            return activeSystemAlerts.find((a) => a.title === where.title && a.resolved === where.resolved) || null;
          },
          create: async ({ data }: any) => {
            const alert = { ...data, id: 'alert-' + Math.random().toString(36).slice(2, 8), createdAt: new Date() };
            activeSystemAlerts.push(alert);
            return alert;
          },
          update: async ({ where, data }: any) => {
            const idx = activeSystemAlerts.findIndex((a) => a.id === where.id);
            if (idx >= 0) activeSystemAlerts[idx] = { ...activeSystemAlerts[idx], ...data };
            return activeSystemAlerts[idx];
          },
        },
      }),
    };

    mockPostgresManager = {
      getStatus: () => ({ state: 'running', port: 5432, isPortListening: true }),
    };

    mockCaddyManager = {
      getStatus: async () => ({ isListening: true, activeRoutesCount: 3 }),
    };

    mockSupervisor = {
      getAllStatuses: () => ({
        caddy: { state: 'running' },
        filebrowser: { state: 'running' },
      }),
    };

    mockTailscaleManager = {
      getStatus: async () => ({ connected: true, ip: '100.64.0.5' }),
    };

    healthService = new HealthService(
      mockPostgresManager,
      mockPrismaManager,
      mockSupervisor,
      mockCaddyManager,
      mockTailscaleManager
    );

    metricsCollector = new MetricsCollector(false); // manual collection
    alertManager = new AlertManager(mockPrismaManager, mockSupervisor, false);
  });

  afterAll(async () => {
    metricsCollector.stop();
    alertManager.stop();
    await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
  });

  it('reports healthy overall status when all subsystems are operational', async () => {
    const report = await healthService.getDeepHealth();

    expect(report.overall).toBe('healthy');
    expect(report.components.postgres.status).toBe('healthy');
    expect(report.components.caddy.status).toBe('healthy');
    expect(report.components.supervisor.status).toBe('healthy');
    expect(report.components.storage.status).toBe('healthy');
    expect(report.components.tailscale.status).toBe('healthy');
  });

  it('reports degraded overall status when a service enters failed state', async () => {
    mockSupervisor.getAllStatuses = () => ({
      caddy: { state: 'running' },
      crashedService: { state: 'failed' },
    });

    const report = await healthService.getDeepHealth();

    expect(report.overall).toBe('degraded');
    expect(report.components.supervisor.status).toBe('degraded');
    expect(report.components.supervisor.message).toContain('failed state');
  });

  it('collects real-time CPU, RAM, and storage metric samples', async () => {
    const sample = await metricsCollector.collectSample();

    expect(sample.timestamp).toBeDefined();
    expect(sample.cpu.cores).toBeGreaterThan(0);
    expect(typeof sample.cpu.systemUsagePct).toBe('number');
    expect(sample.memory.daemonRssMb).toBeGreaterThan(0);
    expect(sample.memory.systemTotalMb).toBeGreaterThan(0);

    const history = metricsCollector.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('evaluates alert rules and triggers an alert when a service fails', async () => {
    // Configure alert rule with webhook URL
    await alertManager.createOrUpdateRule({
      name: 'Test Service Failure Rule',
      metric: 'service_status',
      condition: 'equals',
      threshold: 'failed',
      severity: 'critical',
      isEnabled: true,
      webhookUrl: `http://127.0.0.1:${webhookPort}/webhook`,
    });

    mockSupervisor.getAllStatuses = () => ({
      'crashed-node-app': { state: 'failed' },
    });

    const triggered = await alertManager.evaluateRules();

    expect(triggered.length).toBe(1);
    expect(triggered[0].title).toContain('crashed-node-app');
    expect(triggered[0].severity).toBe('critical');

    // Wait briefly for webhook delivery
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedWebhooks.length).toBeGreaterThanOrEqual(1);
    const lastHook = receivedWebhooks[receivedWebhooks.length - 1];
    expect(lastHook.event).toBe('alert.triggered');
    expect(lastHook.alert.severity).toBe('critical');
    expect(lastHook.alert.title).toContain('crashed-node-app');
  });

  it('resolves active system alerts upon admin action', async () => {
    const activeBefore = await alertManager.getAlerts();
    expect(activeBefore.activeAlerts.length).toBeGreaterThan(0);

    const alertId = activeBefore.activeAlerts[0].id;
    const resolved = await alertManager.resolveAlert(alertId);

    expect(resolved).toBe(true);

    const activeAfter = await alertManager.getAlerts();
    expect(activeAfter.activeAlerts.find((a) => a.id === alertId)).toBeUndefined();
    expect(activeAfter.resolvedAlerts.find((a) => a.id === alertId)).toBeDefined();
  });
});
