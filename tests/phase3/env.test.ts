import { describe, it, expect } from 'vitest';
import { buildIsolatedEnvironment } from '../../src/daemon/supervisor/env';
import { secretsManager } from '../../src/daemon/core/secrets';

describe('Phase 3 - Item 3.7: Environment Isolation & Secret Decryption', () => {
  it('isolates environment to allowlisted variables only', async () => {
    // Set a dummy secret variable in process.env that should NOT leak
    process.env.INTERNAL_DAEMON_SECRET_KEY = 'super_secret_value_123';
    process.env.TEST_APP_DATA = 'some_data';

    const env = await buildIsolatedEnvironment({
      serviceEnv: { PORT: '8080', MY_APP_VAR: 'hello' },
    });

    // Verify allowlisted system variables are present
    expect(env.PATH !== undefined || env.Path !== undefined).toBe(true);

    // Verify non-allowlisted process.env variables did NOT leak
    expect(env.INTERNAL_DAEMON_SECRET_KEY).toBeUndefined();

    // Verify service-specific variables were merged
    expect(env.PORT).toBe('8080');
    expect(env.MY_APP_VAR).toBe('hello');

    delete process.env.INTERNAL_DAEMON_SECRET_KEY;
    delete process.env.TEST_APP_DATA;
  });

  it('decrypts encrypted environment variables JSON', async () => {
    const rawSecrets = {
      DATABASE_PASSWORD: 'secure_password_999',
      API_TOKEN: 'tok_live_456',
    };

    const encryptedJson = secretsManager.encrypt(JSON.stringify(rawSecrets));

    const env = await buildIsolatedEnvironment({
      encryptedEnvJson: encryptedJson,
      serviceEnv: { NODE_ENV: 'production' },
    });

    expect(env.DATABASE_PASSWORD).toBe('secure_password_999');
    expect(env.API_TOKEN).toBe('tok_live_456');
    expect(env.NODE_ENV).toBe('production');
  });

  it('gracefully handles corrupted encrypted environment json', async () => {
    const env = await buildIsolatedEnvironment({
      encryptedEnvJson: 'corrupted_ciphertext_not_valid',
      serviceEnv: { PORT: '3000' },
    });

    expect(env.PORT).toBe('3000');
  });
});
