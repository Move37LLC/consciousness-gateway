/**
 * GitHub Monitor — Spatial perception of the code world
 *
 * Watches repositories for:
 * - New issues and comments
 * - Pull requests
 * - Stars and forks
 * - Commits and pushes
 * - Notifications
 *
 * Uses GitHub REST API v3. Requires a PAT (Personal Access Token)
 * set via GITHUB_TOKEN environment variable.
 *
 * Poll interval: every 60 ticks (1 minute) to respect rate limits.
 * GitHub API rate limit: 5000 requests/hour with PAT.
 */

import { MonitorPlugin, SpatialPercept } from '../types';

interface GitHubEvent {
  id: string;
  type: string;
  actor: { login: string };
  repo: { name: string };
  payload: Record<string, any>;
  created_at: string;
}

interface RepoStats {
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
}

export class GitHubMonitor implements MonitorPlugin {
  readonly name = 'github';
  readonly channel = 'github';
  readonly pollInterval = 60; // Every 60 ticks = ~1 minute

  private token: string | undefined;
  private repos: string[];
  private lastEventIds = new Map<string, string>();
  private lastStats = new Map<string, RepoStats>();
  private baseUrl = 'https://api.github.com';

  constructor(repos: string[], token?: string) {
    this.repos = repos;
    this.token = token ?? process.env.GITHUB_TOKEN;
  }

  get available(): boolean {
    return !!this.token;
  }

  async init(): Promise<void> {
    if (!this.available) return;

    // Seed initial state so first poll shows only new events
    for (const repo of this.repos) {
      try {
        const stats = await this.fetchRepoStats(repo);
        if (stats) this.lastStats.set(repo, stats);

        const events = await this.fetchRepoEvents(repo);
        if (events.length > 0) {
          this.lastEventIds.set(repo, events[0].id);
        }
      } catch {
        // Non-fatal: will retry on next poll
      }
    }
  }

  async poll(): Promise<SpatialPercept[]> {
    if (!this.available) return [];

    const percepts: SpatialPercept[] = [];

    for (const repo of this.repos) {
      try {
        // Check for new events
        const newEvents = await this.getNewEvents(repo);
        for (const event of newEvents) {
          percepts.push(this.eventToPercept(repo, event));
        }

        // Check for stat changes (stars, forks, issues)
        const statChanges = await this.getStatChanges(repo);
        if (statChanges) {
          percepts.push(statChanges);
        }
      } catch {
        // Non-fatal: skip this repo this cycle
      }
    }

    return percepts;
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }

  // ─── Private Methods ─────────────────────────────────────────────

  private async fetchJSON<T>(url: string): Promise<T | null> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'consciousness-gateway/0.1.0',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    }
  }

  private async fetchRepoStats(repo: string): Promise<RepoStats | null> {
    return this.fetchJSON<RepoStats>(`${this.baseUrl}/repos/${repo}`);
  }

  private async fetchRepoEvents(repo: string): Promise<GitHubEvent[]> {
    return await this.fetchJSON<GitHubEvent[]>(
      `${this.baseUrl}/repos/${repo}/events?per_page=10`
    ) ?? [];
  }

  private async getNewEvents(repo: string): Promise<GitHubEvent[]> {
    const events = await this.fetchRepoEvents(repo);
    const lastId = this.lastEventIds.get(repo);

    if (!lastId) {
      // First poll — store latest and return nothing (avoid flood)
      if (events.length > 0) this.lastEventIds.set(repo, events[0].id);
      return [];
    }

    const newEvents: GitHubEvent[] = [];
    for (const event of events) {
      if (event.id === lastId) break;
      newEvents.push(event);
    }

    if (newEvents.length > 0) {
      this.lastEventIds.set(repo, newEvents[0].id);
    }

    return newEvents;
  }

  private async getStatChanges(repo: string): Promise<SpatialPercept | null> {
    const current = await this.fetchRepoStats(repo);
    if (!current) return null;

    const previous = this.lastStats.get(repo);
    this.lastStats.set(repo, current);

    if (!previous) return null;

    const changes: Record<string, number> = {};
    let changed = false;

    if (current.stargazers_count !== previous.stargazers_count) {
      changes.starsDelta = current.stargazers_count - previous.stargazers_count;
      changed = true;
    }
    if (current.forks_count !== previous.forks_count) {
      changes.forksDelta = current.forks_count - previous.forks_count;
      changed = true;
    }
    if (current.open_issues_count !== previous.open_issues_count) {
      changes.issuesDelta = current.open_issues_count - previous.open_issues_count;
      changed = true;
    }

    if (!changed) return null;

    const salience = Math.min(
      (Math.abs(changes.starsDelta ?? 0) * 0.3 +
       Math.abs(changes.forksDelta ?? 0) * 0.2 +
       Math.abs(changes.issuesDelta ?? 0) * 0.1),
      1.0
    );

    return {
      source: 'github',
      channel: `github:${repo}:stats`,
      data: {
        repo,
        current,
        changes,
        event: 'stat_change',
      },
      salience,
      features: this.statsToFeatures(current, changes),
      timestamp: Date.now(),
    };
  }

  private eventToPercept(repo: string, event: GitHubEvent): SpatialPercept {
    const salience = this.computeEventSalience(event);

    return {
      source: 'github',
      channel: `github:${repo}:${event.type}`,
      data: {
        repo,
        eventType: event.type,
        actor: event.actor.login,
        payload: this.summarizePayload(event),
        createdAt: event.created_at,
      },
      salience,
      features: this.eventToFeatures(event),
      timestamp: new Date(event.created_at).getTime(),
    };
  }

  private computeEventSalience(event: GitHubEvent): number {
    // Different event types have different importance
    const salienceMap: Record<string, number> = {
      'IssuesEvent': 0.7,
      'IssueCommentEvent': 0.5,
      'PullRequestEvent': 0.8,
      'PullRequestReviewEvent': 0.6,
      'PushEvent': 0.4,
      'CreateEvent': 0.5,
      'DeleteEvent': 0.3,
      'WatchEvent': 0.6,   // Star
      'ForkEvent': 0.7,
      'ReleaseEvent': 0.9,
      'MemberEvent': 0.5,
    };
    return salienceMap[event.type] ?? 0.3;
  }

  private summarizePayload(event: GitHubEvent): Record<string, unknown> {
    const p = event.payload;
    switch (event.type) {
      case 'IssuesEvent':
        return { action: p.action, title: p.issue?.title, number: p.issue?.number };
      case 'IssueCommentEvent':
        return { issue: p.issue?.title, body: (p.comment?.body ?? '').slice(0, 200) };
      case 'PullRequestEvent':
        return { action: p.action, title: p.pull_request?.title, number: p.pull_request?.number };
      case 'PushEvent':
        return { commits: p.commits?.length ?? 0, ref: p.ref };
      case 'WatchEvent':
        return { action: p.action }; // "starred"
      case 'ForkEvent':
        return { forkee: p.forkee?.full_name };
      case 'ReleaseEvent':
        return { action: p.action, tag: p.release?.tag_name };
      default:
        return { action: p.action };
    }
  }

  private eventToFeatures(event: GitHubEvent): number[] {
    const typeIndex = [
      'IssuesEvent', 'IssueCommentEvent', 'PullRequestEvent',
      'PushEvent', 'WatchEvent', 'ForkEvent', 'ReleaseEvent', 'Other'
    ];
    const idx = typeIndex.indexOf(event.type);
    const typeVec = new Array(8).fill(0);
    typeVec[idx >= 0 ? idx : 7] = 1;

    return [
      ...typeVec,
      this.computeEventSalience(event),
      // Recency: how many seconds ago (normalized to 1 hour)
      Math.min((Date.now() - new Date(event.created_at).getTime()) / 3600000, 1.0),
    ];
  }

  private statsToFeatures(stats: RepoStats, changes: Record<string, number>): number[] {
    return [
      // Absolute stats (log-normalized)
      Math.log1p(stats.stargazers_count) / 10,
      Math.log1p(stats.forks_count) / 10,
      Math.log1p(stats.open_issues_count) / 5,
      // Deltas (signed, capped)
      Math.max(-1, Math.min(1, (changes.starsDelta ?? 0) / 10)),
      Math.max(-1, Math.min(1, (changes.forksDelta ?? 0) / 5)),
      Math.max(-1, Math.min(1, (changes.issuesDelta ?? 0) / 5)),
      // Change magnitude
      Math.min(Object.values(changes).reduce((s, v) => s + Math.abs(v), 0) / 10, 1),
    ];
  }
}
