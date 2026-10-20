import { describe, it, expect } from 'vitest';
import { Logger } from '../../src/daemon/core/logger';
import { eventBus } from '../../src/daemon/core/events';

describe('Item 2.3 & P15: Structured Logger & Secret Redaction', () => {
  const loggerInstance = new Logger();

  it('redacts JWT tokens in log messages', () => {
    const rawJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const message = `User login verified with token: ${rawJwt}`;
    const redacted = loggerInstance.redactSecrets(message);

    expect(redacted).not.toContain(rawJwt);
    expect(redacted).toContain('[REDACTED_JWT]');
  });

  it('redacts Bearer tokens in log messages', () => {
    const msg = 'Incoming authorization header: Bearer abc123secrettoken456xyz==';
    const redacted = loggerInstance.redactSecrets(msg);
    expect(redacted).not.toContain('abc123secrettoken456xyz==');
    expect(redacted).toContain('Bearer [REDACTED_TOKEN]');
  });

  it('redacts database passwords in PostgreSQL URLs', () => {
    const dbUrl = 'postgresql://postgres:SuperSecretP@ssword123@127.0.0.1:5432/postgres?schema=public';
    const redacted = loggerInstance.redactSecrets(dbUrl);
    expect(redacted).not.toContain('SuperSecretP@ssword123');
    expect(redacted).toContain('postgresql://postgres:[REDACTED_DB_PASS]@127.0.0.1:5432/postgres?schema=public');
  });

  it('redacts password and apiKey fields in JSON strings', () => {
    const jsonStr = JSON.stringify({
      username: 'alice',
      password: 'PlainSecretPassword!',
      apiKey: 'ownbase_api_1234567890abcdef1234567890abcdef',
    });
    const redacted = loggerInstance.redactSecrets(jsonStr);

    expect(redacted).not.toContain('PlainSecretPassword!');
    expect(redacted).not.toContain('ownbase_api_1234567890abcdef1234567890abcdef');
    expect(redacted).toContain('[REDACTED]');
  });

  it('publishes log events to the daemon event bus', () => {
    let capturedEvent: any = null;
    const unsubscribe = (event: any) => {
      if (event.source === 'test-source') {
        capturedEvent = event;
      }
    };

    eventBus.on('log', unsubscribe);
    loggerInstance.info('test-source' as any, 'Testing event publication');
    eventBus.off('log', unsubscribe);

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent.message).toBe('Testing event publication');
    expect(capturedEvent.level).toBe('info');
  });
});
