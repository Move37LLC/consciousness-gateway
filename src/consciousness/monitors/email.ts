/**
 * Email Monitor — Spatial perception of communications
 *
 * STUB: Ready for IMAP integration.
 * Requires EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD env vars.
 *
 * When connected, monitors:
 * - New unread emails
 * - Emails mentioning key topics (consciousness, gateway, AI)
 * - Response urgency estimation
 */

import { MonitorPlugin, SpatialPercept } from '../types';

export class EmailMonitor implements MonitorPlugin {
  readonly name = 'email';
  readonly channel = 'email';
  readonly pollInterval = 300; // Every 5 minutes

  private config: { host: string; port: number; user: string; password: string } | undefined;

  constructor(config?: { host: string; port: number; user: string; password: string }) {
    this.config = config ?? (
      process.env.EMAIL_HOST ? {
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT ?? '993'),
        user: process.env.EMAIL_USER ?? '',
        password: process.env.EMAIL_PASSWORD ?? '',
      } : undefined
    );
  }

  get available(): boolean {
    return !!(this.config?.host && this.config?.user && this.config?.password);
  }

  async init(): Promise<void> {
    // Will initialize IMAP connection when config is provided
  }

  async poll(): Promise<SpatialPercept[]> {
    if (!this.available) return [];

    // TODO: Implement IMAP polling
    // - Connect to IMAP server
    // - Check INBOX for unseen messages since last poll
    // - Extract sender, subject, snippet
    // - Compute salience based on sender importance + topic relevance

    return [];
  }

  async shutdown(): Promise<void> {
    // Close IMAP connection
  }
}
