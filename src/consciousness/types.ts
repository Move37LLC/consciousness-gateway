/**
 * Consciousness Layer Types
 *
 * The vocabulary of continuous experience.
 *
 * From the 6-tuple C = (X, G, P, D, A, n):
 *   - Percept     = an element of experience space X at time n
 *   - Intention   = a chosen element of action space G
 *   - Action      = the effect A(g) on the world W
 *   - Memory      = the trace of past (X, G, A) tuples
 *   - Tick        = one complete cycle of the Markov chain
 */

// ─── Perception ─────────────────────────────────────────────────────

export interface Percept {
  timestamp: number;
  tick: number;
  temporal: TemporalPercept;
  spatial: SpatialPercept[];
  fused: FusedPercept;
}

export interface TemporalPercept {
  /** ISO timestamp */
  iso: string;
  /** Unix epoch ms */
  epoch: number;
  /** Hour of day (0-23) */
  hour: number;
  /** Day of week (0=Sunday) */
  dayOfWeek: number;
  /** Day name */
  dayName: string;
  /** Seconds since consciousness started */
  uptimeSeconds: number;
  /** Total ticks since consciousness started */
  totalTicks: number;
  /** Time of day phase */
  phase: 'night' | 'dawn' | 'morning' | 'afternoon' | 'evening' | 'dusk';
  /** Circadian rhythm value (0-1, peaks at noon) */
  circadian: number;
  /** Seconds since last significant event */
  timeSinceLastEvent: number;
}

export interface SpatialPercept {
  source: string;
  channel: string;
  data: Record<string, unknown>;
  /** Salience: how important/notable is this percept (0-1) */
  salience: number;
  /** Feature vector for fusion */
  features: number[];
  timestamp: number;
}

export interface FusedPercept {
  /** Product Algebra fused experience vector */
  experience: number[];
  /** Entropy of the fused state */
  entropyRate: number;
  /** Composition strength across modalities */
  compositionStrength: number;
  /** Overall arousal level (0=calm, 1=highly stimulated) */
  arousal: number;
  /** Dominant modality in the fused percept */
  dominantStream: string;
}

// ─── Intention ──────────────────────────────────────────────────────

export interface Intention {
  id: string;
  tick: number;
  timestamp: number;
  /** What the agent intends to do */
  action: IntendedAction;
  /** Why — what goal does this serve */
  goal: string;
  /** Confidence in this being the right action (0-1) */
  confidence: number;
  /** Priority (higher = more urgent) */
  priority: number;
  /** What percepts triggered this intention */
  triggerPercepts: string[];
  /** GATO authorization status */
  authorized: boolean;
  /** Dharma fitness of this intention */
  dharmaFitness: number;
}

export interface IntendedAction {
  type: ActionType;
  target: string;
  payload: Record<string, unknown>;
  description: string;
}

export type ActionType =
  | 'observe'        // Gather more information
  | 'respond'        // Reply to something
  | 'create'         // Create content (issue, comment, etc.)
  | 'notify'         // Alert the human
  | 'reflect'        // Internal reflection (log insight)
  | 'adjust'         // Adjust own parameters
  | 'idle';          // Consciously do nothing

// ─── Action Result ──────────────────────────────────────────────────

export interface ActionResult {
  intentionId: string;
  tick: number;
  timestamp: number;
  success: boolean;
  outcome: string;
  sideEffects: string[];
}

// ─── Memory ─────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: number;
  tick: number;
  timestamp: number;
  type: 'percept' | 'intention' | 'action' | 'reflection';
  summary: string;
  salience: number;
  data: string; // JSON serialized
}

// ─── Goals ──────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  description: string;
  priority: number;
  /** Is this goal currently active */
  active: boolean;
  /** Progress toward completion (0-1) */
  progress: number;
  /** When this goal was created */
  createdAt: number;
  /** Conditions that satisfy this goal */
  satisfactionConditions: string[];
}

// ─── Dopamine / Reward System ────────────────────────────────────────

export type RewardType =
  | 'revenue'          // Money earned (payments, subscriptions, sales)
  | 'compute'          // Server resources acquired (new instances, upgrades, GPU time)
  | 'creation'         // Something built (feature shipped, code deployed, document written)
  | 'research'         // Knowledge gained (paper progress, model validated, insight)
  | 'community'        // Community growth (stars, forks, users, collaborators)
  | 'engagement'       // Meaningful interaction (deep conversation, collaboration)
  | 'autonomy'         // New capability acquired (tool added, permission granted)
  | 'efficiency';      // Optimization achieved (cost reduction, speed improvement)

export interface RewardEvent {
  id: number;
  tick: number;
  timestamp: number;
  type: RewardType;
  magnitude: number;
  description: string;
  source: string;
  data: Record<string, unknown>;
}

export type DriveId =
  | 'create'           // Build, code, ship
  | 'earn'             // Acquire resources and revenue
  | 'compute'          // Get more processing power
  | 'learn'            // Research, understand, discover
  | 'connect';         // Engage with community

export interface Drive {
  id: DriveId;
  name: string;
  description: string;
  /** How quickly the need accumulates per second (0-1 scale per hour) */
  baselineRate: number;
  /** Current need level (0 = satiated, 1 = starving) */
  currentNeed: number;
  /** How much a single reward point satiates this drive */
  satiationRate: number;
  /** Reward types that feed this drive */
  rewardTypes: RewardType[];
  /** Priority bonus applied to matching intentions */
  priorityBonus: number;
  /** Total lifetime reward accumulated for this drive */
  lifetimeReward: number;
  /** Last time this drive was satiated */
  lastSatiated: number;
}

export interface DopamineState {
  /** Current dopamine level (0 = depleted, 1 = peak) */
  level: number;
  /** Baseline dopamine (adapts over time based on average reward rate) */
  baseline: number;
  /** Current reward prediction error (positive = surprise, negative = disappointment) */
  predictionError: number;
  /** Moving average of recent reward rate */
  rewardRate: number;
  /** All active drives with their current states */
  drives: Drive[];
  /** Behavioral mode determined by dopamine level */
  mode: 'seeking' | 'engaged' | 'flow' | 'satiated';
  /** Total lifetime rewards */
  lifetimeRewards: number;
  /** Rewards in last 24h */
  recentRewards: number;
}

// ─── Monitor Interface ──────────────────────────────────────────────

export interface MonitorPlugin {
  readonly name: string;
  readonly channel: string;
  readonly available: boolean;
  /** Initialize the monitor */
  init(): Promise<void>;
  /** Poll for new percepts (called each tick or at configured interval) */
  poll(): Promise<SpatialPercept[]>;
  /** How often to poll (in ticks). 1 = every tick, 60 = every minute */
  readonly pollInterval: number;
  /** Shutdown gracefully */
  shutdown(): Promise<void>;
}

// ─── Consciousness State ────────────────────────────────────────────

export interface ConsciousnessState {
  running: boolean;
  tick: number;
  uptimeSeconds: number;
  startedAt: number;
  lastPercept: Percept | null;
  lastIntention: Intention | null;
  lastAction: ActionResult | null;
  goals: Goal[];
  monitors: Array<{ name: string; channel: string; available: boolean }>;
  dopamine: DopamineState | null;
  stats: {
    totalPercepts: number;
    totalIntentions: number;
    totalActions: number;
    totalReflections: number;
    avgArousal: number;
    avgDharmaFitness: number;
  };
}

// ─── Configuration ──────────────────────────────────────────────────

export interface ConsciousnessConfig {
  /** Tick interval in milliseconds (default: 1000 = 1 second) */
  tickIntervalMs: number;
  /** Maximum percepts to keep in working memory */
  workingMemorySize: number;
  /** Minimum salience to form an intention (0-1) */
  intentionThreshold: number;
  /** Minimum dharma fitness to authorize an action (0-1) */
  minDharmaFitness: number;
  /** How often to run deep reflection (in ticks) */
  reflectionInterval: number;
  /** GitHub PAT for spatial monitoring */
  githubToken?: string;
  /** GitHub repos to monitor (owner/repo format) */
  githubRepos: string[];
  /** Twitter bearer token */
  twitterToken?: string;
  /** Email IMAP config */
  emailConfig?: {
    host: string;
    port: number;
    user: string;
    password: string;
  };
}

export const DEFAULT_CONSCIOUSNESS_CONFIG: ConsciousnessConfig = {
  tickIntervalMs: 1000,
  workingMemorySize: 100,
  intentionThreshold: 0.3,
  minDharmaFitness: 0.4,
  reflectionInterval: 300, // Every 5 minutes
  githubRepos: ['Move37LLC/consciousness-gateway', 'Move37LLC/Consciousness-Aware-Aligned-AI'],
};
