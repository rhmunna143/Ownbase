interface AttemptRecord {
  count: number;
  lastAttempt: number;
  lockedUntil?: number;
}

export class LoginThrottle {
  private ipAttempts: Map<string, AttemptRecord> = new Map();
  private userAttempts: Map<string, AttemptRecord> = new Map();
  private currentHashOps = 0;
  private readonly MAX_CONCURRENT_HASHES = 2; // Prevents CPU exhaustion

  /**
   * Enqueues or limits concurrent Argon2 hashing operations.
   */
  public async acquireHashSlot(): Promise<() => void> {
    while (this.currentHashOps >= this.MAX_CONCURRENT_HASHES) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.currentHashOps++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.currentHashOps = Math.max(0, this.currentHashOps - 1);
      }
    };
  }

  /**
   * Checks whether the IP or username is currently throttled or locked.
   * Returns { allowed: boolean; retryAfterSeconds?: number }
   */
  public check(ip: string, username: string): { allowed: boolean; retryAfterSeconds?: number } {
    const now = Date.now();

    // Check user lock
    const uRec = this.userAttempts.get(username.toLowerCase());
    if (uRec && uRec.lockedUntil && uRec.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((uRec.lockedUntil - now) / 1000),
      };
    }

    // Check IP lock
    const ipRec = this.ipAttempts.get(ip);
    if (ipRec && ipRec.lockedUntil && ipRec.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((ipRec.lockedUntil - now) / 1000),
      };
    }

    return { allowed: true };
  }

  /**
   * Records a failed login attempt for an IP and username.
   */
  public recordFailure(ip: string, username: string) {
    const now = Date.now();
    const cleanUser = username.toLowerCase();

    // Update username record
    const uRec = this.userAttempts.get(cleanUser) || { count: 0, lastAttempt: now };
    uRec.count++;
    uRec.lastAttempt = now;

    // After 5 attempts: 5s delay. After 10: 30s. After 20: 300s (5 min lock)
    if (uRec.count >= 20) {
      uRec.lockedUntil = now + 300000;
    } else if (uRec.count >= 10) {
      uRec.lockedUntil = now + 30000;
    } else if (uRec.count >= 5) {
      uRec.lockedUntil = now + 5000;
    }
    this.userAttempts.set(cleanUser, uRec);

    // Update IP record
    const ipRec = this.ipAttempts.get(ip) || { count: 0, lastAttempt: now };
    ipRec.count++;
    ipRec.lastAttempt = now;
    if (ipRec.count >= 20) {
      ipRec.lockedUntil = now + 300000;
    } else if (ipRec.count >= 10) {
      ipRec.lockedUntil = now + 30000;
    }
    this.ipAttempts.set(ip, ipRec);
  }

  /**
   * Clears attempts on successful authentication.
   */
  public recordSuccess(ip: string, username: string) {
    this.userAttempts.delete(username.toLowerCase());
    const ipRec = this.ipAttempts.get(ip);
    if (ipRec) {
      ipRec.count = Math.max(0, ipRec.count - 1);
      if (ipRec.count === 0) this.ipAttempts.delete(ip);
    }
  }
}

export const loginThrottle = new LoginThrottle();
