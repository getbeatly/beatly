export interface BeatlyAdapterSessionContext {
  readonly sessionId: string;
  readonly agentId: string;
  readonly startedAt: Date;
}

export interface BeatlyAdapterPlaybackState {
  readonly mood: BeatlyMood;
  readonly intensity: number;
  readonly track: BeatlyTrack | null;
}

export interface BeatlyAdapter {
  /**
   * Stable identifier for observability and debugging.
   */
  readonly id: string;

  connect?(): Promise<void> | void;
  disconnect?(): Promise<void> | void;

  onSessionStart?(
    session: BeatlyAdapterSessionContext,
    state: BeatlyAdapterPlaybackState,
  ): Promise<void> | void;

  onPlaybackUpdate?(
    session: BeatlyAdapterSessionContext,
    state: BeatlyAdapterPlaybackState,
  ): Promise<void> | void;

  onSessionStop?(
    session: BeatlyAdapterSessionContext,
    reason: string,
  ): Promise<void> | void;
}

export interface BeatlyTrack {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly bpm: number;
  readonly energy: number;
  readonly moods: readonly BeatlyMood[];
}

export type BeatlyMood =
  | "calming"
  | "deep-focus"
  | "flow"
  | "uplift"
  | "neutral";

export const BEATLY_ADAPTERS_VERSION = "0.1.0" as const;

export class ConsoleAdapter implements BeatlyAdapter {
  public readonly id = "console";

  onSessionStart(session: BeatlyAdapterSessionContext, state: BeatlyAdapterPlaybackState): void {
    console.info(`[beatly] session started`, { session, state });
  }

  onPlaybackUpdate(session: BeatlyAdapterSessionContext, state: BeatlyAdapterPlaybackState): void {
    console.info(`[beatly] playback update`, { sessionId: session.sessionId, state });
  }

  onSessionStop(session: BeatlyAdapterSessionContext, reason: string): void {
    console.info(`[beatly] session stopped`, { sessionId: session.sessionId, reason });
  }
}
