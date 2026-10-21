-- AlterTable routes
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
