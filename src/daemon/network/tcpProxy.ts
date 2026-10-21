import net from 'net';
import { logger } from '../core/logger';
import { firewallManager } from './firewall';

export interface TcpProxyConfig {
  id?: string;
  listenPort: number;
  targetPort: number;
  targetHost?: string;
  scope?: 'LocalSubnet' | 'Tailscale' | 'Any';
  ruleName?: string;
}

export interface ActiveTcpListener {
  server: net.Server;
  listenPort: number;
  targetPort: number;
  targetHost: string;
  ruleName: string;
  activeConnections: number;
}

export class TcpProxyManager {
  private activeListeners = new Map<number, ActiveTcpListener>();

  /**
   * Starts a direct TCP forwarder listening on 0.0.0.0:<listenPort> forwarding to <targetHost>:<targetPort>.
   */
  public async startProxy(config: TcpProxyConfig): Promise<ActiveTcpListener> {
    const { listenPort, targetPort } = config;
    const targetHost = config.targetHost || '127.0.0.1';
    const ruleName = config.ruleName || `Ownbase_TCP_${listenPort}`;

    if (this.activeListeners.has(listenPort)) {
      throw new Error(`TCP forwarder is already active on port ${listenPort}`);
    }

    const listener: ActiveTcpListener = {
      server: null as any,
      listenPort,
      targetPort,
      targetHost,
      ruleName,
      activeConnections: 0,
    };

    const server = net.createServer((clientSocket) => {
      listener.activeConnections++;

      const targetSocket = net.createConnection(
        {
          host: targetHost,
          port: targetPort,
        },
        () => {
          clientSocket.pipe(targetSocket);
          targetSocket.pipe(clientSocket);
        }
      );

      const cleanup = () => {
        listener.activeConnections = Math.max(0, listener.activeConnections - 1);
        clientSocket.destroy();
        targetSocket.destroy();
      };

      clientSocket.on('error', (err) => {
        logger.debug('tcp-proxy', `Client connection error on port ${listenPort}: ${err.message}`);
        cleanup();
      });

      targetSocket.on('error', (err) => {
        logger.debug('tcp-proxy', `Target connection error on ${targetHost}:${targetPort}: ${err.message}`);
        cleanup();
      });

      clientSocket.on('close', cleanup);
      targetSocket.on('close', cleanup);
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(listenPort, '0.0.0.0', () => {
        logger.info(
          'tcp-proxy',
          `Direct TCP proxy listening on 0.0.0.0:${listenPort} -> ${targetHost}:${targetPort}`
        );
        resolve();
      });

      server.on('error', (err) => {
        reject(new Error(`Failed to bind TCP proxy to port ${listenPort}: ${err.message}`));
      });
    });

    listener.server = server;
    this.activeListeners.set(listenPort, listener);

    // Add Windows Firewall rule
    await firewallManager.addInboundRule({
      ruleName,
      port: listenPort,
      protocol: 'TCP',
      scope: config.scope || 'LocalSubnet',
    });

    return listener;
  }

  /**
   * Stops an active TCP proxy and deletes the firewall rule.
   */
  public async stopProxy(listenPort: number): Promise<boolean> {
    const listener = this.activeListeners.get(listenPort);
    if (!listener) return false;

    await new Promise<void>((resolve) => {
      listener.server.close(() => {
        resolve();
      });
    });

    this.activeListeners.delete(listenPort);

    // Remove firewall rule
    await firewallManager.deleteInboundRule(listener.ruleName);
    logger.info('tcp-proxy', `Stopped direct TCP proxy on port ${listenPort}`);

    return true;
  }

  /**
   * Stops all active TCP forwarders.
   */
  public async stopAll(): Promise<void> {
    const ports = Array.from(this.activeListeners.keys());
    for (const port of ports) {
      await this.stopProxy(port);
    }
  }

  public getActiveListeners(): Array<{
    listenPort: number;
    targetPort: number;
    targetHost: string;
    activeConnections: number;
    ruleName: string;
  }> {
    return Array.from(this.activeListeners.values()).map((l) => ({
      listenPort: l.listenPort,
      targetPort: l.targetPort,
      targetHost: l.targetHost,
      activeConnections: l.activeConnections,
      ruleName: l.ruleName,
    }));
  }
}

export const tcpProxyManager = new TcpProxyManager();
