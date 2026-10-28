export interface MigrationItem {
  name: string;
  sql: string;
}

export const EMBEDDED_MIGRATIONS: MigrationItem[] = [
  {
    name: '20261010154403_init',
    sql: `-- CreateTable
CREATE TABLE IF NOT EXISTS "routes" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "targetPort" INTEGER NOT NULL,
    "targetHost" TEXT NOT NULL DEFAULT '127.0.0.1',
    "tlsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customDomain" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "executable" TEXT NOT NULL,
    "port" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "autoStart" BOOLEAN NOT NULL DEFAULT true,
    "pid" INTEGER,
    "description" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "routes_subdomain_key" ON "routes"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "services_name_key" ON "services"("name");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_serviceId_fkey') THEN
        ALTER TABLE "routes" ADD CONSTRAINT "routes_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
`,
  },
  {
    name: '20261019155000_auth_security',
    sql: `-- CreateEnum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
        CREATE TYPE "Role" AS ENUM ('ROOT', 'ADMIN', 'OPERATOR', 'READ_ONLY');
    END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "userId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_logs_v2" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_userId_fkey') THEN
        ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_userId_fkey') THEN
        ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
`,
  },
  {
    name: '20261021183000_phase3_supervisor_limits',
    sql: `-- AlterTable
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "templateId" TEXT;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "maxMemoryMb" INTEGER;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "cpuLimitPct" INTEGER;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "restartPolicy" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "healthProbe" JSONB;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "envVars" TEXT;
`,
  },
  {
    name: '20261021191500_phase4_deploy_engine',
    sql: `-- CreateTable
CREATE TABLE IF NOT EXISTS "apps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'git',
    "repoUrl" TEXT,
    "branch" TEXT DEFAULT 'main',
    "runtime" TEXT NOT NULL DEFAULT 'node',
    "runtimeVersion" TEXT,
    "buildCommand" TEXT,
    "startCommand" TEXT,
    "port" INTEGER,
    "healthPath" TEXT DEFAULT '/health',
    "envVars" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "activeReleaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "releases" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "releaseNumber" INTEGER NOT NULL,
    "commitHash" TEXT,
    "port" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "releasePath" TEXT NOT NULL,
    "buildLogs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deployments" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "releaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "triggeredBy" TEXT DEFAULT 'user',
    "commitHash" TEXT,
    "error" TEXT,
    "logs" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "apps_slug_key" ON "apps"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "apps_port_key" ON "apps"("port");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "releases_appId_releaseNumber_key" ON "releases"("appId", "releaseNumber");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_activeReleaseId_fkey') THEN
        ALTER TABLE "apps" ADD CONSTRAINT "apps_activeReleaseId_fkey" FOREIGN KEY ("activeReleaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'releases_appId_fkey') THEN
        ALTER TABLE "releases" ADD CONSTRAINT "releases_appId_fkey" FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deployments_appId_fkey') THEN
        ALTER TABLE "deployments" ADD CONSTRAINT "deployments_appId_fkey" FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deployments_releaseId_fkey') THEN
        ALTER TABLE "deployments" ADD CONSTRAINT "deployments_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
`,
  },
  {
    name: '20261021200000_phase5_ingress_storage_media',
    sql: `-- AlterTable routes
ALTER TABLE "routes" ADD COLUMN IF NOT EXISTS "exposeLocal" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "routes" ADD COLUMN IF NOT EXISTS "exposeLan" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "routes" ADD COLUMN IF NOT EXISTS "exposeMesh" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable route_hosts
CREATE TABLE IF NOT EXISTS "route_hosts" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "isCustomDomain" BOOLEAN NOT NULL DEFAULT true,
    "tlsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable route_ports
CREATE TABLE IF NOT EXISTS "route_ports" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT,
    "listenPort" INTEGER NOT NULL,
    "targetPort" INTEGER NOT NULL,
    "targetHost" TEXT NOT NULL DEFAULT '127.0.0.1',
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "scope" TEXT NOT NULL DEFAULT 'LocalSubnet',
    "firewallRuleName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable storage_volumes
CREATE TABLE IF NOT EXISTS "storage_volumes" (
    "id" TEXT NOT NULL,
    "driveLetter" TEXT NOT NULL,
    "label" TEXT,
    "fileSystem" TEXT,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "freeBytes" BIGINT NOT NULL DEFAULT 0,
    "isSystemDrive" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'online',
    "lastScannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_volumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable service_mounts
CREATE TABLE IF NOT EXISTS "service_mounts" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT,
    "volumeId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "mountPath" TEXT NOT NULL,
    "quotaBytes" BIGINT,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_mounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable media_items
CREATE TABLE IF NOT EXISTS "media_items" (
    "id" TEXT NOT NULL,
    "library" TEXT NOT NULL DEFAULT 'photos',
    "relativePath" TEXT NOT NULL,
    "absolutePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mtime" TIMESTAMP(3) NOT NULL,
    "exifDate" TIMESTAMP(3),
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "thumbnailPath" TEXT,
    "sha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "route_hosts_hostname_key" ON "route_hosts"("hostname");
CREATE UNIQUE INDEX IF NOT EXISTS "route_ports_listenPort_key" ON "route_ports"("listenPort");
CREATE UNIQUE INDEX IF NOT EXISTS "storage_volumes_driveLetter_key" ON "storage_volumes"("driveLetter");
CREATE UNIQUE INDEX IF NOT EXISTS "media_items_library_relativePath_key" ON "media_items"("library", "relativePath");

-- AddForeignKeys
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_hosts_routeId_fkey') THEN
        ALTER TABLE "route_hosts" ADD CONSTRAINT "route_hosts_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_ports_serviceId_fkey') THEN
        ALTER TABLE "route_ports" ADD CONSTRAINT "route_ports_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_mounts_volumeId_fkey') THEN
        ALTER TABLE "service_mounts" ADD CONSTRAINT "service_mounts_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "storage_volumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_mounts_serviceId_fkey') THEN
        ALTER TABLE "service_mounts" ADD CONSTRAINT "service_mounts_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
`,
  },
  {
    name: '20261021223000_phase7_backup_alerts',
    sql: `-- Phase 7 Additive Migration: Backup Jobs and Observability Alert Rules

-- CreateTable backup_jobs
CREATE TABLE IF NOT EXISTS "backup_jobs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "archivePath" TEXT,
    "fileSizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "isEncrypted" BOOLEAN NOT NULL DEFAULT true,
    "components" JSONB,
    "metadata" JSONB,
    "error" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable alert_rules
CREATE TABLE IF NOT EXISTS "alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookUrl" TEXT,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable system_alerts
CREATE TABLE IF NOT EXISTS "system_alerts" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "backup_jobs_status_idx" ON "backup_jobs"("status");
CREATE INDEX IF NOT EXISTS "backup_jobs_createdAt_idx" ON "backup_jobs"("createdAt");
CREATE INDEX IF NOT EXISTS "alert_rules_metric_idx" ON "alert_rules"("metric");
CREATE INDEX IF NOT EXISTS "system_alerts_resolved_idx" ON "system_alerts"("resolved");
CREATE INDEX IF NOT EXISTS "system_alerts_createdAt_idx" ON "system_alerts"("createdAt");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_alerts_ruleId_fkey') THEN
        ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
`,
  },
];
