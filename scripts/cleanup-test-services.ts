import { PrismaManager } from '../src/daemon/db/prisma';

async function main() {
  const prismaManager = new PrismaManager();
  const prisma = prismaManager.getClient();

  console.log('Inspecting database services and apps...');

  // 1. Find all services
  const allServices = await prisma.service.findMany({ include: { routes: true } });
  console.log(`Total services in DB: ${allServices.length}`);

  // Identify unwanted test services (Pipeline Test App, Rollback Test App, etc.)
  const testServices = allServices.filter(
    (s) =>
      s.name.startsWith('Pipeline Test App') ||
      s.name.startsWith('Rollback Test App') ||
      s.name.startsWith('Test App')
  );

  console.log(`Identified ${testServices.length} test services to remove.`);

  for (const s of testServices) {
    console.log(`Deleting test service: [${s.id}] ${s.name} (Port ${s.port})`);
    // Delete any routes attached
    if (s.routes && s.routes.length > 0) {
      await prisma.route.deleteMany({ where: { serviceId: s.id } });
    }
    await prisma.service.delete({ where: { id: s.id } });
  }

  // 2. Find and clean any test apps
  const allApps = await prisma.app.findMany();
  console.log(`Total apps in DB: ${allApps.length}`);
  const testApps = allApps.filter(
    (a) =>
      a.name.startsWith('Pipeline Test App') ||
      a.name.startsWith('Rollback Test App') ||
      a.name.startsWith('Test App')
  );
  for (const a of testApps) {
    console.log(`Deleting test app: [${a.id}] ${a.name}`);
    await prisma.app.delete({ where: { id: a.id } });
  }

  // 3. Print remaining clean services
  const remainingServices = await prisma.service.findMany({ include: { routes: true } });
  console.log(`\nRemaining production services (${remainingServices.length}):`);
  for (const s of remainingServices) {
    console.log(`- [${s.type.toUpperCase()}] ${s.name} (Port: ${s.port}, autoStart: ${s.autoStart}, status: ${s.status})`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
