-- CreateTable
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
ALTER TABLE "apps" ADD CONSTRAINT "apps_activeReleaseId_fkey" FOREIGN KEY ("activeReleaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_appId_fkey" FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_appId_fkey" FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
