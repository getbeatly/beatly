import { BeatlyConductor } from "./index.js";
import { SuperColliderHelloAdapter } from "./adapters.js";
import { createBeatlySkill, type AgentEvent } from "./skill.js";

const event = process.argv[2] as AgentEvent["type"] | undefined;

if (event === undefined) {
  console.error("Usage: node dist/cli.js <task.started|task.blocked|task.completed|agent.idle|agent.error|agent.breakthrough>");
  process.exit(1);
}

const adapter = new SuperColliderHelloAdapter({ autostart: true });
await adapter.ensureReady();

const conductor = new BeatlyConductor({ adapters: [adapter] });
const skill = createBeatlySkill(conductor);

await skill.start({ agentId: "cli" });
const directive = await skill.handleEvent({ type: event, timestamp: new Date() });
console.log(JSON.stringify(directive, null, 2));
