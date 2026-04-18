import type { BeatlyAgentSignal, BeatlyConductor, BeatlyPlaybackDirective, BeatlySession, StartSessionOptions } from "./index.js";

export type AgentEvent =
  | { readonly type: "task.started"; readonly timestamp?: Date }
  | { readonly type: "task.blocked"; readonly timestamp?: Date }
  | { readonly type: "task.completed"; readonly timestamp?: Date }
  | { readonly type: "agent.idle"; readonly timestamp?: Date }
  | { readonly type: "agent.error"; readonly timestamp?: Date }
  | { readonly type: "agent.breakthrough"; readonly timestamp?: Date };

export interface BeatlySkillOptions {
  readonly mapEventToSignal?: (event: AgentEvent) => BeatlyAgentSignal | null;
}

export interface BeatlySkill {
  start(options: StartSessionOptions): Promise<BeatlySession>;
  handleEvent(event: AgentEvent): Promise<BeatlyPlaybackDirective | null>;
  stop(reason?: string): Promise<void>;
}

export function createBeatlySkill(conductor: BeatlyConductor, options: BeatlySkillOptions = {}): BeatlySkill {
  const mapEventToSignal = options.mapEventToSignal ?? defaultEventToSignal;

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

export const BEATLY_SKILL_VERSION = "0.2.0" as const;
