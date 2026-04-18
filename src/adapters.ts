import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";

import type { BeatlyPlaybackDirective } from "./index.js";
import type { BeatlyGenreId } from "./genres.js";

export interface SuperColliderServerState {
  readonly profile: string;
  readonly genre?: string;
  readonly variant?: string;
  readonly seed: number;
  readonly bpm: number | null;
  readonly bar: number;
  readonly running: boolean;
  readonly profiles: readonly string[];
  readonly genres?: readonly {
    readonly id: string;
    readonly defaultVariant: string;
    readonly variants: readonly string[];
  }[];
  readonly lastAgentEvent?: string | null;
}

export interface SuperColliderAgentEventPayload {
  readonly event: string;
  readonly seed?: number;
}

export interface SuperColliderHelloAdapterOptions {
  readonly baseUrl?: string;
  readonly autostart?: boolean;
  readonly serverCwd?: string;
  readonly serverScript?: string;
  readonly spawnCommand?: string;
  readonly spawnArgs?: readonly string[];
  readonly startupTimeoutMs?: number;
  /**
   * Spawn the server detached from the parent process so short-lived one-shot
   * drivers (e.g. the Codex/Claude Code skill wrappers) can exit without
   * killing the Beatly daemon. Defaults to true.
   */
  readonly detached?: boolean;
}

export class SuperColliderHelloAdapter {
  public readonly id = "beatly-supercollider";

  private readonly baseUrl: string;
  private readonly autostart: boolean;
  private readonly serverCwd: string;
  private readonly serverScript: string;
  private readonly spawnCommand: string;
  private readonly spawnArgs: readonly string[];
  private readonly startupTimeoutMs: number;
  private readonly detached: boolean;

  private child: ChildProcess | null = null;

  constructor(options: SuperColliderHelloAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:8080";
    this.autostart = options.autostart ?? false;
    this.serverCwd = resolve(options.serverCwd ?? "./supercollider");
    this.serverScript = options.serverScript ?? "server.js";
    this.spawnCommand = options.spawnCommand ?? "node";
    this.spawnArgs = options.spawnArgs ?? [this.serverScript];
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15_000;
    this.detached = options.detached ?? true;
  }

  public async ensureReady(): Promise<SuperColliderServerState> {
    try {
      return await this.getState();
    } catch (error) {
      if (!this.autostart) {
        throw error;
      }
    }

    await this.startServer();
    return this.waitForReady();
  }

  public async startServer(): Promise<void> {
    if (this.child !== null) {
      return;
    }

    await access(resolve(this.serverCwd, this.serverScript), fsConstants.R_OK);

    if (this.detached) {
      // Daemon mode: spawn fully detached with no shared stdio, then release
      // the handle so the parent (e.g. a one-shot skill driver) can exit
      // without tearing the Beatly server down via SIGPIPE / fd close.
      const child = spawn(this.spawnCommand, [...this.spawnArgs], {
        cwd: this.serverCwd,
        env: process.env,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      // We intentionally drop the handle — ownership transfers to the OS.
      // stopServer() becomes a no-op in detached mode; use the HTTP
      // `session.stop` agent event / the dashboard to stop playback.
      this.child = null;
      return;
    }

    this.child = spawn(this.spawnCommand, [...this.spawnArgs], {
      cwd: this.serverCwd,
      stdio: "inherit",
      env: process.env,
    });

    this.child.once("exit", () => {
      this.child = null;
    });
  }

  public async getState(): Promise<SuperColliderServerState> {
    const response = await fetch(`${this.baseUrl}/api/state`);
    if (!response.ok) {
      throw new Error(`Failed to read SuperCollider state: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as SuperColliderServerState;
  }

  public async setProfile(profile: BeatlyGenreId, seed?: number): Promise<SuperColliderServerState> {
    return this.postControl({ profile, seed });
  }

  public async setGenre(genre: BeatlyGenreId, variant?: string, seed?: number): Promise<SuperColliderServerState> {
    return this.postControl({ genre, variant, seed });
  }

  public async setVariant(variant: string): Promise<SuperColliderServerState> {
    return this.postControl({ variant });
  }

  public async setRunning(running: boolean): Promise<SuperColliderServerState> {
    return this.postControl({ running });
  }

  public async randomize(): Promise<SuperColliderServerState> {
    return this.postControl({ randomize: true });
  }

  public async applyDirective(directive: BeatlyPlaybackDirective): Promise<SuperColliderServerState> {
    const profile = directive.variant ? `${directive.genre}.${directive.variant}` : directive.genre;
    return this.postControl({
      profile,
      seed: directive.seed,
      running: directive.running,
    });
  }

  public async sendAgentEvent(payload: SuperColliderAgentEventPayload): Promise<SuperColliderServerState> {
    return this.postAgent(payload);
  }

  public async panic(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/panic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Failed to panic SuperCollider server: ${response.status} ${response.statusText}`);
    }
  }

  public stopServer(): void {
    if (this.child === null) {
      return;
    }

    this.child.kill("SIGTERM");
    this.child = null;
  }

  private async waitForReady(): Promise<SuperColliderServerState> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.startupTimeoutMs) {
      try {
        return await this.getState();
      } catch {
        await sleep(250);
      }
    }

    throw new Error(`Timed out waiting for SuperCollider server at ${this.baseUrl}`);
  }

  private async postControl(body: Record<string, unknown>): Promise<SuperColliderServerState> {
    const response = await fetch(`${this.baseUrl}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to control SuperCollider server: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { readonly state?: SuperColliderServerState };
    return payload.state ?? this.getState();
  }

  private async postAgent(body: SuperColliderAgentEventPayload): Promise<SuperColliderServerState> {
    const response = await fetch(`${this.baseUrl}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to send agent event: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { readonly state?: SuperColliderServerState };
    return payload.state ?? this.getState();
  }
}

export class ConsoleDirectiveAdapter {
  public readonly id = "console";

  public async applyDirective(directive: BeatlyPlaybackDirective): Promise<void> {
    console.info("[beatly] playback directive", directive);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
