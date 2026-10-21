import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import { EventStreamGateway } from '../../src/daemon/gateway/events';
import { eventBus } from '../../src/daemon/core/events';

describe('Phase 3 - Item 3.11: Event Stream Gateway (/api/v1/events)', () => {
  it('delivers connection event and snapshot on connection', async () => {
    const mockAuthService: any = {
      verifyAccessToken: vi.fn().mockResolvedValue({ id: 'u1', username: 'admin' }),
    };

    const mockSupervisor: any = {
      getAllStatuses: vi.fn().mockReturnValue({
        'svc-1': { status: 'running', name: 'Mock Svc' },
      }),
    };

    const mockPostgres: any = {
      getStatus: vi.fn().mockReturnValue({ state: 'running', port: 5432 }),
    };

    const gateway = new EventStreamGateway({
      authService: mockAuthService,
      supervisor: mockSupervisor,
      postgres: mockPostgres,
    });

    const writtenChunks: string[] = [];
    const mockRes: any = {
      writeHead: vi.fn(),
      write: vi.fn().mockImplementation((chunk) => {
        writtenChunks.push(chunk);
      }),
      end: vi.fn(),
    };

    const mockReq: any = {
      url: '/api/v1/events?token=valid_token',
      headers: { host: '127.0.0.1:3001' },
      on: vi.fn(),
    };

    await gateway.handleEventStream(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'text/event-stream' })
    );

    // Verify first event is connected
    expect(writtenChunks[0]).toContain('"type":"connected"');

    // Verify second event is snapshot with services and postgres
    expect(writtenChunks[1]).toContain('"type":"snapshot"');
    expect(writtenChunks[1]).toContain('Mock Svc');
    expect(writtenChunks[1]).toContain('5432');
  });

  it('rejects connection when token is invalid', async () => {
    const mockAuthService: any = {
      verifyAccessToken: vi.fn().mockResolvedValue(null),
    };

    const gateway = new EventStreamGateway({
      authService: mockAuthService,
      supervisor: {} as any,
      postgres: {} as any,
    });

    const mockRes: any = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    const mockReq: any = {
      url: '/api/v1/events?token=bad_token',
      headers: { host: '127.0.0.1:3001' },
      on: vi.fn(),
    };

    await gateway.handleEventStream(mockReq, mockRes);
    expect(mockRes.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
  });
});
