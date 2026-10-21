import { describe, it, expect, beforeEach } from 'vitest';
import net from 'net';
import { PortAllocator, MIN_ALLOCATION_PORT, MAX_ALLOCATION_PORT } from '../../src/daemon/deploy/ports';

describe('Phase 4 - Item 4.5 & A6: Deterministic Port Allocator', () => {
  let allocator: PortAllocator;

  beforeEach(() => {
    // Isolated range for fast, deterministic unit testing
    allocator = new PortAllocator(4100, 4120);
  });

  it('allocates the first available port in range', async () => {
    const port = await allocator.allocatePort();
    expect(port).toBeGreaterThanOrEqual(4100);
    expect(port).toBeLessThanOrEqual(4120);
    expect(allocator.getReservedPorts()).toContain(port);
  });

  it('allocates sequential unique ports on repeated calls', async () => {
    const p1 = await allocator.allocatePort();
    const p2 = await allocator.allocatePort();
    const p3 = await allocator.allocatePort();

    expect(p1).not.toBe(p2);
    expect(p2).not.toBe(p3);
    expect(p1).not.toBe(p3);
    expect(allocator.getReservedPorts().length).toBe(3);
  });

  it('respects valid preferredPort when available', async () => {
    const preferred = 4115;
    const port = await allocator.allocatePort(preferred);
    expect(port).toBe(preferred);
  });

  it('releases allocated ports properly for re-use', async () => {
    const port = await allocator.allocatePort(4105);
    expect(port).toBe(4105);

    allocator.releasePort(port);
    expect(allocator.getReservedPorts()).not.toContain(port);

    const reallocated = await allocator.allocatePort(4105);
    expect(reallocated).toBe(4105);
  });

  it('detects live TCP binding and skips ports already listening', async () => {
    // Open a real listening TCP server on port 4102
    const occupiedServer = net.createServer();
    await new Promise<void>((resolve) => {
      occupiedServer.listen(4102, '127.0.0.1', () => resolve());
    });

    try {
      // Allocate 4102 as preferred; should detect collision and allocate another port
      const allocated = await allocator.allocatePort(4102);
      expect(allocated).not.toBe(4102);
      expect(allocated).toBeGreaterThanOrEqual(4100);
    } finally {
      await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
    }
  });

  it('handles 20 parallel concurrent allocation requests without collisions (A6)', async () => {
    const wideAllocator = new PortAllocator(4200, 4250);
    const promises = Array.from({ length: 20 }, () => wideAllocator.allocatePort());
    const allocated = await Promise.all(promises);

    expect(allocated.length).toBe(20);
    const unique = new Set(allocated);
    expect(unique.size).toBe(20);
  });

  it('throws an error when all ports in range are exhausted', async () => {
    const tinyAllocator = new PortAllocator(4300, 4301);
    const p1 = await tinyAllocator.allocatePort();
    const p2 = await tinyAllocator.allocatePort();

    expect(p1).toBe(4300);
    expect(p2).toBe(4301);

    await expect(tinyAllocator.allocatePort()).rejects.toThrow(/Port allocator exhausted/);
  });
});
