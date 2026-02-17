// ============================================================================
// Notification Dispatcher — Alert human when agent needs approval
// ============================================================================

import type { Grant } from './grants.js';

export interface NotificationChannel {
  type: string;
  enabled: boolean;
  send(notification: Notification): Promise<void>;
}

export interface Notification {
  title: string;
  body: string;
  url?: string;
  grant?: Grant;
}

export interface NotificationConfig {
  channels: Array<{
    type: string;
    enabled: boolean;
    [key: string]: unknown;
  }>;
  on?: string[];
}

/**
 * Telegram notification via webhook.
 * In OpenClaw context, we POST to a webhook URL that the gateway handles.
 * Can also be configured to call the Telegram Bot API directly.
 */
export class TelegramNotifier implements NotificationChannel {
  type = 'telegram';
  enabled = true;
  private webhookUrl: string;
  private chatId: string;
  private botToken: string;

  constructor(opts?: { webhookUrl?: string; chatId?: string; botToken?: string }) {
    this.webhookUrl = opts?.webhookUrl || process.env.TELEGRAM_WEBHOOK_URL || '';
    this.chatId = opts?.chatId || process.env.TELEGRAM_CHAT_ID || '';
    this.botToken = opts?.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  async send(notification: Notification): Promise<void> {
    // Option 1: Direct Telegram Bot API
    if (this.botToken && this.chatId) {
      const text = `${notification.title}\n\n${notification.body}` +
        (notification.url ? `\n\n🔗 ${notification.url}` : '');

      await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
      return;
    }

    // Option 2: Webhook (OpenClaw integration)
    if (this.webhookUrl) {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });
      return;
    }

    console.log(`[notification:telegram] No credentials configured. Would send: ${notification.title}`);
  }
}

/**
 * Email notification via SMTP or transactional email API.
 * MVP: just log it. Production: use Resend, Postmark, or SES.
 */
export class EmailNotifier implements NotificationChannel {
  type = 'email';
  enabled = true;
  private to: string;

  constructor(opts?: { to?: string }) {
    this.to = opts?.to || process.env.CRAWFISH_OWNER_EMAIL || '';
  }

  async send(notification: Notification): Promise<void> {
    // MVP: log only. Add Resend/Postmark integration when needed.
    console.log(`[notification:email] To: ${this.to} | ${notification.title}`);
    console.log(`  ${notification.body}`);
    if (notification.url) console.log(`  Link: ${notification.url}`);
  }
}

/**
 * Webhook notification — POST to any URL.
 */
export class WebhookNotifier implements NotificationChannel {
  type = 'webhook';
  enabled = true;
  private url: string;

  constructor(opts: { url: string }) {
    this.url = opts.url;
  }

  async send(notification: Notification): Promise<void> {
    await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    });
  }
}

/**
 * Notification dispatcher — sends to all enabled channels.
 */
export class NotificationDispatcher {
  private channels: NotificationChannel[] = [];

  constructor(channels?: NotificationChannel[]) {
    if (channels) {
      this.channels = channels;
    }
  }

  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  async notify(notification: Notification): Promise<void> {
    const results = await Promise.allSettled(
      this.channels
        .filter(c => c.enabled)
        .map(c => c.send(notification))
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error(`[notification] Channel failed:`, r.reason);
      }
    }
  }

  /** Convenience: notify about a new grant request */
  async notifyGrantRequest(grant: Grant, dashboardUrl: string): Promise<void> {
    const scopeList = grant.scopes.length > 0 ? grant.scopes.join(', ') : 'default';
    await this.notify({
      title: '🔐 Agent Access Request',
      body: `**${grant.agent}** needs access to **${grant.service}**\n` +
        `Scopes: ${scopeList}\n` +
        (grant.reason ? `Reason: "${grant.reason}"\n` : '') +
        `\nTap to review and approve:`,
      url: `${dashboardUrl}/grants/${grant.id}`,
      grant,
    });
  }
}
