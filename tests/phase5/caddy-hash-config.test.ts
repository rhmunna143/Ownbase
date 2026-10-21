import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { CaddyManager } from '../../src/daemon/network/caddy';
import { PrismaManager } from '../../src/daemon/db/prisma';

describe('Phase 5 - Item 5.2: Caddy Config Generator & Hash Caching', () => {
  const prismaManager = new PrismaManager();
  const caddy = new CaddyManager(prismaManager);

  it('generates complete Caddy config with core gateway and user routes', () => {
    const mockRoutes = [
      {
        subdomain: 'files',
        targetPort: 8080,
        targetHost: '127.0.0.1',
        isActive: true,
      },
      {
        subdomain: 'ai',
        targetPort: 11434,
        targetHost: '127.0.0.1',
        isActive: true,
      },
    ];

    const { config, hash } = caddy.generateFullConfig(mockRoutes);

    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // SHA-256 hex string

    const routes = config.apps.http.servers.srv0.routes;
    expect(routes.length).toBeGreaterThanOrEqual(4); // 2 core + 2 service routes

    // Core routes verification
    const coreGateway = routes.find((r: any) => r['@id'] === 'core-gateway-api');
    expect(coreGateway).toBeDefined();

    // User routes verification
    const filesRoute = routes.find((r: any) => r['@id'] === 'route-files');
    expect(filesRoute).toBeDefined();
    expect(filesRoute.match[0].host).toContain('files.localhost');
  });

  it('computes identical SHA-256 hash for unchanged route configuration', () => {
    const mockRoutes = [
      {
        subdomain: 'files',
        targetPort: 8080,
        isActive: true,
      },
    ];

    const res1 = caddy.generateFullConfig(mockRoutes);
    const res2 = caddy.generateFullConfig(mockRoutes);

    expect(res1.hash).toBe(res2.hash);
  });

  it('detects changes and generates different SHA-256 hash when route modified', () => {
    const routesA = [
      {
        subdomain: 'files',
        targetPort: 8080,
        isActive: true,
      },
    ];

    const routesB = [
      {
        subdomain: 'files',
        targetPort: 8081, // Port changed
        isActive: true,
      },
    ];

    const resA = caddy.generateFullConfig(routesA);
    const resB = caddy.generateFullConfig(routesB);

    expect(resA.hash).not.toBe(resB.hash);
  });
});
