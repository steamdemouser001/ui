import type { AgentId } from "@/lib/gepa/types"

/** 每个 Agent 默认提示词中可用的模板变量（运行时由 {{name}} 替换）。 */
export const AGENT_VARIABLES: Record<AgentId, string[]> = {
  orchestrator: ["task", "run", "constraints", "history", "message"],
  controller: ["tasks", "constraints", "history", "message"],
  executor: ["skill", "input", "previous", "constraints"],
  evaluator: ["input", "expected", "output", "skill"],
  reflector: ["moduleName", "currentPrompt", "traces", "score", "feedback"],
  summarizer: ["task", "run", "candidates"],
  analyst: ["digest", "configs"],
}
