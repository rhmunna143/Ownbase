import { PrismaManager } from '../db/prisma';
import { logger } from '../core/logger';

export interface AuditEvent {
  actorId?: string;
  actorName?: string;
  action: string;
  entity?: string;
  entityId?: string;
  ipAddress?: string;
  status: 'success' | 'failure';
  details?: Record<string, any>;
}

export class AuditService {
  private prismaManager: PrismaManager;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
  }

  public async record(event: AuditEvent): Promise<void> {
    try {
      const client = this.prismaManager.getClient();
      await (client as any).auditLogV2.create({
        data: {
          actorId: event.actorId,
          actorName: event.actorName,
          action: event.action,
          entity: event.entity,
          entityId: event.entityId,
          ipAddress: event.ipAddress,
          status: event.status,
          details: event.details ? JSON.stringify(event.details) : undefined,
        },
      });
      logger.info('audit', `[${event.status.toUpperCase()}] ${event.action} by ${event.actorName || 'anonymous'}`);
    } catch (err: any) {
      logger.warn('audit', `Failed to record audit log: ${err.message}`);
    }
  }

  public async getRecentLogs(limit = 100) {
    try {
      const client = this.prismaManager.getClient();
      return await (client as any).auditLogV2.findMany({
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (err: any) {
      logger.warn('audit', `Failed to fetch audit logs: ${err.message}`);
      return [];
    }
  }
}
