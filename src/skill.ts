import type { BeatlyDecision, BeatlyEngine, BeatlySignal, BeatlySession, StartSessionOptions } from "./index.js";

export type AgentEvent =
  | { readonly type: "task.started"; readonly timestamp?: Date }
  | { readonly type: "task.blocked"; readonly timestamp?: Date }
  | { readonly type: "task.completed"; readonly timestamp?: Date }
  | { readonly type: "agent.idle"; readonly timestamp?: Date };

export interface BeatlySkillOptions {
  readonly mapEventToSignal?: (event: AgentEvent) => BeatlySignal | null;
}

export interface BeatlySkill {
  start(options: StartSessionOptions): Promise<BeatlySession>;
  handleEvent(event: AgentEvent): Promise<BeatlyDecision | null>;
  stop(reason?: string): Promise<void>;
}

export function createBeatlySkill(engine: BeatlyEngine, options: BeatlySkillOptions = {}): BeatlySkill {
  const mapEventToSignal = options.mapEventToSignal ?? defaultEventToSignal;

  return {
    start(startOptions: StartSessionOptions) {
      return engine.startSession(startOptions);
    },

    async handleEvent(event: AgentEvent): Promise<BeatlyDecision | null> {
      const signal = mapEventToSignal(event);
      if (signal === null) {
        return null;
      }

      return engine.ingestSignal(signal);
    },

    stop(reason?: string) {
      return engine.stopSession(reason);
    },
  };
}

function defaultEventToSignal(event: AgentEvent): BeatlySignal | null {
  const withTimestamp = <T extends Omit<BeatlySignal, "timestamp">>(signal: T): BeatlySignal => {
    if (event.timestamp === undefined) {
      return signal;
    }

    return { ...signal, timestamp: event.timestamp };
  };

  switch (event.type) {
    case "task.started":
      return withTimestamp({ focus: 0.65, cognitiveLoad: 0.45, energy: 0.6 });
    case "task.blocked":
      return withTimestamp({ focus: 0.45, cognitiveLoad: 0.9, energy: 0.35 });
    case "task.completed":
      return withTimestamp({ focus: 0.82, cognitiveLoad: 0.3, energy: 0.8 });
    case "agent.idle":
      return withTimestamp({ focus: 0.2, cognitiveLoad: 0.1, energy: 0.2 });
    default:
      return null;
  }
}

export const BEATLY_SKILL_VERSION = "0.1.0" as const;
