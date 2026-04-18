import type {
  BeatlyAgentSignal,
  BeatlyConductor,
  BeatlyPlaybackDirective,
  BeatlyPlaybackOverride,
  BeatlySession,
  StartSessionOptions,
} from "./index.js";

export type AgentEvent =
  | { readonly type: "task.started"; readonly timestamp?: Date }
  | { readonly type: "task.blocked"; readonly timestamp?: Date }
  | { readonly type: "task.completed"; readonly timestamp?: Date }
  | { readonly type: "agent.idle"; readonly timestamp?: Date }
  | { readonly type: "agent.error"; readonly timestamp?: Date }
  | { readonly type: "agent.breakthrough"; readonly timestamp?: Date };

export type AgentStatus = "thinking" | "coding" | "reviewing" | "waiting" | "celebrating";

export interface AgentStatusUpdate {
  readonly type: "agent.update";
  readonly status: AgentStatus;
  readonly summary?: string;
  readonly signal?: Partial<BeatlyAgentSignal>;
  readonly timestamp?: Date;
}

export interface PlaybackOverrideUpdate {
  readonly type: "playback.override";
  readonly playback: BeatlyPlaybackOverride;
}

export type BeatlyAgentUpdate = AgentEvent | AgentStatusUpdate | PlaybackOverrideUpdate;

export interface BeatlySkillOptions {
  readonly mapEventToSignal?: (event: AgentEvent) => BeatlyAgentSignal | null;
  readonly mapStatusToSignal?: (update: AgentStatusUpdate) => BeatlyAgentSignal;
}

export interface BeatlySkill {
  start(options: StartSessionOptions): Promise<BeatlySession>;
  handleEvent(event: AgentEvent): Promise<BeatlyPlaybackDirective | null>;
  handleUpdate(update: BeatlyAgentUpdate): Promise<BeatlyPlaybackDirective | null>;
  override(playback: BeatlyPlaybackOverride): Promise<BeatlyPlaybackDirective>;
  stop(reason?: string): Promise<void>;
}

export function createBeatlySkill(conductor: BeatlyConductor, options: BeatlySkillOptions = {}): BeatlySkill {
  const mapEventToSignal = options.mapEventToSignal ?? defaultEventToSignal;
  const mapStatusToSignal = options.mapStatusToSignal ?? defaultStatusToSignal;

  return {
    start(options: StartSessionOptions) {
      return conductor.startSession(options);
    },

    async handleEvent(event: AgentEvent): Promise<BeatlyPlaybackDirective | null> {
      const signal = mapEventToSignal(event);
      if (signal === null) {
        return null;
      }

      return conductor.updateFromSignal(signal, event.type);
    },

    async handleUpdate(update: BeatlyAgentUpdate): Promise<BeatlyPlaybackDirective | null> {
      if (update.type === "agent.update") {
        const baseSignal = mapStatusToSignal(update);
        const signal = mergeSignal(baseSignal, update.signal, update.timestamp);
        return conductor.updateFromSignal(signal, update.summary ?? `agent.update:${update.status}`);
      }

      if (update.type === "playback.override") {
        return conductor.applyPlaybackOverride(update.playback);
      }

      return this.handleEvent(update);
    },

    override(playback: BeatlyPlaybackOverride) {
      return conductor.applyPlaybackOverride(playback);
    },

    stop(reason?: string) {
      return conductor.stopSession(reason);
    },
  };
}

function defaultEventToSignal(event: AgentEvent): BeatlyAgentSignal | null {
  const withTimestamp = <T extends Omit<BeatlyAgentSignal, "timestamp">>(signal: T): BeatlyAgentSignal => {
    if (event.timestamp === undefined) {
      return signal;
    }

    return { ...signal, timestamp: event.timestamp };
  };

  switch (event.type) {
    case "task.started":
      return withTimestamp({ focus: 0.68, cognitiveLoad: 0.4, energy: 0.58 });
    case "task.blocked":
      return withTimestamp({ focus: 0.45, cognitiveLoad: 0.92, energy: 0.32 });
    case "task.completed":
      return withTimestamp({ focus: 0.82, cognitiveLoad: 0.28, energy: 0.86 });
    case "agent.idle":
      return withTimestamp({ focus: 0.2, cognitiveLoad: 0.08, energy: 0.18 });
    case "agent.error":
      return withTimestamp({ focus: 0.52, cognitiveLoad: 0.95, energy: 0.42 });
    case "agent.breakthrough":
      return withTimestamp({ focus: 0.9, cognitiveLoad: 0.22, energy: 0.94 });
    default:
      return null;
  }
}

function defaultStatusToSignal(update: AgentStatusUpdate): BeatlyAgentSignal {
  const base = (() => {
    switch (update.status) {
      case "thinking":
        return { focus: 0.72, cognitiveLoad: 0.62, energy: 0.38 };
      case "coding":
        return { focus: 0.84, cognitiveLoad: 0.42, energy: 0.68 };
      case "reviewing":
        return { focus: 0.76, cognitiveLoad: 0.5, energy: 0.46 };
      case "waiting":
        return { focus: 0.24, cognitiveLoad: 0.18, energy: 0.16 };
      case "celebrating":
        return { focus: 0.88, cognitiveLoad: 0.2, energy: 0.94 };
    }
  })();

  return update.timestamp === undefined ? base : { ...base, timestamp: update.timestamp };
}

function mergeSignal(
  base: BeatlyAgentSignal,
  patch: Partial<BeatlyAgentSignal> | undefined,
  timestamp: Date | undefined,
): BeatlyAgentSignal {
  const merged = {
    focus: clamp01(patch?.focus ?? base.focus),
    cognitiveLoad: clamp01(patch?.cognitiveLoad ?? base.cognitiveLoad),
    energy: clamp01(patch?.energy ?? base.energy),
  };

  const nextTimestamp = timestamp ?? patch?.timestamp ?? base.timestamp;
  return nextTimestamp === undefined ? merged : { ...merged, timestamp: nextTimestamp };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export const BEATLY_SKILL_VERSION = "0.3.0" as const;
