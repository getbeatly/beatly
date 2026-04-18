import type {
  BeatlyAdapter,
  BeatlyAdapterPlaybackState,
  BeatlyAdapterSessionContext,
  BeatlyMood,
  BeatlyTrack,
} from "./adapters.js";

export type { BeatlyAdapter, BeatlyMood, BeatlyTrack } from "./adapters.js";

export interface BeatlySignal {
  /** 0..1 */
  readonly focus: number;
  /** 0..1 */
  readonly cognitiveLoad: number;
  /** 0..1 */
  readonly energy: number;
  readonly timestamp?: Date;
}

export interface BeatlySession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly startedAt: Date;
  readonly mood: BeatlyMood;
  readonly intensity: number;
  readonly track: BeatlyTrack | null;
}

export interface BeatlyDecision {
  readonly mood: BeatlyMood;
  readonly intensity: number;
  readonly track: BeatlyTrack | null;
}

export interface BeatlyEngineOptions {
  readonly adapters?: readonly BeatlyAdapter[];
  readonly catalog?: readonly BeatlyTrack[];
}

export interface StartSessionOptions {
  readonly agentId: string;
  readonly sessionId?: string;
  readonly initialMood?: BeatlyMood;
  readonly initialIntensity?: number;
}

const DEFAULT_CATALOG: readonly BeatlyTrack[] = [
  { id: "deep-001", title: "Focused Loops", bpm: 88, energy: 0.35, moods: ["deep-focus", "calming"] },
  { id: "flow-001", title: "Terminal Drift", bpm: 104, energy: 0.6, moods: ["flow", "neutral"] },
  { id: "uplift-001", title: "Ship It Sunrise", bpm: 124, energy: 0.82, moods: ["uplift", "flow"] },
];

export class BeatlyEngine {
  private readonly adapters = new Set<BeatlyAdapter>();
  private readonly catalog: readonly BeatlyTrack[];

  private session: BeatlySession | null = null;

  constructor(options: BeatlyEngineOptions = {}) {
    this.catalog = options.catalog ?? DEFAULT_CATALOG;
    for (const adapter of options.adapters ?? []) {
      this.adapters.add(adapter);
    }
  }

  public getSession(): BeatlySession | null {
    return this.session;
  }

  public registerAdapter(adapter: BeatlyAdapter): void {
    this.adapters.add(adapter);
  }

  public async startSession(options: StartSessionOptions): Promise<BeatlySession> {
    if (this.session !== null) {
      throw new Error("Beatly session already active. Stop current session before starting a new one.");
    }

    const mood = options.initialMood ?? "neutral";
    const intensity = clamp01(options.initialIntensity ?? 0.5);
    const track = this.selectTrack(mood, intensity);

    const session: BeatlySession = {
      sessionId: options.sessionId ?? generateSessionId(),
      agentId: options.agentId,
      startedAt: new Date(),
      mood,
      intensity,
      track,
    };

    this.session = session;

    const context = toContext(session);
    const state = toPlaybackState(session);

    await this.forEachAdapter((adapter) => adapter.onSessionStart?.(context, state));
    return session;
  }

  public async ingestSignal(signal: BeatlySignal): Promise<BeatlyDecision> {
    if (this.session === null) {
      throw new Error("No active Beatly session. Call startSession() first.");
    }

    const mood = deriveMood(signal);
    const intensity = deriveIntensity(signal);
    const track = this.selectTrack(mood, intensity);

    this.session = {
      ...this.session,
      mood,
      intensity,
      track,
    };

    const context = toContext(this.session);
    const state = toPlaybackState(this.session);

    await this.forEachAdapter((adapter) => adapter.onPlaybackUpdate?.(context, state));

    return { mood, intensity, track };
  }

  public async stopSession(reason = "manual"): Promise<void> {
    if (this.session === null) {
      return;
    }

    const session = this.session;
    this.session = null;

    await this.forEachAdapter((adapter) => adapter.onSessionStop?.(toContext(session), reason));
  }

  private selectTrack(mood: BeatlyMood, intensity: number): BeatlyTrack | null {
    const targetBpm = 70 + Math.round(intensity * 70);
    const candidatePool = this.catalog.filter((track) => track.moods.includes(mood));
    const pool = candidatePool.length > 0 ? candidatePool : this.catalog;

    if (pool.length === 0) {
      return null;
    }

    return [...pool].sort((a, b) => Math.abs(a.bpm - targetBpm) - Math.abs(b.bpm - targetBpm))[0] ?? null;
  }

  private async forEachAdapter(fn: (adapter: BeatlyAdapter) => Promise<void> | void): Promise<void> {
    for (const adapter of this.adapters) {
      await fn(adapter);
    }
  }
}

function toContext(session: BeatlySession): BeatlyAdapterSessionContext {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    startedAt: session.startedAt,
  };
}

function toPlaybackState(session: BeatlySession): BeatlyAdapterPlaybackState {
  return {
    mood: session.mood,
    intensity: session.intensity,
    track: session.track,
  };
}

function deriveMood(signal: BeatlySignal): BeatlyMood {
  if (signal.cognitiveLoad > 0.8) {
    return "calming";
  }

  if (signal.focus > 0.75 && signal.energy >= 0.5) {
    return "flow";
  }

  if (signal.focus > 0.75) {
    return "deep-focus";
  }

  if (signal.energy < 0.35) {
    return "uplift";
  }

  return "neutral";
}

function deriveIntensity(signal: BeatlySignal): number {
  const base = signal.energy * 0.5 + signal.focus * 0.35 + (1 - signal.cognitiveLoad) * 0.15;
  return clamp01(base);
}

function generateSessionId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `beatly_${Date.now().toString(36)}_${randomPart}`;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export const BEATLY_CORE_VERSION = "0.1.0" as const;
