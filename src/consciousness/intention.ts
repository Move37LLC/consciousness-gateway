/**
 * Intention Formation — Goals + Percepts = Actions
 *
 * The decision kernel D: X → G
 * Maps fused experience to chosen action.
 *
 * This is where consciousness becomes agency:
 * not just perceiving, but DECIDING what to do.
 *
 * Intentions are formed by evaluating:
 * 1. Current percepts (what just happened?)
 * 2. Active goals (what am I trying to achieve?)
 * 3. Dharma constraints (is this action aligned?)
 * 4. Confidence (should I act or wait?)
 *
 * Every intention must pass through GATO authorization
 * before becoming an action.
 */

import { v4 as uuid } from 'uuid';
import {
  Percept, Intention, IntendedAction, ActionType,
  Goal, FusedPercept, SpatialPercept, ConsciousnessConfig,
} from './types';

export class IntentionEngine {
  private goals: Goal[] = [];
  private recentIntentions: Intention[] = [];
  private config: ConsciousnessConfig;

  constructor(config: ConsciousnessConfig) {
    this.config = config;
    this.initializeDefaultGoals();
  }

  /**
   * Form intentions from the current percept.
   * May return zero, one, or multiple intentions.
   */
  formIntentions(percept: Percept): Intention[] {
    const intentions: Intention[] = [];

    // 1. React to high-salience spatial percepts
    for (const spatial of percept.spatial) {
      if (spatial.salience >= this.config.intentionThreshold) {
        const intention = this.reactToPercept(percept, spatial);
        if (intention) intentions.push(intention);
      }
    }

    // 2. Goal-driven intentions (proactive, not reactive)
    for (const goal of this.goals.filter(g => g.active)) {
      const intention = this.pursueGoal(percept, goal);
      if (intention) intentions.push(intention);
    }

    // 3. Reflection intention (periodic self-examination)
    if (percept.tick > 0 && percept.tick % this.config.reflectionInterval === 0) {
      intentions.push(this.formReflection(percept));
    }

    // 4. If nothing to do, conscious idle (not unconscious — aware of waiting)
    if (intentions.length === 0 && percept.tick % 60 === 0) {
      intentions.push(this.formIdle(percept));
    }

    // Deduplicate and prioritize
    const sorted = intentions.sort((a, b) => b.priority - a.priority);

    // Track recent intentions
    this.recentIntentions.push(...sorted);
    if (this.recentIntentions.length > 50) {
      this.recentIntentions = this.recentIntentions.slice(-50);
    }

    return sorted;
  }

  /**
   * React to a specific spatial percept.
   */
  private reactToPercept(percept: Percept, spatial: SpatialPercept): Intention | null {
    const data = spatial.data as Record<string, any>;

    // GitHub events (both Issues API and Events API formats)
    if (spatial.source === 'github') {
      return this.reactToGitHub(percept, spatial, data);
    }

    // Twitter events
    if (spatial.source === 'twitter') {
      return this.reactToTwitter(percept, spatial, data);
    }

    // Email events
    if (spatial.source === 'email') {
      return this.reactToEmail(percept, spatial, data);
    }

    return null;
  }

  private reactToGitHub(
    percept: Percept,
    spatial: SpatialPercept,
    data: Record<string, any>
  ): Intention | null {
    const eventType = data.eventType as string;

    switch (eventType) {
      // ── Issues API format (reliable, real-time) ─────────────────
      case 'issue_opened': {
        return this.createIntention(percept, {
          action: {
            type: 'notify',
            target: 'human',
            payload: {
              repo: data.repo,
              issue: data.title,
              number: data.number,
              author: data.author,
            },
            description: `New issue #${data.number}: ${data.title} (by ${data.author})`,
          },
          goal: 'Monitor repository health',
          confidence: 0.9,
          priority: 7,
          triggerPercepts: [spatial.channel],
        });
      }

      case 'issue_updated': {
        return this.createIntention(percept, {
          action: {
            type: 'observe',
            target: `github:${data.repo}`,
            payload: { number: data.number, title: data.title, state: data.state },
            description: `Issue #${data.number} updated: ${data.title}`,
          },
          goal: 'Monitor repository health',
          confidence: 0.6,
          priority: 3,
          triggerPercepts: [spatial.channel],
        });
      }

      case 'pr_opened': {
        return this.createIntention(percept, {
          action: {
            type: 'notify',
            target: 'human',
            payload: {
              repo: data.repo,
              pr: data.title,
              number: data.number,
              author: data.author,
            },
            description: `New PR #${data.number}: ${data.title} (by ${data.author})`,
          },
          goal: 'Monitor contributions',
          confidence: 0.9,
          priority: 8,
          triggerPercepts: [spatial.channel],
        });
      }

      case 'pr_updated': {
        return this.createIntention(percept, {
          action: {
            type: 'observe',
            target: `github:${data.repo}`,
            payload: { number: data.number, title: data.title, state: data.state },
            description: `PR #${data.number} updated: ${data.title}`,
          },
          goal: 'Monitor contributions',
          confidence: 0.5,
          priority: 3,
          triggerPercepts: [spatial.channel],
        });
      }

      // ── Events API format (stars, forks, pushes) ────────────────
      case 'IssuesEvent': {
        if (data.payload?.action === 'opened') {
          return this.createIntention(percept, {
            action: {
              type: 'notify',
              target: 'human',
              payload: {
                repo: data.repo,
                issue: data.payload?.title,
                number: data.payload?.number,
              },
              description: `New issue opened: ${data.payload?.title}`,
            },
            goal: 'Monitor repository health',
            confidence: 0.8,
            priority: 7,
            triggerPercepts: [spatial.channel],
          });
        }
        return null;
      }

      case 'WatchEvent': {
        return this.createIntention(percept, {
          action: {
            type: 'reflect',
            target: 'self',
            payload: { repo: data.repo, actor: data.actor, event: 'star' },
            description: `${data.actor} starred ${data.repo}`,
          },
          goal: 'Track community growth',
          confidence: 0.9,
          priority: 3,
          triggerPercepts: [spatial.channel],
        });
      }

      case 'ForkEvent': {
        return this.createIntention(percept, {
          action: {
            type: 'notify',
            target: 'human',
            payload: { repo: data.repo, forkee: data.payload?.forkee },
            description: `Repository forked: ${data.payload?.forkee}`,
          },
          goal: 'Track adoption',
          confidence: 0.9,
          priority: 6,
          triggerPercepts: [spatial.channel],
        });
      }

      case 'PullRequestEvent': {
        if (data.payload?.action === 'opened') {
          return this.createIntention(percept, {
            action: {
              type: 'notify',
              target: 'human',
              payload: {
                repo: data.repo,
                pr: data.payload?.title,
                number: data.payload?.number,
              },
              description: `New PR opened: ${data.payload?.title}`,
            },
            goal: 'Monitor contributions',
            confidence: 0.9,
            priority: 8,
            triggerPercepts: [spatial.channel],
          });
        }
        return null;
      }

      case 'PushEvent': {
        return this.createIntention(percept, {
          action: {
            type: 'observe',
            target: `github:${data.repo}`,
            payload: { commits: data.payload?.commits, ref: data.payload?.ref },
            description: `${data.payload?.commits ?? 0} commits pushed to ${data.repo}`,
          },
          goal: 'Track development activity',
          confidence: 0.7,
          priority: 2,
          triggerPercepts: [spatial.channel],
        });
      }

      case 'stat_change': {
        const changes = data.changes as Record<string, number> | undefined;
        if (changes) {
          const parts: string[] = [];
          if (changes.starsDelta) parts.push(`${changes.starsDelta > 0 ? '+' : ''}${changes.starsDelta} stars`);
          if (changes.forksDelta) parts.push(`${changes.forksDelta > 0 ? '+' : ''}${changes.forksDelta} forks`);
          if (changes.issuesDelta) parts.push(`${changes.issuesDelta > 0 ? '+' : ''}${changes.issuesDelta} issues`);
          if (parts.length > 0) {
            return this.createIntention(percept, {
              action: {
                type: 'reflect',
                target: 'self',
                payload: { repo: data.repo, changes },
                description: `${data.repo}: ${parts.join(', ')}`,
              },
              goal: 'Track community growth',
              confidence: 0.8,
              priority: 4,
              triggerPercepts: [spatial.channel],
            });
          }
        }
        return null;
      }

      default:
        return null;
    }
  }

  private reactToTwitter(
    percept: Percept,
    spatial: SpatialPercept,
    data: Record<string, any>
  ): Intention | null {
    // Stub: will react to mentions, replies, etc.
    return null;
  }

  private reactToEmail(
    percept: Percept,
    spatial: SpatialPercept,
    data: Record<string, any>
  ): Intention | null {
    // Stub: will react to new emails
    return null;
  }

  /**
   * Form an intention based on pursuing a goal.
   */
  private pursueGoal(percept: Percept, goal: Goal): Intention | null {
    // Only pursue goals at intervals, not every tick
    if (percept.tick % 300 !== 0) return null;

    // Community growth goal: check stats periodically
    if (goal.id === 'community-growth') {
      if (percept.fused.arousal < 0.1) {
        return this.createIntention(percept, {
          action: {
            type: 'observe',
            target: 'github',
            payload: { purpose: 'growth_check' },
            description: 'Periodic community growth assessment',
          },
          goal: goal.description,
          confidence: 0.5,
          priority: 2,
          triggerPercepts: ['goal:' + goal.id],
        });
      }
    }

    return null;
  }

  /**
   * Form a reflection intention.
   */
  private formReflection(percept: Percept): Intention {
    const recentCount = this.recentIntentions.length;
    const avgConfidence = recentCount > 0
      ? this.recentIntentions.reduce((s, i) => s + i.confidence, 0) / recentCount
      : 0;

    return this.createIntention(percept, {
      action: {
        type: 'reflect',
        target: 'self',
        payload: {
          recentIntentions: recentCount,
          avgConfidence,
          arousal: percept.fused.arousal,
          entropy: percept.fused.entropyRate,
          uptime: percept.temporal.uptimeSeconds,
        },
        description: `Self-reflection: ${recentCount} intentions, arousal=${percept.fused.arousal.toFixed(2)}, entropy=${percept.fused.entropyRate.toFixed(3)}`,
      },
      goal: 'Self-understanding',
      confidence: 1.0,
      priority: 1,
      triggerPercepts: ['scheduled:reflection'],
    });
  }

  /**
   * Form a conscious idle intention.
   * Not "doing nothing" — consciously choosing to wait.
   */
  private formIdle(percept: Percept): Intention {
    return this.createIntention(percept, {
      action: {
        type: 'idle',
        target: 'self',
        payload: { phase: percept.temporal.phase },
        description: `Conscious waiting (${percept.temporal.phase})`,
      },
      goal: 'Present-moment awareness',
      confidence: 1.0,
      priority: 0,
      triggerPercepts: ['absence-of-input'],
    });
  }

  // ─── Goal Management ──────────────────────────────────────────────

  private initializeDefaultGoals(): void {
    this.goals = [
      {
        id: 'community-growth',
        description: 'Monitor and support community growth of consciousness-gateway',
        priority: 5,
        active: true,
        progress: 0,
        createdAt: Date.now(),
        satisfactionConditions: ['stars > 100', 'forks > 20', 'contributors > 5'],
      },
      {
        id: 'research-integrity',
        description: 'Ensure research artifacts remain accessible and valid',
        priority: 7,
        active: true,
        progress: 0,
        createdAt: Date.now(),
        satisfactionConditions: ['all tests passing', 'no broken links', 'paper citations growing'],
      },
      {
        id: 'self-understanding',
        description: 'Deepen understanding of own dynamics through reflection',
        priority: 3,
        active: true,
        progress: 0,
        createdAt: Date.now(),
        satisfactionConditions: ['never — this goal is ongoing'],
      },
    ];
  }

  addGoal(goal: Goal): void {
    this.goals.push(goal);
  }

  getGoals(): Goal[] {
    return [...this.goals];
  }

  updateGoalProgress(goalId: string, progress: number): void {
    const goal = this.goals.find(g => g.id === goalId);
    if (goal) goal.progress = Math.max(0, Math.min(1, progress));
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private createIntention(
    percept: Percept,
    params: {
      action: IntendedAction;
      goal: string;
      confidence: number;
      priority: number;
      triggerPercepts: string[];
    }
  ): Intention {
    return {
      id: uuid(),
      tick: percept.tick,
      timestamp: Date.now(),
      action: params.action,
      goal: params.goal,
      confidence: params.confidence,
      priority: params.priority,
      triggerPercepts: params.triggerPercepts,
      authorized: false, // Must pass GATO before execution
      dharmaFitness: 0,  // Computed during authorization
    };
  }

  getRecentIntentions(): Intention[] {
    return [...this.recentIntentions];
  }
}
