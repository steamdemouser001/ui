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
  | "executor"
  | "evaluator"
  | "reflector"
  | "summarizer"

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

export interface IterationDefaults {
  budget: number
  minibatchSize: number
  paretoSize: number
  maxIterations: number
  moduleSelection: "round-robin" | "random"
  mergeEnabled: boolean
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
}

export interface TraceStep {
  moduleId: string
  moduleName: string
  prompt: string
  input: string
  output: string
  durationMs: number
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
  reflection?: string
  traces: ExampleTrace[]
  startedAt: string
  finishedAt?: string
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
  control: { pauseRequested: boolean; stopRequested: boolean }
}

export interface OrchestratorMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  at: string
  actions?: OrchestratorAction[]
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
    | "note"
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
}
