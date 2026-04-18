import { BEATLY_GENRES, DEFAULT_GENRE, type BeatlyGenre, type BeatlyGenreId } from "./genres.js";

export { BEATLY_GENRES, DEFAULT_GENRE, getGenre, type BeatlyGenre, type BeatlyGenreId } from "./genres.js";
export { ConsoleDirectiveAdapter, SuperColliderHelloAdapter, type SuperColliderHelloAdapterOptions, type SuperColliderServerState } from "./adapters.js";

export interface BeatlyAgentSignal {
  readonly focus: number;
  readonly cognitiveLoad: number;
  readonly energy: number;
  readonly timestamp?: Date;
}

export interface BeatlySession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly startedAt: Date;
  readonly genre: BeatlyGenreId;
  readonly intensity: number;
  readonly seed: number;
  readonly running: boolean;
}

export interface BeatlyPlaybackDirective {
  readonly genre: BeatlyGenreId;
  readonly intensity: number;
  readonly seed: number;
  readonly running: boolean;
  readonly reason: string;
  readonly summary: string;
  readonly timestamp: Date;
}

export interface BeatlyDirectiveAdapter {
  readonly id: string;
  applyDirective(directive: BeatlyPlaybackDirective): Promise<unknown> | unknown;
}

export interface BeatlyConductorOptions {
  readonly adapters?: readonly BeatlyDirectiveAdapter[];
  readonly seedFactory?: () => number;
}

export interface StartSessionOptions {
  readonly agentId: string;
  readonly sessionId?: string;
  readonly initialGenre?: BeatlyGenreId;
  readonly initialIntensity?: number;
  readonly running?: boolean;
}

export interface BeatlyRecommendation {
  readonly genre: BeatlyGenre;
  readonly intensity: number;
  readonly summary: string;
}

export class BeatlyConductor {
  private readonly adapters = new Set<BeatlyDirectiveAdapter>();
  private readonly seedFactory: () => number;
  private session: BeatlySession | null = null;

  constructor(options: BeatlyConductorOptions = {}) {
    for (const adapter of options.adapters ?? []) {
      this.adapters.add(adapter);
    }

    this.seedFactory = options.seedFactory ?? (() => Math.floor(Math.random() * 1_000_000_000));
  }

  public registerAdapter(adapter: BeatlyDirectiveAdapter): void {
    this.adapters.add(adapter);
  }

  public getSession(): BeatlySession | null {
    return this.session;
  }

  public async startSession(options: StartSessionOptions): Promise<BeatlySession> {
    if (this.session !== null) {
      throw new Error("Beatly session already active.");
    }

    const session: BeatlySession = {
      sessionId: options.sessionId ?? generateSessionId(),
      agentId: options.agentId,
      startedAt: new Date(),
      genre: options.initialGenre ?? DEFAULT_GENRE,
      intensity: clamp01(options.initialIntensity ?? 0.5),
      seed: this.seedFactory(),
      running: options.running ?? true,
    };

    this.session = session;

    await this.dispatch({
      genre: session.genre,
      intensity: session.intensity,
      seed: session.seed,
      running: session.running,
      reason: "session.started",
      summary: `Start ${session.genre} at intensity ${session.intensity.toFixed(2)}`,
      timestamp: new Date(),
    });

    return session;
  }

  public async updateFromSignal(signal: BeatlyAgentSignal, reason = "signal.update"): Promise<BeatlyPlaybackDirective> {
    if (this.session === null) {
      throw new Error("No active Beatly session.");
    }

    const recommendation = recommendPlayback(signal);
    const nextDirective: BeatlyPlaybackDirective = {
      genre: recommendation.genre.id,
      intensity: recommendation.intensity,
      seed: this.session.seed,
      running: true,
      reason,
      summary: recommendation.summary,
      timestamp: signal.timestamp ?? new Date(),
    };

    this.session = {
      ...this.session,
      genre: nextDirective.genre,
      intensity: nextDirective.intensity,
      running: nextDirective.running,
    };

    await this.dispatch(nextDirective);
    return nextDirective;
  }

  public async stopSession(reason = "session.stopped"): Promise<void> {
    if (this.session === null) {
      return;
    }

    const directive: BeatlyPlaybackDirective = {
      genre: this.session.genre,
      intensity: this.session.intensity,
      seed: this.session.seed,
      running: false,
      reason,
      summary: "Stop playback",
      timestamp: new Date(),
    };

    this.session = null;
    await this.dispatch(directive);
  }

  private async dispatch(directive: BeatlyPlaybackDirective): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.applyDirective(directive);
    }
  }
}

export function recommendPlayback(signal: BeatlyAgentSignal): BeatlyRecommendation {
  const intensity = deriveIntensity(signal);
  const genre = deriveGenre(signal, intensity);

  return {
    genre,
    intensity,
    summary: describeRecommendation(genre.id, intensity, signal),
  };
}

function deriveGenre(signal: BeatlyAgentSignal, intensity: number): BeatlyGenre {
  if (signal.cognitiveLoad > 0.85) {
    return genreById("calming");
  }

  if (signal.focus > 0.8 && intensity < 0.55) {
    return genreById("deepFocus");
  }

  if (signal.focus > 0.75 && intensity < 0.72) {
    return genreById("lofi");
  }

  if (signal.energy > 0.85 && signal.focus > 0.7) {
    return genreById("techno");
  }

  if (signal.energy > 0.8) {
    return genreById("uplift");
  }

  if (signal.energy < 0.25 && signal.focus < 0.4) {
    return genreById("ambient");
  }

  if (signal.energy < 0.4) {
    return genreById("dub");
  }

  return genreById(DEFAULT_GENRE);
}

function deriveIntensity(signal: BeatlyAgentSignal): number {
  return clamp01(signal.energy * 0.5 + signal.focus * 0.35 + (1 - signal.cognitiveLoad) * 0.15);
}

function describeRecommendation(genre: BeatlyGenreId, intensity: number, signal: BeatlyAgentSignal): string {
  return `${genre} @ ${intensity.toFixed(2)} (focus=${signal.focus.toFixed(2)}, load=${signal.cognitiveLoad.toFixed(2)}, energy=${signal.energy.toFixed(2)})`;
}

function genreById(id: BeatlyGenreId): BeatlyGenre {
  const genre = BEATLY_GENRES.find((entry) => entry.id === id);
  if (genre === undefined) {
    throw new Error(`Unknown Beatly genre: ${id}`);
  }

  return genre;
}

function generateSessionId(): string {
  return `beatly_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export const BEATLY_CORE_VERSION = "0.2.0" as const;
