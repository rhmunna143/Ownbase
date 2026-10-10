-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "targetPort" INTEGER NOT NULL,
    "targetHost" TEXT NOT NULL DEFAULT '127.0.0.1',
    "tlsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customDomain" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routes_subdomain_key" ON "routes"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
