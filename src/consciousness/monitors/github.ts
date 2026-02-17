/**
 * GitHub Monitor — Spatial perception of the code world
 *
 * Watches repositories for:
 * - New issues and comments (via Issues API — reliable, real-time)
 * - Pull requests (via Issues API — PRs are issues)
 * - Stars and forks (via stat changes)
 * - Events (via Events API — for pushes, releases, etc.)
 *
 * Uses GitHub REST API v3. Requires a PAT (Personal Access Token)
 * set via GITHUB_TOKEN environment variable.
 *
 * Poll interval: every 30 ticks (~30 seconds) to catch events quickly.
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

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
  body?: string;
  labels: Array<{ name: string }>;
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
  readonly pollInterval = 30; // Every 30 ticks = ~30 seconds

  private token: string | undefined;
  private repos: string[];
  private lastEventIds = new Map<string, string>();
  private lastStats = new Map<string, RepoStats>();
  private lastIssuePoll = new Map<string, string>(); // repo → ISO timestamp of last poll
  private baseUrl = 'https://api.github.com';
  private initialized = false;
  private pollCount = 0;
  private lastError: string | null = null;

  constructor(repos: string[], token?: string) {
    // Trim whitespace from repo names (critical: env var parsing can add spaces)
    this.repos = repos.map(r => r.trim()).filter(r => r.length > 0);
    this.token = token ?? process.env.GITHUB_TOKEN;
  }

  get available(): boolean {
    return !!this.token && this.repos.length > 0;
  }

  async init(): Promise<void> {
    if (!this.available) {
      console.log('  [github] Skipping init: no token or no repos');
      return;
    }

    console.log(`  [github] Initializing for ${this.repos.length} repos: ${this.repos.join(', ')}`);

    // Validate the token first
    const tokenValid = await this.validateToken();
    if (!tokenValid) {
      console.log('  [github] WARNING: Token validation failed. Check GITHUB_TOKEN.');
      return;
    }

    // Seed initial state
    for (const repo of this.repos) {
      try {
        // Seed stats
        const stats = await this.fetchRepoStats(repo);
        if (stats) {
          this.lastStats.set(repo, stats);
          console.log(`  [github] ${repo}: ${stats.stargazers_count} stars, ${stats.forks_count} forks, ${stats.open_issues_count} issues`);
        } else {
          console.log(`  [github] ${repo}: Could not fetch stats (check repo name)`);
        }

        // Seed events (mark current events as "seen")
        const events = await this.fetchRepoEvents(repo);
        if (events.length > 0) {
          this.lastEventIds.set(repo, events[0].id);
          console.log(`  [github] ${repo}: Seeded ${events.length} existing events (latest: ${events[0].type})`);
        }

        // Set the issue poll timestamp to NOW so we only get new issues
        this.lastIssuePoll.set(repo, new Date().toISOString());
      } catch (err) {
        console.log(`  [github] ${repo}: Init error: ${err}`);
      }
    }

    this.initialized = true;
    console.log('  [github] Initialization complete');
  }

  async poll(): Promise<SpatialPercept[]> {
    if (!this.available) return [];
    this.pollCount++;

    const percepts: SpatialPercept[] = [];

    for (const repo of this.repos) {
      try {
        // 1. Check for new/updated issues (reliable, real-time)
        const issuePercepts = await this.getNewIssues(repo);
        percepts.push(...issuePercepts);

        // 2. Check for new events (stars, forks, pushes, etc.)
        const newEvents = await this.getNewEvents(repo);
        for (const event of newEvents) {
          percepts.push(this.eventToPercept(repo, event));
        }

        // 3. Check for stat changes (every 2nd poll to reduce API calls)
        if (this.pollCount % 2 === 0) {
          const statChanges = await this.getStatChanges(repo);
          if (statChanges) {
            percepts.push(statChanges);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (this.lastError !== errMsg) {
          console.log(`  [github] ${repo}: Poll error: ${errMsg}`);
          this.lastError = errMsg;
        }
      }
    }

    if (percepts.length > 0) {
      console.log(`  [github] Poll #${this.pollCount}: ${percepts.length} percept(s) detected`);
    }

    return percepts;
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Get diagnostic info for troubleshooting.
   */
  getDiagnostics(): Record<string, unknown> {
    return {
      available: this.available,
      initialized: this.initialized,
      tokenPresent: !!this.token,
      tokenPrefix: this.token ? this.token.slice(0, 6) + '...' : 'none',
      repos: this.repos,
      pollCount: this.pollCount,
      lastError: this.lastError,
      seededRepos: Array.from(this.lastEventIds.keys()),
      issuePollTimestamps: Object.fromEntries(this.lastIssuePoll),
    };
  }

  // ─── Private Methods ─────────────────────────────────────────────

  private async validateToken(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'consciousness-gateway/0.2.0',
        'Authorization': `Bearer ${this.token}`,
      };

      const response = await fetch(`${this.baseUrl}/user`, { headers });

      if (response.ok) {
        const user = await response.json() as { login: string };
        console.log(`  [github] Authenticated as: ${user.login}`);

        // Check rate limit
        const remaining = response.headers.get('x-ratelimit-remaining');
        const limit = response.headers.get('x-ratelimit-limit');
        console.log(`  [github] Rate limit: ${remaining}/${limit} remaining`);
        return true;
      } else {
        console.log(`  [github] Token validation failed: HTTP ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (err) {
      console.log(`  [github] Token validation error: ${err}`);
      return false;
    }
  }

  private async fetchJSON<T>(url: string): Promise<T | null> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'consciousness-gateway/0.2.0',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        // Log non-200 responses (but don't spam — only on change)
        const errKey = `${response.status}:${url}`;
        if (this.lastError !== errKey) {
          console.log(`  [github] API ${response.status}: ${url}`);
          this.lastError = errKey;
        }
        return null;
      }

      return await response.json() as T;
    } catch (err) {
      const errMsg = `fetch error: ${err instanceof Error ? err.message : err}`;
      if (this.lastError !== errMsg) {
        console.log(`  [github] ${errMsg} for ${url}`);
        this.lastError = errMsg;
      }
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

  // ─── Issues API (reliable for issue/PR detection) ─────────────

  private async getNewIssues(repo: string): Promise<SpatialPercept[]> {
    const since = this.lastIssuePoll.get(repo);
    if (!since) {
      // First poll for this repo — set timestamp and return empty
      this.lastIssuePoll.set(repo, new Date().toISOString());
      return [];
    }

    const url = `${this.baseUrl}/repos/${repo}/issues?state=all&sort=updated&direction=desc&since=${since}&per_page=20`;
    const issues = await this.fetchJSON<GitHubIssue[]>(url);

    if (!issues || issues.length === 0) return [];

    // Update timestamp to now
    this.lastIssuePoll.set(repo, new Date().toISOString());

    const percepts: SpatialPercept[] = [];

    for (const issue of issues) {
      const isPR = !!issue.pull_request;
      const isNew = new Date(issue.created_at).toISOString() > since;

      const eventType = isPR
        ? (isNew ? 'pr_opened' : 'pr_updated')
        : (isNew ? 'issue_opened' : 'issue_updated');

      const salience = isNew ? (isPR ? 0.8 : 0.7) : 0.4;

      percepts.push({
        source: 'github',
        channel: `github:${repo}:${eventType}`,
        data: {
          repo,
          eventType,
          number: issue.number,
          title: issue.title,
          state: issue.state,
          author: issue.user.login,
          isNew,
          isPR,
          labels: issue.labels.map(l => l.name),
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
        },
        salience,
        features: this.issueToFeatures(issue, isNew, isPR),
        timestamp: new Date(issue.updated_at).getTime(),
      });
    }

    if (percepts.length > 0) {
      console.log(`  [github] ${repo}: ${percepts.length} issue/PR update(s)`);
    }

    return percepts;
  }

  private issueToFeatures(issue: GitHubIssue, isNew: boolean, isPR: boolean): number[] {
    return [
      isNew ? 1 : 0,
      isPR ? 1 : 0,
      issue.state === 'open' ? 1 : 0,
      issue.labels.length / 5,
      // Recency
      Math.min((Date.now() - new Date(issue.updated_at).getTime()) / 3600000, 1.0),
      // Title complexity
      Math.min(issue.title.length / 100, 1.0),
      // Salience by type
      isNew ? 0.8 : 0.4,
    ];
  }

  // ─── Events API (for stars, forks, pushes, releases) ──────────

  private async getNewEvents(repo: string): Promise<GitHubEvent[]> {
    const events = await this.fetchRepoEvents(repo);
    if (events.length === 0) return [];

    const lastId = this.lastEventIds.get(repo);

    if (!lastId) {
      // First poll — store latest and return nothing (avoid flood)
      this.lastEventIds.set(repo, events[0].id);
      return [];
    }

    const newEvents: GitHubEvent[] = [];
    for (const event of events) {
      if (event.id === lastId) break;
      newEvents.push(event);
    }

    if (newEvents.length > 0) {
      this.lastEventIds.set(repo, newEvents[0].id);
      console.log(`  [github] ${repo}: ${newEvents.length} new event(s): ${newEvents.map(e => e.type).join(', ')}`);
    }

    return newEvents;
  }

  // ─── Stats ────────────────────────────────────────────────────

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

    console.log(`  [github] ${repo}: Stats changed: ${JSON.stringify(changes)}`);

    const salience = Math.min(
      (Math.abs(changes.starsDelta ?? 0) * 0.3 +
       Math.abs(changes.forksDelta ?? 0) * 0.2 +
       Math.abs(changes.issuesDelta ?? 0) * 0.1),
      1.0
    );

    return {
      source: 'github',
      channel: `github:${repo}:stats`,
      data: { repo, current, changes, event: 'stat_change' },
      salience,
      features: this.statsToFeatures(current, changes),
      timestamp: Date.now(),
    };
  }

  // ─── Feature Extractors ───────────────────────────────────────

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
    const salienceMap: Record<string, number> = {
      'IssuesEvent': 0.7,
      'IssueCommentEvent': 0.5,
      'PullRequestEvent': 0.8,
      'PullRequestReviewEvent': 0.6,
      'PushEvent': 0.4,
      'CreateEvent': 0.5,
      'DeleteEvent': 0.3,
      'WatchEvent': 0.6,
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
        return { action: p.action };
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
      Math.min((Date.now() - new Date(event.created_at).getTime()) / 3600000, 1.0),
    ];
  }

  private statsToFeatures(stats: RepoStats, changes: Record<string, number>): number[] {
    return [
      Math.log1p(stats.stargazers_count) / 10,
      Math.log1p(stats.forks_count) / 10,
      Math.log1p(stats.open_issues_count) / 5,
      Math.max(-1, Math.min(1, (changes.starsDelta ?? 0) / 10)),
      Math.max(-1, Math.min(1, (changes.forksDelta ?? 0) / 5)),
      Math.max(-1, Math.min(1, (changes.issuesDelta ?? 0) / 5)),
      Math.min(Object.values(changes).reduce((s, v) => s + Math.abs(v), 0) / 10, 1),
    ];
  }
}
