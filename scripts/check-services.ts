import { PrismaManager } from '../src/daemon/db/prisma';

async function main() {
  const prismaManager = new PrismaManager();
  const prisma = prismaManager.getClient();
  const services = await prisma.service.findMany({ include: { routes: true } });
  console.log(`Found ${services.length} services:`);
  for (const s of services) {
    console.log(`- ID: ${s.id} | Name: "${s.name}" | Type: "${s.type}" | Template: "${s.templateId}" | Port: ${s.port} | AutoStart: ${s.autoStart} | Status: ${s.status}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
