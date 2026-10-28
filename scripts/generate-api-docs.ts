import fs from 'fs';
import path from 'path';
import { ROUTE_TABLE } from '../src/shared/contract/routes';
import { generateOpenApiSpec } from '../src/shared/contract/openapi';

export function generateApiMarkdownDocs(): string {
  const spec = generateOpenApiSpec('127.0.0.1:3001');

  // Group routes by category
  const categories: Record<string, typeof ROUTE_TABLE> = {};

  for (const route of ROUTE_TABLE) {
    let cat = 'General';
    if (route.path.includes('/auth') || route.path.includes('/setup')) cat = 'Authentication & Identity';
    else if (route.path.includes('/backups')) cat = 'Backups & Disaster Recovery';
    else if (route.path.includes('/alerts')) cat = 'Observability & Alerting';
    else if (route.path.includes('/system') || route.path.includes('/metrics') || route.path.includes('/health') || route.path.includes('/ping') || route.path.includes('/bootstrap')) cat = 'System & Health Telemetry';
    else if (route.path.includes('/services') || route.path.includes('/process') || route.path.includes('/catalog')) cat = 'Process Supervisor & App Catalog';
    else if (route.path.includes('/routes') || route.path.includes('/caddy')) cat = 'Edge Gateway & Reverse Proxy';
    else if (route.path.includes('/tailscale')) cat = 'Tailscale Mesh Networking';
    else if (route.path.includes('/lifecycle')) cat = 'Lifecycle & Power Management';
    else if (route.path.includes('/files') || route.path.includes('/storage')) cat = 'Storage Volumes & Contained File Streaming';
    else if (route.path.includes('/photos')) cat = 'Photos & Media Indexer';
    else if (route.path.includes('/terminal')) cat = 'Audited ConPTY Web Terminal';
    else if (route.path.includes('/db/')) cat = 'Database Table Browser';
    else if (route.path.includes('/audit')) cat = 'Security Audit Stream';
    else if (route.path.includes('/users') || route.path.includes('/api-keys')) cat = 'Administration & Access Control';

    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(route);
  }

  const categoryNames = Object.keys(categories).sort();

  let md = `# Ownbase Native Windows Server - API Reference

**Document Version:** 1.0.0  
**OpenAPI Specification:** 3.0.3  
**Base URL:** \`http://127.0.0.1:3001\` (Direct Gateway) or \`http://localhost\` (Caddy Ingress Port 80)  
**Total Endpoints:** ${ROUTE_TABLE.length}

---

## Overview

Ownbase exposes a unified, contract-driven REST API for standalone server orchestration on Windows without Docker or WSL2.
All endpoints adhere strictly to the centralized \`ROUTE_TABLE\` schema and return standardized JSON responses.

### Authentication & Authorization

All authenticated endpoints require one of the following:
1. **Bearer JWT Token**: Header \`Authorization: Bearer <access_token>\` (15-minute expiration, issued by \`/api/v1/auth/login\` or \`/api/v1/auth/refresh\`).
2. **Permanent API Key**: Header \`x-api-key: <api_key>\` (32-byte cryptographically secure key created by Root administrator).

### Role Hierarchy

\`\`\`
ROOT (Super-admin: backups, raw restore, terminal, user deletion)
  ▲
ADMIN (Operator: deploy, catalog install, routes, restarts, alert rules)
  ▲
READ_ONLY (Viewer: metrics, logs, service status, file reads)
\`\`\`

---

## Route Catalog Summary

| Category | Endpoints Count | Default Access |
| :--- | :---: | :--- |
`;

  for (const cat of categoryNames) {
    const count = categories[cat].length;
    const hasPublic = categories[cat].some((r) => r.auth === 'public');
    const defaultAccess = hasPublic ? 'Mixed (Public / Authenticated)' : 'Authenticated (Bearer / API Key)';
    md += `| **${cat}** | ${count} | ${defaultAccess} |\n`;
  }

  md += `\n---\n\n## Endpoints Specification\n\n`;

  for (const cat of categoryNames) {
    md += `### ${cat}\n\n`;
    md += `| Method | Path | Min Role | Audited | Summary |\n`;
    md += `| :--- | :--- | :--- | :---: | :--- |\n`;

    for (const r of categories[cat]) {
      const minRole = r.auth === 'public' ? 'Public' : (r.minRole || 'READ_ONLY');
      const audited = r.audit ? '✅ Yes' : '—';
      md += `| \`${r.method}\` | \`${r.path}\` | \`${minRole}\` | ${audited} | ${r.summary || ''} |\n`;
    }
    md += `\n`;
  }

  md += `---

## Standard Error Envelope

All API errors return a uniform JSON envelope preventing internal stack trace leakage:

\`\`\`json
{
  "error": "Descriptive error message",
  "code": "ERROR_CODE",
  "message": "Descriptive error message"
}
\`\`\`

Common Error Codes:
- \`400 BAD_REQUEST\` / \`INVALID_PARAM\`: Missing or schema-violating request body.
- \`401 UNAUTHORIZED\`: Missing or expired Bearer token / invalid API key.
- \`403 FORBIDDEN\`: Caller role does not meet endpoint \`minRole\` requirement.
- \`404 NOT_FOUND\`: Target entity (service, app, volume, backup) not found.
- \`429 TOO_MANY_REQUESTS\`: Rate limiter / login throttle triggered (includes \`Retry-After\` header).
- \`503 SERVICE_UNAVAILABLE\`: Subsystem health check failed or circuit breaker tripped.

---

## OpenAPI 3.0 Export

A live JSON export of this complete contract is served directly by the running daemon at:
\`\`\`
GET /api/v1/openapi.json
\`\`\`
`;

  return md;
}

if (require.main === module) {
  const docs = generateApiMarkdownDocs();
  const outputPath = path.join(__dirname, '..', 'docs', 'API_DOCUMENTATION.md');
  const lowercaseOutputPath = path.join(__dirname, '..', 'docs', 'api-reference.md');

  fs.writeFileSync(outputPath, docs, 'utf8');
  console.log(`Generated API documentation at ${outputPath}`);

  try {
    fs.writeFileSync(lowercaseOutputPath, docs, 'utf8');
    console.log(`Generated API reference at ${lowercaseOutputPath}`);
  } catch {}
}
