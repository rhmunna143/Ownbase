import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const services = await prisma.service.findMany({ include: { routes: true } });
  console.log(JSON.stringify(services, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
