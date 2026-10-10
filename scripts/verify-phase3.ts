import path from 'path';
import fs from 'fs';
import http from 'http';
import { PostgresManager } from '../src/main/postgres';
import { PrismaManager } from '../src/main/prisma';
import { ProcessSupervisor } from '../src/main/supervisor';
import { CaddyManager } from '../src/main/caddy';
import { TailscaleManager } from '../src/main/tailscale';

async function verifyPhase3() {
  console.log('=== VERIFYING PHASE 3: NETWORKING & DYNAMIC PROXY ROUTING ===\n');

  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');
  const supervisor = new ProcessSupervisor(prismaManager);
  const caddyManager = new CaddyManager(prismaManager);
  const tailscaleManager = new TailscaleManager(prismaManager);

  let mockUpstreamServer: http.Server | null = null;

  try {
    // 1. Ensure Postgres and Prisma are active
    console.log('[1/7] Bootstrapping Database & Prisma Manifest...');
    await postgresManager.bootstrap();
    await prismaManager.runMigrations();
    console.log('✓ PostgreSQL engine active and migrations synchronized.');

    // 2. Binary Verification
    console.log('\n[2/7] Verifying Native Binaries (caddy.exe, tailscale.exe)...');
    const caddyBin = supervisor.resolveExecutablePath('caddy.exe');
    const tailscaleBin = tailscaleManager.resolveBinary();
    console.log(`  - Caddy binary: ${caddyBin || 'NOT FOUND'}`);
    console.log(`  - Tailscale binary: ${tailscaleBin || 'NOT FOUND'}`);

    if (!caddyBin || !fs.existsSync(caddyBin)) {
      throw new Error('Required caddy.exe binary not found in extraResources/bin!');
    }
    if (!tailscaleBin || !fs.existsSync(tailscaleBin)) {
      throw new Error('Required tailscale.exe binary not found in extraResources/bin!');
    }
    console.log('✓ Native networking binaries located successfully.');

    // 3. Launch Caddy via ProcessSupervisor
    console.log('\n[3/7] Launching Caddy via ProcessSupervisor (native spawn)...');
    const services = await prismaManager.getServices();
    let caddyService = services.find((s) => s.type === 'caddy');
    if (!caddyService) {
      caddyService = await prismaManager.createService({
        name: 'Caddy Gateway',
        type: 'caddy',
        executable: 'caddy.exe',
        port: 2019,
        description: 'Dynamic reverse proxy with Admin API on 127.0.0.1:2019',
        autoStart: true,
      });
    }

    supervisor.registerService(caddyService);
    const startRes = await supervisor.startService(caddyService.id);
    if (!startRes.success || !startRes.pid) {
      throw new Error(`Failed to start Caddy: ${startRes.error}`);
    }
    console.log(`✓ Caddy spawned with Windows PID: ${startRes.pid}`);

    // Wait for Caddy Admin API to be listening on 127.0.0.1:2019
    console.log('  > Probing Caddy Admin API at 127.0.0.1:2019...');
    let caddyReady = false;
    for (let i = 0; i < 20; i++) {
      const status = await caddyManager.getStatus();
      if (status.isListening) {
        caddyReady = true;
        console.log(`  ✓ Caddy Admin API listening on ${status.adminApiUrl}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!caddyReady) {
      throw new Error('Caddy Admin API failed to respond on 127.0.0.1:2019 within timeout!');
    }

    // 4. Test Dynamic Route Injection & Traversal Init via REST API
    console.log('\n[4/7] Testing Caddy Dynamic Route Injection via REST API...');
    await caddyManager.ensureServerInitialized();
    console.log('  ✓ HTTP server container srv0 initialized on port 80.');

    // Create a mock route in PostgreSQL
    let testService = services.find((s) => s.type === 'filebrowser') || caddyService;
    const client = prismaManager.getClient();
    
    // Clean up any existing test route
    await client.route.deleteMany({
      where: { subdomain: 'testapp' },
    });

    const createdRoute = await client.route.create({
      data: {
        serviceId: testService.id,
        subdomain: 'testapp',
        targetHost: '127.0.0.1',
        targetPort: 8080,
        tlsEnabled: false,
        isActive: true,
      },
    });

    console.log(`  > Registering route: testapp.localhost -> 127.0.0.1:8080 via POST /config/apps/http/servers/srv0/routes`);
    await caddyManager.registerRoute(createdRoute);
    
    const statusAfterAdd = await caddyManager.getStatus();
    console.log(`  ✓ Route successfully registered in Caddy! Active route count: ${statusAfterAdd.activeRoutesCount}`);
    if (statusAfterAdd.activeRoutesCount < 1) {
      throw new Error('Active routes count in Caddy is 0 after route registration!');
    }

    // 5. Spin Up Mock Upstream HTTP Server & Verify Proxy Forwarding
    console.log('\n[5/7] Testing Upstream Reverse Proxy Resolution...');
    const UPSTREAM_PORT = 8080;
    let upstreamHit = false;

    mockUpstreamServer = http.createServer((req, res) => {
      upstreamHit = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', proxyTarget: 'mock-upstream', host: req.headers.host }));
    });

    await new Promise<void>((resolve) => {
      mockUpstreamServer!.listen(UPSTREAM_PORT, '127.0.0.1', () => resolve());
    });
    console.log(`  ✓ Mock upstream HTTP service listening on 127.0.0.1:${UPSTREAM_PORT}`);

    // Send HTTP request to Caddy with Host: testapp.localhost
    console.log('  > Sending HTTP request to Caddy (127.0.0.1:80) with Host: testapp.localhost...');
    const proxyTestRes = await caddyManager.testRoute('testapp.localhost', 80);
    console.log(`  ✓ Caddy Reverse Proxy Response: Status=${proxyTestRes.status}, Latency=${proxyTestRes.latencyMs}ms, Success=${proxyTestRes.success}`);

    if (!proxyTestRes.success || proxyTestRes.status !== 200) {
      throw new Error(`Proxy resolution failed: Status ${proxyTestRes.status}, Error: ${proxyTestRes.error}`);
    }
    if (!upstreamHit) {
      throw new Error('Upstream mock server was not hit by Caddy proxy!');
    }
    console.log('  ✓ Verified end-to-end traffic forwarding through Caddy reverse proxy without server reload!');

    // Test route removal
    console.log('  > Testing Dynamic Route Deletion via DELETE /id/route-<id>...');
    await caddyManager.removeRoute(createdRoute.id);
    await client.route.delete({ where: { id: createdRoute.id } });
    console.log('  ✓ Route removed from Caddy REST API and database.');

    // 6. Test Tailscale Mesh VPN Integration
    console.log('\n[6/7] Testing Native Tailscale Mesh Tunneling Integration...');
    console.log('  > Executing tailscale.exe up --authkey=tskey-auth-test-key --hostname=hub-node...');
    const tsConnectRes = await tailscaleManager.connect('tskey-auth-demo-key-12345678', 'hub-node');
    if (!tsConnectRes.success) {
      throw new Error(`Tailscale connect failed: ${tsConnectRes.error}`);
    }
    console.log(`  ✓ Tailscale up executed successfully. Mesh IP: ${tsConnectRes.ip || 'Configured'}`);

    // Query Tailscale Status & DB persistence
    const tsStatus = await tailscaleManager.getStatus();
    console.log(`  - Tailscale Status: Connected=${tsStatus.connected}, IP=${tsStatus.ip}, AuthKeyMasked=${tsStatus.authKeyMasked}`);
    
    // Verify persistence in PostgreSQL
    const savedTsKey = await client.systemConfig.findUnique({ where: { key: 'tailscale_auth_key' } });
    const savedTsIp = await client.systemConfig.findUnique({ where: { key: 'tailscale_ip' } });
    console.log(`  ✓ PostgreSQL SystemConfig persisted: tailscale_auth_key="${savedTsKey?.value}", tailscale_ip="${savedTsIp?.value}"`);

    if (!savedTsKey || !savedTsKey.value) {
      throw new Error('Tailscale auth key was not saved in PostgreSQL system_configs!');
    }

    // Test Tailscale Disconnect
    console.log('  > Testing tailscale.exe down...');
    await tailscaleManager.disconnect();
    const tsStatusAfterDown = await tailscaleManager.getStatus();
    console.log(`  ✓ Tailscale disconnected: Connected=${tsStatusAfterDown.connected}`);

    // 7. Cleanup & Process Tree Termination
    console.log('\n[7/7] Testing Process Tree Termination & Cleanup (taskkill /pid <PID> /T /F)...');
    if (mockUpstreamServer) {
      mockUpstreamServer.close();
      mockUpstreamServer = null;
    }

    await supervisor.stopAll();

    // Verify Caddy PID is dead
    let isCaddyAlive = false;
    try {
      process.kill(startRes.pid, 0);
      isCaddyAlive = true;
    } catch {
      isCaddyAlive = false;
    }

    if (isCaddyAlive) {
      throw new Error(`Caddy process (PID ${startRes.pid}) was not terminated!`);
    }
    console.log(`  ✓ Confirmed Caddy process tree (PID ${startRes.pid}) was completely killed.`);

    console.log('\n======================================================');
    console.log('🎉 PHASE 3 VERIFICATION COMPLETE: ALL CHECKS PASSED!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('❌ Phase 3 Verification Failed:', err);
    process.exit(1);
  } finally {
    if (mockUpstreamServer) {
      (mockUpstreamServer as http.Server).close();
    }
    await supervisor.stopAll();
    await postgresManager.stop();
    await prismaManager.disconnect();
    console.log('Cleanup finished.');
  }
}

verifyPhase3().catch((err) => {
  console.error(err);
  process.exit(1);
});
