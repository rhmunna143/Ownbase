import os from 'os';
import http from 'http';
import https from 'https';
import { logger } from '../core/logger';
import { PrismaManager } from '../db/prisma';
import { ProcessSupervisor } from '../supervisor/supervisor';
import { volumeManager } from '../storage/volumes';

export interface AlertRuleRecord {
  id: string;
  name: string;
  metric: 'service_status' | 'disk_usage' | 'backup_status' | 'database_status';
  condition: 'equals' | 'greater_than' | 'less_than';
  threshold: string;
  severity: 'info' | 'warning' | 'critical';
  isEnabled: boolean;
  webhookUrl?: string | null;
  lastTriggeredAt?: Date | null;
}

export interface SystemAlertRecord {
  id: string;
  ruleId?: string | null;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  resolved: boolean;
  resolvedAt?: Date | null;
  createdAt: Date;
}

export class AlertManager {
  private prismaManager: PrismaManager;
  private supervisor: ProcessSupervisor;
  private evaluationInterval?: NodeJS.Timeout;

  constructor(prismaManager: PrismaManager, supervisor: ProcessSupervisor, autoStart = true) {
    this.prismaManager = prismaManager;
    this.supervisor = supervisor;

    if (autoStart) {
      this.seedDefaultRules().catch(() => {});
      this.evaluationInterval = setInterval(() => {
        this.evaluateRules().catch(() => {});
      }, 30000);
    }
  }

  public stop() {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = undefined;
    }
  }

  public async seedDefaultRules(): Promise<void> {
    const prisma = this.prismaManager.getClient();
    if (!(prisma as any).alertRule) return;

    const defaultRules = [
      {
        name: 'Supervised Service Circuit Breaker Tripped',
        metric: 'service_status',
        condition: 'equals',
        threshold: 'failed',
        severity: 'critical',
        isEnabled: true,
      },
      {
        name: 'Storage Volume Capacity Threshold (90%)',
        metric: 'disk_usage',
        condition: 'greater_than',
        threshold: '90',
        severity: 'warning',
        isEnabled: true,
      },
      {
        name: 'Automated Backup Failure',
        metric: 'backup_status',
        condition: 'equals',
        threshold: 'failed',
        severity: 'warning',
        isEnabled: true,
      },
    ];

    for (const rule of defaultRules) {
      try {
        const existing = await (prisma as any).alertRule.findFirst({
          where: { metric: rule.metric, threshold: rule.threshold },
        });
        if (!existing) {
          await (prisma as any).alertRule.create({ data: rule });
        }
      } catch {}
    }
  }

  public async evaluateRules(): Promise<SystemAlertRecord[]> {
    const prisma = this.prismaManager.getClient();
    if (!(prisma as any).alertRule) return [];

    const triggeredAlerts: SystemAlertRecord[] = [];

    try {
      const rules: AlertRuleRecord[] = await (prisma as any).alertRule.findMany({
        where: { isEnabled: true },
      });

      for (const rule of rules) {
        if (rule.metric === 'service_status') {
          const statuses = this.supervisor.getAllStatuses();
          for (const [svcName, s] of Object.entries(statuses)) {
            const stat = s as any;
            if (stat.state === rule.threshold) {
              const title = `Service "${svcName}" entered ${stat.state} state`;
              const message = `Service "${svcName}" failed health checks or exceeded crash threshold (Circuit breaker tripped).`;
              const alert = await this.triggerAlert(rule, title, message);
              if (alert) triggeredAlerts.push(alert);
            }
          }
        } else if (rule.metric === 'disk_usage') {
          const volumes = volumeManager.getCachedVolumes();
          const thresholdPct = parseFloat(rule.threshold) || 90;

          for (const v of volumes) {
            const total = Number(v.totalBytes);
            const free = Number(v.freeBytes);
            if (total > 0) {
              const usedPct = ((total - free) / total) * 100;
              if (usedPct >= thresholdPct) {
                const title = `Storage Volume ${v.driveLetter}: Exceeds ${thresholdPct}% Usage`;
                const message = `Volume ${v.driveLetter}: is at ${usedPct.toFixed(1)}% capacity. Consider freeing space or moving data mounts.`;
                const alert = await this.triggerAlert(rule, title, message);
                if (alert) triggeredAlerts.push(alert);
              }
            }
          }
        } else if (rule.metric === 'backup_status') {
          if ((prisma as any).backupJob) {
            const latestFailedJob = await (prisma as any).backupJob.findFirst({
              where: { status: 'failed' },
              orderBy: { createdAt: 'desc' },
            });

            if (latestFailedJob) {
              // Only alert if failed within the last 1 hour
              const oneHourAgo = new Date(Date.now() - 3600000);
              if (latestFailedJob.createdAt > oneHourAgo) {
                const title = `Backup Job "${latestFailedJob.name}" Failed`;
                const message = `Automated backup failed: ${latestFailedJob.error || 'Unknown error'}.`;
                const alert = await this.triggerAlert(rule, title, message);
                if (alert) triggeredAlerts.push(alert);
              }
            }
          }
        }
      }
    } catch (err: any) {
      logger.warn('alerts', `Error during alert rule evaluation: ${err.message}`);
    }

    return triggeredAlerts;
  }

  public async triggerAlert(
    rule: AlertRuleRecord,
    title: string,
    message: string
  ): Promise<SystemAlertRecord | null> {
    const prisma = this.prismaManager.getClient();
    if (!(prisma as any).systemAlert) return null;

    // Check if an unresolved alert with the same title already exists
    const existing = await (prisma as any).systemAlert.findFirst({
      where: {
        title,
        resolved: false,
      },
    });

    if (existing) {
      return null; // De-duplicate active alerts
    }

    // Create system alert
    const alert = await (prisma as any).systemAlert.create({
      data: {
        ruleId: rule.id,
        title,
        message,
        severity: rule.severity,
        resolved: false,
      },
    });

    // Update rule lastTriggeredAt
    await (prisma as any).alertRule
      .update({
        where: { id: rule.id },
        data: { lastTriggeredAt: new Date() },
      })
      .catch(() => {});

    logger.warn('alerts', `[ALERT TRIGGERED: ${rule.severity.toUpperCase()}] ${title}: ${message}`);

    // Dispatch webhook if configured
    if (rule.webhookUrl) {
      this.dispatchWebhook(rule.webhookUrl, alert).catch((err) => {
        logger.warn('alerts', `Webhook dispatch failure (${rule.webhookUrl}): ${err.message}`);
      });
    }

    return alert;
  }

  public async dispatchWebhook(webhookUrl: string, alert: any): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const payload = JSON.stringify({
          event: 'alert.triggered',
          timestamp: new Date().toISOString(),
          system: {
            hostname: os.hostname(),
            platform: os.platform(),
            version: '1.0.0',
          },
          alert: {
            id: alert.id,
            title: alert.title,
            message: alert.message,
            severity: alert.severity,
            createdAt: alert.createdAt,
          },
        });

        const url = new URL(webhookUrl);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;

        const req = client.request(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'User-Agent': 'Ownbase-Alert-Dispatcher/1.0',
            },
            timeout: 5000,
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false);
          }
        );

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.write(payload);
        req.end();
      } catch {
        resolve(false);
      }
    });
  }

  public async getAlerts(): Promise<{ rules: AlertRuleRecord[]; activeAlerts: SystemAlertRecord[]; resolvedAlerts: SystemAlertRecord[] }> {
    const prisma = this.prismaManager.getClient();
    if (!(prisma as any).alertRule || !(prisma as any).systemAlert) {
      return { rules: [], activeAlerts: [], resolvedAlerts: [] };
    }

    const [rules, activeAlerts, resolvedAlerts] = await Promise.all([
      (prisma as any).alertRule.findMany({ orderBy: { createdAt: 'desc' } }),
      (prisma as any).systemAlert.findMany({
        where: { resolved: false },
        orderBy: { createdAt: 'desc' },
      }),
      (prisma as any).systemAlert.findMany({
        where: { resolved: true },
        take: 20,
        orderBy: { resolvedAt: 'desc' },
      }),
    ]);

    return { rules, activeAlerts, resolvedAlerts };
  }

  public async resolveAlert(id: string): Promise<boolean> {
    const prisma = this.prismaManager.getClient();
    if (!(prisma as any).systemAlert) return false;

    try {
      await (prisma as any).systemAlert.update({
        where: { id },
        data: {
          resolved: true,
          resolvedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  public async createOrUpdateRule(data: Partial<AlertRuleRecord>): Promise<any> {
    const prisma = this.prismaManager.getClient();
    if (!(prisma as any).alertRule) return null;

    if (data.id) {
      return await (prisma as any).alertRule.update({
        where: { id: data.id },
        data,
      });
    }

    return await (prisma as any).alertRule.create({
      data: {
        name: data.name || 'Custom Alert Rule',
        metric: data.metric || 'service_status',
        condition: data.condition || 'equals',
        threshold: data.threshold || 'failed',
        severity: data.severity || 'warning',
        isEnabled: data.isEnabled ?? true,
        webhookUrl: data.webhookUrl || null,
      },
    });
  }
}
