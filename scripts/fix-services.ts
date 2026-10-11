import { PrismaClient } from '@prisma/client';

async function fixServices() {
  const prisma = new PrismaClient();
  
  console.log('Cleaning up duplicate and invalid services in database...');
  
  // 1. Delete duplicate 'yy' service
  const deletedYy = await prisma.service.deleteMany({
    where: { name: 'yy' },
  });
  console.log(`Deleted ${deletedYy.count} duplicate 'yy' services.`);

  // 2. Ensure FileBrowser Storage is configured properly with autoStart: true
  await prisma.service.updateMany({
    where: { type: 'filebrowser' },
    data: { autoStart: true, status: 'stopped', pid: null },
  });

  // 3. Ensure Ollama AI Engine has autoStart: true
  await prisma.service.updateMany({
    where: { type: 'ollama' },
    data: { autoStart: true, status: 'stopped', pid: null },
  });

  // 4. Ensure Caddy has autoStart: true
  await prisma.service.updateMany({
    where: { type: 'caddy' },
    data: { autoStart: true },
  });

  // 5. Update or clean up minio
  await prisma.service.updateMany({
    where: { type: 'minio' },
    data: { autoStart: false, status: 'stopped', pid: null },
  });

  const all = await prisma.service.findMany({ include: { routes: true } });
  console.log('Current clean services:');
  for (const s of all) {
    console.log(`- [${s.type.toUpperCase()}] ${s.name} (autoStart: ${s.autoStart}, port: ${s.port}, routes: ${s.routes.length})`);
  }

  await prisma.$disconnect();
}

fixServices().catch(console.error);
