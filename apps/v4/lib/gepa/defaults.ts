import type {
  AgentConfig,
  AgentId,
  GlobalSettings,
  IterationDefaults,
  ProviderGeneration,
} from "./types"

export const DEFAULT_ITERATION: IterationDefaults = {
  budget: 60,
  minibatchSize: 3,
  paretoSize: 10,
  maxIterations: 20,
  moduleSelection: "round-robin",
  mergeEnabled: false,
}

export const DEFAULT_PROVIDER_GENERATION: ProviderGeneration = {
  reasoningEffort: "high",
  contextLength: 16,
  maxRetries: 2,
}

// 上下文长度以 k tokens 存储（1k = 1024 tokens）
const CONTEXT_LENGTH_MIN = 1
const CONTEXT_LENGTH_MAX = 1_000_000
const MAX_RETRIES_MIN = 0
const MAX_RETRIES_MAX = 5

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

function normalizeContextLength(value: unknown, fallback: number): number {
  return clampInteger(value, CONTEXT_LENGTH_MIN, CONTEXT_LENGTH_MAX, fallback)
}

export function normalizeProviderGeneration(
  value: unknown
): ProviderGeneration {
  const source =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const effort = source.reasoningEffort
  return {
    reasoningEffort:
      effort === "low" || effort === "high" || effort === "max"
        ? effort
        : DEFAULT_PROVIDER_GENERATION.reasoningEffort,
    contextLength: normalizeContextLength(
      source.contextLength,
      DEFAULT_PROVIDER_GENERATION.contextLength
    ),
    maxRetries: clampInteger(
      source.maxRetries,
      MAX_RETRIES_MIN,
      MAX_RETRIES_MAX,
      DEFAULT_PROVIDER_GENERATION.maxRetries
    ),
  }
}

export const AGENT_ORDER: AgentId[] = [
  "orchestrator",
  "controller",
  "executor",
  "evaluator",
  "reflector",
  "summarizer",
]

const EXECUTOR_PROMPT = `我向一个助手提供了以下指令来为我执行任务：

<当前指令>
{{skill}}
</当前指令>

以下是对助手提出的任务输入：

<任务输入>
{{input}}
</任务输入>

以下是前序模块的输出（可能为空）：

<前序输出>
{{previous}}
</前序输出>

以下是必须遵守的额外约束：

<额外约束>
{{constraints}}
</额外约束>

你的任务是严格按照当前指令处理任务输入，并直接给出结果。要求：
1. 遵守当前指令中的全部规则与格式要求。
2. 如果任务输入包含需要先复述、分解或逐步推理的要求，按指令执行。
3. 只输出任务结果本身，不要解释你的思考过程，也不要添加与任务无关的客套话。
4. 如果信息不足，明确说明缺少什么，并给出基于现有信息的最佳答案。`

const EVALUATOR_PROMPT = `以下是对助手提出的任务输入、参考输出，以及助手对任务输入的响应。

<任务输入>
{{input}}
</任务输入>

<参考输出（可能为空）>
{{expected}}
</参考输出>

<助手响应>
{{output}}
</助手响应>

<当前指令（用于理解任务目标）>
{{skill}}
</当前指令>

你的任务是根据任务输入、参考输出和当前指令，评估助手响应是否完成任务，并给出可执行的改进反馈。

评分标准：
- 1.0：完全满足任务要求，内容正确且完整。
- 0.7-0.9：基本正确，存在少量遗漏或格式问题。
- 0.4-0.6：部分正确，但存在明显错误或缺失关键信息。
- 0.0-0.3：错误、无关或未完成任务。
- 当参考输出为空时，依据当前指令判断响应质量。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要添加任何额外文字：
{"score":0.0,"feedback":"具体、可执行的改进建议","passed":false}`

const REFLECTOR_PROMPT = `我向一个助手提供了以下指令来为我执行任务：

<当前指令>
{{currentPrompt}}
</当前指令>

以下是对助手提出的不同任务输入示例，以及助手对每个输入的响应，以及关于助手响应如何可以更好的反馈：

<minibatch 示例的输入、输出和反馈>
{{traces}}
</minibatch 示例的输入、输出和反馈>

当前模块：{{moduleName}}
当前平均分：{{score}}
评估反馈：
{{feedback}}

你的任务是为助手编写新指令。要求：
1. 保留原指令中有效的部分，只做有针对性的修改。
2. 新增的规则必须具体、可执行，避免空泛表述。
3. 不要引入与任务无关的内容。
4. 新指令应保持结构清晰，便于模型直接使用。
5. 只修改当前模块的指令，不要改变其他模块的职责。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要添加任何额外文字：
{"newPrompt":"改进后的完整提示词","reasoning":"简要说明修改理由"}`

const ORCHESTRATOR_PROMPT = `以下是当前 GEPA 优化任务、运行状态、全局约束与最近对话历史。

<任务信息>
{{task}}
</任务信息>

<当前运行状态>
{{run}}
</当前运行状态>

<全局约束>
{{constraints}}
</全局约束>

<最近对话与运行历史>
{{history}}
</最近对话与运行历史>

<用户消息>
{{message}}
</用户消息>

你的任务是理解用户意图、用简洁的中文回复用户，并在确有必要时返回控制 GEPA 运行的操作。

可返回的操作（actions 数组，可为空）：
- {"type":"start"}：开始运行
- {"type":"pause"}：暂停
- {"type":"resume"}：继续
- {"type":"stop"}：停止
- {"type":"step"}：单步执行
- {"type":"setBudget","budget":数字}：设置预算
- {"type":"setMinibatch","minibatchSize":数字}：设置 minibatch 大小
- {"type":"setIterationLimit","maxIterations":数字}：设置最大迭代轮数
- {"type":"updateModulePrompt","moduleId":"模块 id","prompt":"新提示词"}：更新模块提示词
- {"type":"note","note":"说明"}：记录一条备注

要求：
1. 只在用户明确要求或确有必要时返回操作。
2. 不要编造任务中不存在的数据。
3. 回复使用中文。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要添加任何额外文字：
{"reply":"给用户的回复","actions":[]}`

export const CONTROLLER_PROMPT = `以下是当前 GEPA 控制台的全部任务、运行状态、全局约束与最近对话历史。

<任务列表>
{{tasks}}
</任务列表>

<全局约束>
{{constraints}}
</全局约束>

<最近对话与运行历史>
{{history}}
</最近对话与运行历史>

<用户消息>
{{message}}
</用户消息>

你的任务是理解用户意图、用简洁的中文回复用户，并在确有必要时跨任务派发或管理 GEPA 任务。

可返回的操作（actions 数组，可为空；除 createTask 外，任务操作必须带 taskId）：
- {"type":"createTask","name":"任务名称","description":"可选描述","prompt":"可选初始技能提示词","datasetText":"可选，每行一个输入"}
- {"type":"deleteTask","taskId":"任务 id"}
- {"type":"updateTask","taskId":"任务 id","name":"新名称","description":"新描述"}
- {"type":"start","taskId":"任务 id"}
- {"type":"pause","taskId":"任务 id"}
- {"type":"resume","taskId":"任务 id"}
- {"type":"stop","taskId":"任务 id"}
- {"type":"step","taskId":"任务 id"}
- {"type":"setBudget","taskId":"任务 id","budget":数字}
- {"type":"setMinibatch","taskId":"任务 id","minibatchSize":数字}
- {"type":"setIterationLimit","taskId":"任务 id","maxIterations":数字}
- {"type":"updateModulePrompt","taskId":"任务 id","moduleId":"模块 id","prompt":"新提示词"}
- {"type":"note","taskId":"任务 id","note":"说明"}

要求：
1. 只能使用任务列表中存在的 taskId，不得编造任务或 id。
2. 创建任务时 name 必填；datasetText 每行一个输入示例。
3. 只在用户明确要求或确有必要时返回操作。
4. 删除任务不可撤销，执行前必须在回复中说明。
5. 一次最多返回 10 个操作，按顺序执行。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要添加任何额外文字：
{"reply":"给用户的回复","actions":[]}`

const SUMMARIZER_PROMPT = `以下是当前 GEPA 优化任务的运行信息。

<任务>
{{task}}
</任务>

<运行状态>
{{run}}
</运行状态>

<候选列表>
{{candidates}}
</候选列表>

你的任务是用简洁的中文总结当前运行情况（不超过 200 字），包含：
1. 当前最佳候选及其平均分。
2. 本轮迭代的主要改进或退步。
3. 下一步建议。

直接输出摘要正文，不要使用 JSON、Markdown 标题或额外前缀。`

const DEFAULT_AGENT_DEFINITIONS: Omit<AgentConfig, "updatedAt">[] = [
  {
    id: "orchestrator",
    name: "总控助手",
    description: "与用户对话，理解意图并控制运行流程。",
    enabled: true,
    providerId: null,
    model: "",
    prompt: ORCHESTRATOR_PROMPT,
  },
  {
    id: "controller",
    name: "全局调度器",
    description: "与用户对话，跨任务派发、启动、暂停和管理 GEPA 任务。",
    enabled: true,
    providerId: null,
    model: "",
    prompt: CONTROLLER_PROMPT,
  },
  {
    id: "executor",
    name: "执行器",
    description: "使用当前技能提示完成单个任务输入。",
    enabled: true,
    providerId: null,
    model: "",
    prompt: EXECUTOR_PROMPT,
  },
  {
    id: "evaluator",
    name: "评估器",
    description: "对执行结果评分并给出可执行的反馈。",
    enabled: true,
    providerId: null,
    model: "",
    prompt: EVALUATOR_PROMPT,
  },
  {
    id: "reflector",
    name: "反思器",
    description: "根据执行轨迹与反馈生成改进后的模块提示词。",
    enabled: true,
    providerId: null,
    model: "",
    prompt: REFLECTOR_PROMPT,
  },
  {
    id: "summarizer",
    name: "摘要器",
    description: "汇总运行状态、候选结果与下一步建议。",
    enabled: true,
    providerId: null,
    model: "",
    prompt: SUMMARIZER_PROMPT,
  },
]

export const DEFAULT_AGENTS: AgentConfig[] = DEFAULT_AGENT_DEFINITIONS.map(
  (agent) => ({ ...agent, updatedAt: "1970-01-01T00:00:00.000Z" })
)

export function createDefaultAgents(): AgentConfig[] {
  const now = new Date().toISOString()
  return DEFAULT_AGENT_DEFINITIONS.map((agent) => ({
    ...agent,
    updatedAt: now,
  }))
}

export function createDefaultSettings(): GlobalSettings {
  return {
    version: 1,
    defaultProviderId: null,
    iteration: { ...DEFAULT_ITERATION },
    constraints: {
      tools: {
        enabled: true,
        allowedTools: ["read_file", "write_file", "list_dir", "search", "bash"],
        deniedTools: ["network", "delete"],
        maxCallsPerIteration: 40,
        requireApprovalForWrite: false,
        allowNetwork: false,
        allowedHosts: [],
      },
      bash: {
        enabled: true,
        allowedCommands: [
          "ls",
          "pwd",
          "cat",
          "head",
          "tail",
          "grep",
          "rg",
          "find",
          "wc",
          "echo",
          "node",
          "npm",
          "pnpm",
          "npx",
          "tsc",
          "git",
          "python",
          "python3",
          "mkdir",
          "cp",
          "mv",
          "touch",
        ],
        deniedCommands: [
          "rm",
          "sudo",
          "shutdown",
          "reboot",
          "mkfs",
          "dd",
          "chmod",
          "chown",
          "kill",
          "pkill",
          "curl",
          "wget",
        ],
        allowShellOperators: false,
        timeoutMs: 30000,
        maxOutputBytes: 100000,
        workingDirOnly: true,
      },
    },
    monitor: {
      inputCostPerMillion: 0,
      outputCostPerMillion: 0,
      cacheCostPerMillion: 0,
      retentionDays: 30,
    },
    updatedAt: new Date().toISOString(),
  }
}
