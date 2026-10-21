-- Phase 7 Additive Migration: Backup Jobs and Observability Alert Rules

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
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
