/**
 * Twitter Monitor — Spatial perception of social discourse
 *
 * STUB: Ready for Twitter/X API v2 integration.
 * Requires TWITTER_BEARER_TOKEN environment variable.
 *
 * When connected, monitors:
 * - Mentions of configured accounts
 * - Replies to tweets
 * - Follower changes
 * - Trending topics in AI/consciousness space
 */

import { MonitorPlugin, SpatialPercept } from '../types';

export class TwitterMonitor implements MonitorPlugin {
  readonly name = 'twitter';
  readonly channel = 'twitter';
  readonly pollInterval = 120; // Every 2 minutes

  private token: string | undefined;

  constructor(token?: string) {
    this.token = token ?? process.env.TWITTER_BEARER_TOKEN;
  }

  get available(): boolean {
    return !!this.token;
  }

  async init(): Promise<void> {
    // Will initialize Twitter API v2 client when token is provided
  }

  async poll(): Promise<SpatialPercept[]> {
    if (!this.available) return [];

    // TODO: Implement Twitter API v2 polling
    // - GET /2/users/:id/mentions
    // - GET /2/users/:id/followers (count changes)
    // - GET /2/tweets/search/recent?query=consciousness+AI

    return [];
  }

  async shutdown(): Promise<void> {
    // Cleanup
  }
}
