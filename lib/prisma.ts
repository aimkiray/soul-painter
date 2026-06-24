import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  sqliteReady?: Promise<void>;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export function prepareDatabase() {
  if (!globalForPrisma.sqliteReady) {
    globalForPrisma.sqliteReady = (async () => {
      await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000').catch(() => undefined);
      await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL').catch(() => undefined);
    })();
  }
  return globalForPrisma.sqliteReady;
}
