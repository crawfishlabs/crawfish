// ============================================================================
// Email Provisioning — Cloudflare Email Routing
// ============================================================================

import type { EmailConfig } from './types.js';

export interface EmailProvider {
  /** Provision an email address for the agent */
  provision(agentName: string, domain: string): Promise<string>;
  /** Check if email routing is configured */
  verify(address: string): Promise<boolean>;
}

/**
 * Cloudflare Email Routing provider.
 * Uses Cloudflare API to set up catch-all routing on a domain.
 * 
 * Prerequisites:
 * - Domain on Cloudflare
 * - Email Routing enabled
 * - CLOUDFLARE_API_TOKEN env var with Zone:Edit permissions
 * - CLOUDFLARE_ZONE_ID env var
 */
export class CloudflareEmailProvider implements EmailProvider {
  private apiToken: string;
  private zoneId: string;
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor() {
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    this.zoneId = process.env.CLOUDFLARE_ZONE_ID || '';
  }

  async provision(agentName: string, domain: string): Promise<string> {
    const address = `${agentName}@${domain}`;

    if (!this.apiToken || !this.zoneId) {
      // Return the address — assume routing is already configured manually
      console.log(
        `[email] Cloudflare API credentials not set. Assuming ${address} is already configured.`
      );
      return address;
    }

    // Create a routing rule for the specific address
    // In practice, a catch-all rule on the domain handles this
    const destinationEmail = process.env.CRAWFISH_DESTINATION_EMAIL;
    if (!destinationEmail) {
      console.log(`[email] No CRAWFISH_DESTINATION_EMAIL set. Using catch-all routing.`);
      return address;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/zones/${this.zoneId}/email/routing/rules`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            actions: [{ type: 'forward', value: [destinationEmail] }],
            matchers: [{ type: 'literal', field: 'to', value: address }],
            enabled: true,
            name: `Agent identity: ${agentName}`,
            priority: 10,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Cloudflare API error: ${response.status} ${err}`);
      }

      return address;
    } catch (error) {
      console.error(`[email] Failed to create routing rule:`, error);
      // Return address anyway — catch-all may handle it
      return address;
    }
  }

  async verify(address: string): Promise<boolean> {
    if (!this.apiToken || !this.zoneId) return true; // Assume configured

    try {
      const response = await fetch(
        `${this.baseUrl}/zones/${this.zoneId}/email/routing/rules`,
        {
          headers: { 'Authorization': `Bearer ${this.apiToken}` },
        }
      );
      if (!response.ok) return false;
      const data = await response.json() as any;
      // Check if there's a rule for this address or a catch-all
      const rules = data.result || [];
      return rules.some((r: any) =>
        r.matchers?.some((m: any) => m.value === address) ||
        r.matchers?.some((m: any) => m.type === 'all')
      );
    } catch {
      return false;
    }
  }
}

/** Get the appropriate email provider based on config */
export function getEmailProvider(config: EmailConfig): EmailProvider {
  switch (config.provider) {
    case 'cloudflare':
      return new CloudflareEmailProvider();
    default:
      throw new Error(`Unsupported email provider: ${config.provider}`);
  }
}
