import { exec } from 'child_process';
import util from 'util';
import { logger } from '../core/logger';

const execAsync = util.promisify(exec);

export class WindowsFirewallManager {
  /**
   * Adds an inbound Windows Firewall rule for a TCP or UDP port.
   */
  public async addInboundRule(params: {
    ruleName: string;
    port: number;
    protocol?: 'TCP' | 'UDP';
    scope?: 'LocalSubnet' | 'Tailscale' | 'Any';
  }): Promise<{ success: boolean; error?: string }> {
    const protocol = params.protocol || 'TCP';
    let remoteIpClause = '';

    if (params.scope === 'LocalSubnet') {
      remoteIpClause = 'remoteip=LocalSubnet';
    } else if (params.scope === 'Tailscale') {
      // Tailscale CGNAT subnet
      remoteIpClause = 'remoteip=100.64.0.0/10';
    }

    const cmd = `netsh advfirewall firewall add rule name="${params.ruleName}" dir=in action=allow protocol=${protocol} localport=${params.port} ${remoteIpClause}`.trim();

    try {
      await execAsync(cmd);
      logger.info('firewall', `Created inbound firewall rule "${params.ruleName}" for port ${params.port} (${protocol})`);
      return { success: true };
    } catch (err: any) {
      logger.warn('firewall', `Could not create firewall rule (may require elevation): ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Deletes an inbound Windows Firewall rule by name.
   */
  public async deleteInboundRule(ruleName: string): Promise<{ success: boolean; error?: string }> {
    const cmd = `netsh advfirewall firewall delete rule name="${ruleName}"`;

    try {
      await execAsync(cmd);
      logger.info('firewall', `Removed inbound firewall rule "${ruleName}"`);
      return { success: true };
    } catch (err: any) {
      logger.warn('firewall', `Could not remove firewall rule "${ruleName}": ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Checks if an inbound firewall rule exists.
   */
  public async hasRule(ruleName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`netsh advfirewall firewall show rule name="${ruleName}"`);
      return stdout.includes(ruleName);
    } catch {
      return false;
    }
  }
}

export const firewallManager = new WindowsFirewallManager();
