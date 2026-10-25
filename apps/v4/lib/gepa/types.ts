export type LlmProviderKind = "openai-compatible" | "anthropic"

export type ReasoningEffort = "low" | "high" | "max"

export interface ProviderGeneration {
  reasoningEffort: ReasoningEffort
  contextLength: number // 上下文窗口，单位 k tokens（1k = 1024 tokens，输入+输出）
  maxRetries: number // 失败重试次数
}

export interface LlmProvider {
  id: string
  name: string
  kind: LlmProviderKind
  baseUrl: string
  apiKey: string
  models: string[]
  defaultModel: string
  generation: ProviderGeneration
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type AgentId =
  | "orchestrator"
  | "controller"
  | "executor"
  | "evaluator"
  | "reflector"
  | "summarizer"
  | "analyst"

export interface AgentConfig {
  id: AgentId
  name: string
  description: string
  enabled: boolean
  providerId: string | null
  model: string
  prompt: string
  updatedAt: string
}

export type HarnessKind = "llm" | "claude-code"

/** 执行器后端配置：默认走单次 LLM 补全，可切换为 Claude Code 会话。 */
export interface HarnessConfig {
  kind: HarnessKind
  claudePath: string
  model: string
  allowedTools: string[]
  maxUsdPerRollout: number
  maxUsdPerRun: number
  timeoutMs: number
  maxConcurrent: number
}

export interface IterationDefaults {
  budget: number
  minibatchSize: number
  paretoSize: number
  maxIterations: number
  moduleSelection: "round-robin" | "random"
  mergeEnabled: boolean
  /** 接受变异候选前是否需要人工审批。 */
  humanApproval?: boolean
}

export interface ToolConstraints {
  enabled: boolean
  allowedTools: string[]
  deniedTools: string[]
  maxCallsPerIteration: number
  requireApprovalForWrite: boolean
  allowNetwork: boolean
  allowedHosts: string[]
}

export interface BashConstraints {
  enabled: boolean
  allowedCommands: string[]
  deniedCommands: string[]
  allowShellOperators: boolean
  timeoutMs: number
  maxOutputBytes: number
  workingDirOnly: boolean
}

export interface GlobalConstraints {
  tools: ToolConstraints
  bash: BashConstraints
}

export interface MonitorConfig {
  inputCostPerMillion: number
  outputCostPerMillion: number
  cacheCostPerMillion: number // 缓存 Token 单价（每百万）
  retentionDays: number
}

export interface GlobalSettings {
  version: number
  defaultProviderId: string | null
  iteration: IterationDefaults
  constraints: GlobalConstraints
  monitor: MonitorConfig
  harness: HarnessConfig
  updatedAt: string
}

export interface SkillModule {
  id: string
  name: string
  description: string
  prompt: string
}

export interface DatasetExample {
  id: string
  input: string
  expected?: string
  metadata?: Record<string, unknown>
}

export type TaskStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"

export interface TaskRecord {
  id: string
  name: string
  description: string
  status: TaskStatus
  modules: SkillModule[]
  dataset: DatasetExample[]
  iteration: IterationDefaults
  createdAt: string
  updatedAt: string
  runId: string | null
  notes: string
  /** 可选：在工作空间内执行的测试命令，用于可验证评分。 */
  testCommand?: string
}

export interface ToolCallTrace {
  name: string
  input: string
  output?: string
  isError?: boolean
}

export interface TraceStep {
  moduleId: string
  moduleName: string
  prompt: string
  input: string
  output: string
  durationMs: number
  toolCalls?: ToolCallTrace[]
  exitCode?: number | null
  stdout?: string
  stderr?: string
  costUsd?: number
}

export interface ExampleTrace {
  exampleId: string
  input: string
  expected?: string
  output: string
  score: number
  feedback: string
  steps: TraceStep[]
  error?: string
  /** 本次 rollout 的隔离工作目录（Claude Code 模式）。 */
  rolloutDir?: string
}

export interface Candidate {
  id: string
  parentId: string | null
  iteration: number
  moduleId: string | null
  modules: SkillModule[]
  scores: Record<string, number>
  averageScore: number
  reflections: string[]
  createdAt: string
}

export type RunStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "stopped"
  | "failed"

export interface RunLogEntry {
  id: string
  at: string
  level: "info" | "success" | "warning" | "error"
  message: string
  iteration?: number
}

export interface IterationRecord {
  index: number
  candidateId: string
  moduleId: string
  beforeScore: number
  afterScore: number | null
  accepted: boolean
  /** 人工审批结果（开启 humanApproval 时记录）。 */
  humanDecision?: "approved" | "rejected"
  reflection?: string
  traces: ExampleTrace[]
  startedAt: string
  finishedAt?: string
}

/** 运行内实时进度：描述引擎当前正在做什么，供 UI 直播展示。 */
export type RunPhase =
  | "seed"
  | "parent-rollout"
  | "evaluation"
  | "reflection"
  | "child-rollout"
  | "pareto-eval"
  | "idle"

export interface RunProgress {
  phase: RunPhase
  /** 人类可读的当前动作描述（中文）。 */
  label: string
  iteration: number
  candidateId?: string
  moduleId?: string
  moduleName?: string
  exampleId?: string
  exampleIndex?: number
  exampleTotal?: number
  rolloutDir?: string
  /** 最近一次观察到的工具调用名（Claude Code 模式）。 */
  toolName?: string
  startedAt: string
}

/** 等待人工审批的变异候选。 */
export interface PendingApproval {
  iteration: number
  candidateId: string
  moduleId: string
  moduleName: string
  parentCandidateId: string | null
  beforeScore: number
  afterScore: number
  reflection: string
  oldPrompt: string
  newPrompt: string
  createdAt: string
}

/** 运行事件：引擎通过进程内事件总线广播，SSE 转发给前端。 */
export type RunEventType =
  | "iteration-start"
  | "iteration-end"
  | "rollout-start"
  | "tool-activity"
  | "progress"
  | "approval-requested"
  | "approval-resolved"

export interface RunEvent {
  type: RunEventType
  taskId: string
  runId: string
  at: string
  data: Record<string, unknown>
}

export interface RunState {
  id: string
  taskId: string
  status: RunStatus
  iteration: number
  budget: number
  budgetUsed: number
  candidates: Candidate[]
  paretoFrontier: string[]
  bestCandidateId: string | null
  iterations: IterationRecord[]
  logs: RunLogEntry[]
  feedbackSplit: string[]
  paretoSplit: string[]
  moduleCursor: number
  startedAt: string
  updatedAt: string
  finishedAt?: string
  error?: string
  harness?: { kind: HarnessKind; model: string; claudeVersion?: string }
  totalCostUsd?: number
  /** 迭代内实时进度；仅在运行中有意义。 */
  progress?: RunProgress
  /** 开启人工审批时，接受候选前的等待项。 */
  pendingApproval?: PendingApproval
  control: { pauseRequested: boolean; stopRequested: boolean }
}

export interface OrchestratorMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  at: string
  actions?: OrchestratorAction[]
}

export interface ChatSessionMeta {
  id: string
  title: string
  titleAuto: boolean
  preview: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface OrchestratorAction {
  type:
    | "start"
    | "pause"
    | "resume"
    | "stop"
    | "step"
    | "setBudget"
    | "setMinibatch"
    | "setIterationLimit"
    | "updateModulePrompt"
    | "approve"
    | "reject"
    | "promote"
    | "note"
    | "createTask"
    | "deleteTask"
    | "updateTask"
  taskId?: string
  candidateId?: string
  name?: string
  description?: string
  datasetText?: string
  budget?: number
  minibatchSize?: number
  maxIterations?: number
  moduleId?: string
  prompt?: string
  note?: string
}

export interface LlmCallLog {
  id: string
  at: string
  providerId: string
  providerName: string
  model: string
  agentId: string
  taskId?: string
  runId?: string
  inputTokens: number
  outputTokens: number
  cacheTokens?: number // 旧日志缺失时按 0
  durationMs: number
  success: boolean
  error?: string
  harness?: HarnessKind
  costUsd?: number
}
