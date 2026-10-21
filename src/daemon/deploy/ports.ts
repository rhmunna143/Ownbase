import net from 'net';
import { prismaManager } from '../db/prisma';
import { logger } from '../core/logger';

export const MIN_ALLOCATION_PORT = 4000;
export const MAX_ALLOCATION_PORT = 4999;

export class PortAllocator {
  private reservedPorts = new Set<number>();
  private mutex: Promise<void> = Promise.resolve();

  constructor(
    private minPort = MIN_ALLOCATION_PORT,
    private maxPort = MAX_ALLOCATION_PORT
  ) {}

  /**
   * Run an asynchronous operation exclusively with in-memory lock
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let unlock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    const previousMutex = this.mutex;
    this.mutex = lockPromise;

    await previousMutex;
    try {
      return await fn();
    } finally {
      unlock();
    }
  }

  /**
   * Actively probe if a TCP port can be bound on 127.0.0.1
   */
  public async probePortBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });

      try {
        server.listen({
          port,
          host: '127.0.0.1',
          exclusive: true,
        });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Check if a port is currently listening (active service probe)
   */
  public async isPortListening(port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(true);
        }
      });

      socket.on('timeout', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.on('error', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.connect(port, '127.0.0.1');
    });
  }

  /**
   * Retrieve all ports registered in PostgreSQL (Services, Apps, Releases)
   */
  private async getDatabaseClaimedPorts(): Promise<Set<number>> {
    const claimed = new Set<number>();

    try {
      const client = prismaManager.getClient();

      const [services, apps, releases] = await Promise.all([
        client.service.findMany({
          where: { port: { not: null } },
          select: { port: true },
        }),
        client.app.findMany({
          where: { port: { not: null } },
          select: { port: true },
        }),
        client.release.findMany({
          where: { status: { in: ['healthy', 'building'] } },
          select: { port: true },
        }),
      ]);

      for (const s of services) {
        if (s.port) claimed.add(s.port);
      }
      for (const a of apps) {
        if (a.port) claimed.add(a.port);
      }
      for (const r of releases) {
        if (r.port) claimed.add(r.port);
      }
    } catch (err: any) {
      // In tests or offline mode, continue with in-memory set
      logger.warn('port-allocator', `Database port query notice: ${err.message}`);
    }

    return claimed;
  }

  /**
   * Allocate a deterministic, verified port in 4000-4999 range.
   * Concurrency-safe: serialized through an in-memory mutex.
   */
  public async allocatePort(preferredPort?: number): Promise<number> {
    return this.withLock(async () => {
      const dbClaimed = await this.getDatabaseClaimedPorts();

      // If preferred port requested and valid
      if (
        preferredPort &&
        preferredPort >= this.minPort &&
        preferredPort <= this.maxPort &&
        !this.reservedPorts.has(preferredPort) &&
        !dbClaimed.has(preferredPort)
      ) {
        const canBind = await this.probePortBind(preferredPort);
        if (canBind) {
          this.reservedPorts.add(preferredPort);
          logger.info('port-allocator', `Allocated preferred port ${preferredPort}`);
          return preferredPort;
        }
      }

      // Scan through allocation range
      for (let port = this.minPort; port <= this.maxPort; port++) {
        if (this.reservedPorts.has(port) || dbClaimed.has(port)) {
          continue;
        }

        const canBind = await this.probePortBind(port);
        if (canBind) {
          this.reservedPorts.add(port);
          logger.info('port-allocator', `Allocated free port ${port}`);
          return port;
        }
      }

      throw new Error(`Port allocator exhausted: no free ports available between ${this.minPort} and ${this.maxPort}`);
    });
  }

  /**
   * Release a previously allocated or reserved port
   */
  public releasePort(port: number): void {
    if (this.reservedPorts.has(port)) {
      this.reservedPorts.delete(port);
      logger.info('port-allocator', `Released port ${port}`);
    }
  }

  /**
   * Mark a port as reserved explicitly (e.g. from existing deployment)
   */
  public reservePort(port: number): void {
    this.reservedPorts.add(port);
  }

  /**
   * Get all currently reserved ports in-memory
   */
  public getReservedPorts(): number[] {
    return Array.from(this.reservedPorts);
  }
}

export const portAllocator = new PortAllocator();
