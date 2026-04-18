import { BEATLY_GENRES, DEFAULT_GENRE, type BeatlyGenre, type BeatlyGenreId } from "./genres.js";

export { BEATLY_GENRES, DEFAULT_GENRE, getGenre, getVariant, resolveProfileId, type BeatlyGenre, type BeatlyGenreId, type BeatlyVariant } from "./genres.js";
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
  readonly variant: string;
  readonly intensity: number;
  readonly seed: number;
  readonly running: boolean;
}

export interface BeatlyPlaybackDirective {
  readonly genre: BeatlyGenreId;
  readonly variant: string;
  readonly intensity: number;
  readonly seed: number;
  readonly running: boolean;
  readonly reason: string;
  readonly summary: string;
  readonly timestamp: Date;
}

export interface BeatlyPlaybackOverride {
  readonly genre?: BeatlyGenreId;
  readonly variant?: string;
  readonly intensity?: number;
  readonly seed?: number;
  readonly running?: boolean;
  readonly reason?: string;
  readonly summary?: string;
  readonly timestamp?: Date;
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
  readonly initialVariant?: string;
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

    const initialGenre = options.initialGenre ?? DEFAULT_GENRE;
    const session: BeatlySession = {
      sessionId: options.sessionId ?? generateSessionId(),
      agentId: options.agentId,
      startedAt: new Date(),
      genre: initialGenre,
      variant: pickVariant(initialGenre, options.initialVariant),
      intensity: clamp01(options.initialIntensity ?? 0.5),
      seed: this.seedFactory(),
      running: options.running ?? true,
    };

    this.session = session;

    await this.dispatch({
      genre: session.genre,
      variant: session.variant,
      intensity: session.intensity,
      seed: session.seed,
      running: session.running,
      reason: "session.started",
      summary: `Start ${session.genre}.${session.variant} at intensity ${session.intensity.toFixed(2)}`,
      timestamp: new Date(),
    });

    return session;
  }

  public async updateFromSignal(signal: BeatlyAgentSignal, reason = "signal.update"): Promise<BeatlyPlaybackDirective> {
    if (this.session === null) {
      throw new Error("No active Beatly session.");
    }

    const recommendation = recommendPlayback(signal);
    // Preserve current variant when recommending inside the same genre;
    // otherwise fall back to the target genre's default variant.
    const nextVariant = recommendation.genre.id === this.session.genre
      ? this.session.variant
      : recommendation.genre.defaultVariant;
    const nextDirective: BeatlyPlaybackDirective = {
      genre: recommendation.genre.id,
      variant: nextVariant,
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
      variant: nextDirective.variant,
      intensity: nextDirective.intensity,
      running: nextDirective.running,
    };

    await this.dispatch(nextDirective);
    return nextDirective;
  }

  public async applyPlaybackOverride(override: BeatlyPlaybackOverride): Promise<BeatlyPlaybackDirective> {
    if (this.session === null) {
      throw new Error("No active Beatly session.");
    }

    const nextGenre = override.genre ?? this.session.genre;
    const nextVariant = nextGenre === this.session.genre
      ? pickVariant(nextGenre, override.variant ?? this.session.variant)
      : pickVariant(nextGenre, override.variant);
    const directive: BeatlyPlaybackDirective = {
      genre: nextGenre,
      variant: nextVariant,
      intensity: clamp01(override.intensity ?? this.session.intensity),
      seed: override.seed ?? this.session.seed,
      running: override.running ?? this.session.running,
      reason: override.reason ?? "playback.override",
      summary: override.summary ?? "Manual playback override",
      timestamp: override.timestamp ?? new Date(),
    };

    this.session = {
      ...this.session,
      genre: directive.genre,
      variant: directive.variant,
      intensity: directive.intensity,
      seed: directive.seed,
      running: directive.running,
    };

    await this.dispatch(directive);
    return directive;
  }

  public async stopSession(reason = "session.stopped"): Promise<void> {
    if (this.session === null) {
      return;
    }

    const directive: BeatlyPlaybackDirective = {
      genre: this.session.genre,
      variant: this.session.variant,
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

  if (signal.energy < 0.18 && signal.focus < 0.45) {
    return genreById("ambient");
  }

  if (signal.energy < 0.3 && signal.focus > 0.55) {
    return genreById("rainyPiano");
  }

  if (signal.focus > 0.82 && intensity < 0.5) {
    return genreById("deepFocus");
  }

  if (signal.focus > 0.72 && signal.energy < 0.5 && signal.cognitiveLoad < 0.6) {
    return genreById("dreamPop");
  }

  if (signal.focus > 0.75 && intensity < 0.72) {
    return genreById("lofi");
  }

  if (signal.focus > 0.58 && signal.energy >= 0.45 && signal.energy < 0.72 && signal.cognitiveLoad < 0.55) {
    return genreById("soulHop");
  }

  if (signal.energy > 0.88 && signal.focus > 0.78) {
    return genreById("techno");
  }

  if (signal.energy > 0.8 && signal.focus > 0.62) {
    return genreById("chillHouse");
  }

  if (signal.energy > 0.76 && signal.cognitiveLoad < 0.45) {
    return genreById("cityPop");
  }

  if (signal.energy > 0.68 && signal.focus > 0.48) {
    return genreById("sunsetGroove");
  }

  if (signal.energy > 0.8) {
    return genreById("uplift");
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

function pickVariant(genreId: BeatlyGenreId, requested?: string): string {
  const genre = genreById(genreId);
  if (requested && genre.variants.some((entry) => entry.id === requested)) {
    return requested;
  }
  return genre.defaultVariant;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export const BEATLY_CORE_VERSION = "0.3.0" as const;
