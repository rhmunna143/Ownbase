import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ROUTE_TABLE } from '../../src/shared/contract/routes';
import { generateOpenApiSpec, getEndpointCatalog } from '../../src/shared/contract/openapi';
import { generateApiMarkdownDocs } from '../../scripts/generate-api-docs';

describe('Phase 8 - Item 8.5: API Reference & Contract Synchronization (FR14 & PRD §8.5)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const apiDocPath = path.join(rootDir, 'docs', 'API_DOCUMENTATION.md');
  const apiRefPath = path.join(rootDir, 'docs', 'api-reference.md');

  it('generates OpenAPI 3.0.3 specification covering 100% of defined routes', () => {
    const spec = generateOpenApiSpec('127.0.0.1:3001');

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toContain('Ownbase');
    expect(spec.components.securitySchemes.BearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.ApiKeyAuth).toBeDefined();

    // Verify all routes are present in OpenAPI paths
    for (const route of ROUTE_TABLE) {
      const openApiPath = route.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      const method = route.method.toLowerCase();

      expect(spec.paths[openApiPath], `Missing path in spec: ${openApiPath}`).toBeDefined();
      expect(spec.paths[openApiPath][method], `Missing method ${method} on path ${openApiPath}`).toBeDefined();

      const operation = spec.paths[openApiPath][method];
      expect(operation.summary).toBeDefined();
      expect(operation.responses['200']).toBeDefined();

      if (route.auth === 'public') {
        expect(operation.security).toEqual([]);
      } else {
        expect(operation.security.length).toBeGreaterThan(0);
      }
    }
  });

  it('generates complete endpoint catalog with valid categories and role requirements', () => {
    const catalog = getEndpointCatalog();
    expect(catalog.length).toBe(ROUTE_TABLE.length);

    for (const item of catalog) {
      expect(item.id).toBeDefined();
      expect(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']).toContain(item.method);
      expect(item.path.startsWith('/api/v1/')).toBe(true);
      expect(item.category).toBeDefined();
      expect(item.summary.length).toBeGreaterThan(0);
      expect(['public', 'user', 'apiKey', 'ticket']).toContain(item.auth);
    }
  });

  it('verifies generated API Markdown reference documents are in sync with live contract', () => {
    const markdown = generateApiMarkdownDocs();

    expect(markdown).toContain('# Ownbase Native Windows Server - API Reference');
    expect(markdown).toContain(`Total Endpoints:** ${ROUTE_TABLE.length}`);

    // Every route must be documented in the markdown table
    for (const route of ROUTE_TABLE) {
      expect(markdown).toContain(`\`${route.path}\``);
      expect(markdown).toContain(`\`${route.method}\``);
    }

    // Both documentation locations must exist
    expect(fs.existsSync(apiDocPath)).toBe(true);
    expect(fs.existsSync(apiRefPath)).toBe(true);

    const docContent = fs.readFileSync(apiDocPath, 'utf8');
    expect(docContent).toContain(`Total Endpoints:** ${ROUTE_TABLE.length}`);
  });

  it('enforces RBAC role requirements on sensitive administrative endpoints', () => {
    const backupRestoreRoute = ROUTE_TABLE.find((r) => r.path === '/api/v1/backups/:id/restore');
    expect(backupRestoreRoute).toBeDefined();
    expect(backupRestoreRoute?.minRole).toBe('ROOT');

    const backupDeleteRoute = ROUTE_TABLE.find((r) => r.path === '/api/v1/backups/:id');
    expect(backupDeleteRoute).toBeDefined();
    expect(backupDeleteRoute?.minRole).toBe('ROOT');

    const alertRuleRoute = ROUTE_TABLE.find((r) => r.path === '/api/v1/alerts/rules');
    expect(alertRuleRoute).toBeDefined();
    expect(alertRuleRoute?.minRole).toBe('ADMIN');

    const publicHealthRoute = ROUTE_TABLE.find((r) => r.path === '/api/v1/health');
    expect(publicHealthRoute).toBeDefined();
    expect(publicHealthRoute?.auth).toBe('public');
  });
});
