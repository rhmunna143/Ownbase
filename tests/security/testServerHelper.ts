import { WebApiServer } from '../../src/main/httpServer';

export interface TestServerInstance {
  server: WebApiServer;
  port: number;
  baseUrl: string;
}

export async function createTestServer(port = 3199): Promise<TestServerInstance> {
  const mockPostgresManager: any = {
    getStatus: () => ({ status: 'stopped', port: 5432, isListening: false }),
    isProcessRunning: () => false,
    getPort: () => 5432,
  };

  const mockPrismaManager: any = {
    getServices: async () => [],
    getRoutes: async () => [],
    executeQuery: async (sql: string) => [{ result: 'vulnerable_raw_sql_executed', query: sql }],
    getClient: () => ({
      $transaction: async (cb: any) =>
        cb({
          $executeRawUnsafe: async () => 1,
          $queryRawUnsafe: async (q: string) => {
            if (q.includes('count(*)')) return [{ count: 0 }];
            return [];
          },
        }),
    }),
  };

  const mockSupervisor: any = {
    getProcessStatuses: () => ({}),
    getRecentLogs: () => [],
    startService: async () => ({ success: true }),
    stopService: async () => ({ success: true }),
    restartService: async () => ({ success: true }),
  };

  const mockCaddyManager: any = {
    getStatus: async () => ({ isListening: false, activeRoutesCount: 0 }),
    syncRoutes: async () => ({ success: true, count: 0 }),
  };

  const mockTailscaleManager: any = {
    getStatus: async () => ({ isInstalled: false, isRunning: false, isConnected: false }),
  };

  const mockLifecycleManager: any = {
    getStatus: () => ({ isPowerBlockerActive: false, isAutoStartEnabled: false }),
  };

  const mockGetBootstrapSteps = () => [];

  const server = new WebApiServer(
    mockPostgresManager,
    mockPrismaManager,
    mockSupervisor,
    mockCaddyManager,
    mockTailscaleManager,
    mockLifecycleManager,
    mockGetBootstrapSteps,
    port
  );

  await server.start();

  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}
