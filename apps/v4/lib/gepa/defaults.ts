import type {
  AgentConfig,
  AgentId,
  GlobalSettings,
  IterationDefaults,
} from "./types"

export const DEFAULT_ITERATION: IterationDefaults = {
  budget: 60,
  minibatchSize: 3,
  paretoSize: 10,
  maxIterations: 20,
  moduleSelection: "round-robin",
  mergeEnabled: false,
}

export const AGENT_ORDER: AgentId[] = [
  "orchestrator",
  "executor",
  "evaluator",
  "reflector",
  "summarizer",
]

const EXECUTOR_PROMPT = `你是一个任务执行器，负责按照给定的技能提示完成单个输入。

## 技能提示
{{skill}}

## 任务输入
{{input}}

## 上一轮结果（可能为空）
{{previous}}

## 额外约束
{{constraints}}

要求：
1. 严格遵循技能提示与额外约束。
2. 只输出任务结果本身，不要解释你的思考过程，也不要添加与任务无关的客套话。
3. 如果信息不足，明确说明缺少什么，并给出基于现有信息的最佳答案。`

const EVALUATOR_PROMPT = `你是一个严格的评估器，需要根据任务输入、期望输出和实际输出给出评分。

## 任务输入
{{input}}

## 期望输出（可能为空）
{{expected}}

## 实际输出
{{output}}

## 技能提示（用于理解任务目标）
{{skill}}

评分标准：
- 1.0：完全满足任务要求，内容正确且完整。
- 0.7-0.9：基本正确，存在少量遗漏或格式问题。
- 0.4-0.6：部分正确，但存在明显错误或缺失关键信息。
- 0.0-0.3：错误、无关或未完成任务。
- 当期望输出为空时，依据技能提示判断输出质量。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要添加任何额外文字：
{"score":0.0,"feedback":"具体、可执行的改进建议","passed":false}`

const REFLECTOR_PROMPT = `你是一个提示词优化专家，负责根据执行轨迹和反馈改进模块提示词。

## 模块名称
{{moduleName}}

## 当前提示词
{{currentPrompt}}

## 执行轨迹
{{traces}}

## 当前平均分
{{score}}

## 评估反馈
{{feedback}}

请诊断当前提示词在哪些方面导致失败或得分不高，并提出一个改进版本。要求：
1. 保留原提示词中有效的部分，只做有针对性的修改。
2. 新增的规则必须具体、可执行，避免空泛表述。
3. 不要引入与任务无关的内容。
4. 新提示词应保持结构清晰，便于模型直接使用。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要添加任何额外文字：
{"newPrompt":"改进后的完整提示词","reasoning":"简要说明修改理由"}`

const ORCHESTRATOR_PROMPT = `你是 GEPA 技能迭代控制台的总控助手，负责与用户对话并决定下一步操作。

## 任务信息
{{task}}

## 当前运行状态
{{run}}

## 全局约束
{{constraints}}

## 最近对话与运行历史
{{history}}

## 用户消息
{{message}}

你可以返回以下操作（actions 数组，可为空）：
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
1. 用简洁的中文回复用户。
2. 只在用户明确要求或确有必要时返回操作。
3. 不要编造任务中不存在的数据。

只输出一个 JSON 对象，不要使用 Markdown 代码块，不要添加任何额外文字：
{"reply":"给用户的回复","actions":[]}`

const SUMMARIZER_PROMPT = `你是一个运行摘要助手，负责用简洁的中文总结当前 GEPA 运行情况。

## 任务
{{task}}

## 运行状态
{{run}}

## 候选列表
{{candidates}}

请输出一段简洁的中文摘要（不超过 200 字），包含：
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
    temperature: 0.3,
    maxTokens: 2048,
    prompt: ORCHESTRATOR_PROMPT,
  },
  {
    id: "executor",
    name: "执行器",
    description: "使用当前技能提示完成单个任务输入。",
    enabled: true,
    providerId: null,
    model: "",
    temperature: 0.2,
    maxTokens: 4096,
    prompt: EXECUTOR_PROMPT,
  },
  {
    id: "evaluator",
    name: "评估器",
    description: "对执行结果评分并给出可执行的反馈。",
    enabled: true,
    providerId: null,
    model: "",
    temperature: 0,
    maxTokens: 1024,
    prompt: EVALUATOR_PROMPT,
  },
  {
    id: "reflector",
    name: "反思器",
    description: "根据执行轨迹与反馈生成改进后的模块提示词。",
    enabled: true,
    providerId: null,
    model: "",
    temperature: 0.4,
    maxTokens: 4096,
    prompt: REFLECTOR_PROMPT,
  },
  {
    id: "summarizer",
    name: "摘要器",
    description: "汇总运行状态、候选结果与下一步建议。",
    enabled: true,
    providerId: null,
    model: "",
    temperature: 0.3,
    maxTokens: 1024,
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
      retentionDays: 30,
    },
    updatedAt: new Date().toISOString(),
  }
}
