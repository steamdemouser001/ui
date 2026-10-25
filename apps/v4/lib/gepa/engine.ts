import { randomUUID } from "node:crypto"

import { describeConstraints } from "./constraints"
import { HarnessAbortError, runClaudeCode } from "./harness"
import { parseJsonLoose, runAgent, runAgentJson } from "./llm"
import { emitRunEvent } from "./run-events"
import { runRawCommand } from "./sandbox"
import { prepareRollout } from "./storage"
import type {
  Candidate,
  DatasetExample,
  ExampleTrace,
  GlobalSettings,
  IterationRecord,
  RunLogEntry,
  RunEventType,
  RunPhase,
  RunProgress,
  RunState,
  SkillModule,
  TaskRecord,
  ToolCallTrace,
  TraceStep,
} from "./types"

/** 分数比较容差：用于帕累托并列判断。 */
export const SCORE_EPSILON = 1e-9

/** 样本 rollout 的进度上下文，随执行传给事件钩子。 */
export interface RolloutProgressContext {
  phase: RunPhase
  iteration: number
  moduleId?: string
  moduleName?: string
}

/** 引擎执行过程中的实时回调，由 runIteration 注入以驱动进度与事件。 */
export interface EngineHooks {
  /** Claude Code 工具调用发生时回调（实时）。 */
  onToolActivity?: (info: {
    candidateId: string
    exampleId: string
    moduleId?: string
    name: string
    inputPreview: string
  }) => void
}

export interface EngineMeta {
  taskId: string
  runId: string
  settings: GlobalSettings
  hooks?: EngineHooks
}

export interface BudgetState {
  used: number
  limit: number
}

export interface ExecutionResult {
  exampleId: string
  output: string
  steps: TraceStep[]
  workspaceDir?: string
  error?: string
  exitCode?: number | null
  stdout?: string
  stderr?: string
  toolCalls?: ToolCallTrace[]
  costUsd?: number
}

export interface ExecuteCandidateOptions {
  /** 共享预算计数器；每个样本执行一次计 1 次 rollout。 */
  budget?: BudgetState
  /** 返回 true 时在当前样本边界停止执行。 */
  shouldStop?: () => boolean
  /** 运行级取消信号；用于终止 Claude Code 子进程与 LLM 请求。 */
  signal?: AbortSignal
  /** 进度上下文：标识当前处于哪个阶段（种子/父代/子代/帕累托）。 */
  progress?: RolloutProgressContext
  /** 每个样本 rollout 开始时回调。 */
  onExampleStart?: (info: {
    exampleId: string
    exampleIndex: number
    exampleTotal: number
    rolloutDir?: string
  }) => void
}

export interface EvaluationResult {
  score: number
  feedback: string
  passed?: boolean
  /** 评估器 LLM 调用成本（美元）；测试命令评分为 0。 */
  costUsd?: number
}

export interface RunIterationOptions {
  rng?: () => number
  signal?: AbortSignal
}

interface EvaluatorPayload {
  score?: unknown
  feedback?: unknown
  passed?: unknown
}

interface ReflectorPayload {
  newPrompt?: unknown
  reasoning?: unknown
}

function nowIso(): string {
  return new Date().toISOString()
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 确定性伪随机数生成器，保证相同 seed 下数据集划分稳定。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 将数据集稳定划分为反馈集与帕累托集。
 * 帕累托集取打乱后的前 N 条；为保证反馈集至少保留 1 条样本，
 * 帕累托集最多取 len - 1 条（数据集为空时两者均为空）。
 */
export function splitDataset(
  dataset: DatasetExample[],
  paretoSize: number,
  seed = 0
): { feedback: string[]; pareto: string[] } {
  const ids = [...new Set(dataset.map((example) => example.id))]
  const random = mulberry32(seed)
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = ids[index]
    ids[index] = ids[swapIndex]
    ids[swapIndex] = current
  }
  const requested = Number.isFinite(paretoSize)
    ? Math.max(0, Math.trunc(paretoSize))
    : 0
  const paretoCount = Math.min(requested, Math.max(0, ids.length - 1))
  return {
    pareto: ids.slice(0, paretoCount),
    feedback: ids.slice(paretoCount),
  }
}

/** 从数组中随机抽取不重复的 count 个元素（不修改原数组）。 */
export function sampleIds(
  ids: string[],
  count: number,
  rng: () => number = Math.random
): string[] {
  const pool = [...ids]
  const target = Math.min(Math.max(0, Math.trunc(count)), pool.length)
  for (let index = 0; index < target; index += 1) {
    const swapIndex = index + Math.floor(rng() * (pool.length - index))
    const current = pool[index]
    pool[index] = pool[swapIndex]
    pool[swapIndex] = current
  }
  return pool.slice(0, target)
}

/** 按模块选择策略计算本轮要变异的模块下标。 */
export function selectModuleIndex(
  modules: SkillModule[],
  cursor: number,
  strategy: "round-robin" | "random",
  rng: () => number = Math.random
): number {
  if (modules.length === 0) return 0
  if (strategy === "random") {
    return Math.min(modules.length - 1, Math.floor(rng() * modules.length))
  }
  const normalized =
    ((Math.trunc(cursor) % modules.length) + modules.length) % modules.length
  return normalized
}

/**
 * 帕累托候选选择（GEPA 算法 1 / 算法 2 的核心）：
 * 对每个帕累托实例找出最高分候选，在至少一个实例上并列最高的候选进入前沿，
 * 再按“领先实例数”加权随机采样。
 */
export function selectCandidatePareto(
  candidates: Candidate[],
  paretoSplit: string[],
  rng: () => number = Math.random
): Candidate | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const leadCounts = new Map<string, number>()
  for (const exampleId of paretoSplit) {
    let best = Number.NEGATIVE_INFINITY
    let winners: Candidate[] = []
    for (const candidate of candidates) {
      const score = candidate.scores[exampleId]
      if (typeof score !== "number" || !Number.isFinite(score)) continue
      if (score > best + SCORE_EPSILON) {
        best = score
        winners = [candidate]
      } else if (Math.abs(score - best) <= SCORE_EPSILON) {
        winners.push(candidate)
      }
    }
    for (const winner of winners) {
      leadCounts.set(winner.id, (leadCounts.get(winner.id) ?? 0) + 1)
    }
  }

  const weighted = candidates
    .map((candidate) => ({
      candidate,
      weight: leadCounts.get(candidate.id) ?? 0,
    }))
    .filter((entry) => entry.weight > 0)

  if (weighted.length === 0) {
    return (
      candidates.find((candidate) => candidate.parentId === null) ??
      candidates[0]
    )
  }

  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0)
  let threshold = rng() * total
  for (const entry of weighted) {
    threshold -= entry.weight
    if (threshold < 0) return entry.candidate
  }
  return weighted[weighted.length - 1].candidate
}

/** 计算非支配候选集合（在至少一个帕累托实例上并列最高）。 */
export function computeParetoFrontier(
  candidates: Candidate[],
  paretoSplit: string[],
  epsilon = SCORE_EPSILON
): string[] {
  if (candidates.length === 0) return []
  const leaders = new Set<string>()
  for (const exampleId of paretoSplit) {
    let best = Number.NEGATIVE_INFINITY
    let winners: string[] = []
    for (const candidate of candidates) {
      const score = candidate.scores[exampleId]
      if (typeof score !== "number" || !Number.isFinite(score)) continue
      if (score > best + epsilon) {
        best = score
        winners = [candidate.id]
      } else if (Math.abs(score - best) <= epsilon) {
        winners.push(candidate.id)
      }
    }
    for (const id of winners) leaders.add(id)
  }
  if (leaders.size === 0) {
    const seed =
      candidates.find((candidate) => candidate.parentId === null) ??
      candidates[0]
    return [seed.id]
  }
  return candidates
    .filter((candidate) => leaders.has(candidate.id))
    .map((candidate) => candidate.id)
}

/** 在帕累托集上平均分最高的候选。 */
export function pickBestCandidate(
  candidates: Candidate[],
  paretoSplit: string[]
): Candidate | null {
  let best: Candidate | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    const values = paretoSplit
      .map((exampleId) => candidate.scores[exampleId])
      .filter(
        (score): score is number =>
          typeof score === "number" && Number.isFinite(score)
      )
    if (values.length === 0) continue
    const mean = average(values)
    if (mean > bestScore + SCORE_EPSILON) {
      best = candidate
      bestScore = mean
    }
  }
  return best
}

/** 用任务的初始模块创建种子候选。 */
export function createSeedCandidate(task: TaskRecord): Candidate {
  return {
    id: "candidate-0",
    parentId: null,
    iteration: 0,
    moduleId: null,
    modules: task.modules.map((module) => ({ ...module })),
    scores: {},
    averageScore: 0,
    reflections: [],
    createdAt: nowIso(),
  }
}

function llmMeta(meta: EngineMeta): { taskId: string; runId: string } {
  return { taskId: meta.taskId, runId: meta.runId }
}

interface ExecuteExampleOptions {
  signal?: AbortSignal
  progress?: RolloutProgressContext
  /** rollout 就绪后回调（携带 rollout 目录）。 */
  emitStart?: (rolloutDir?: string) => void
}

/**
 * 按候选的模块顺序执行一个样本。
 * 每个模块都会调用执行器；模块失败时返回带 error 的结果，由上层记 0 分。
 */
async function executeExample(
  task: TaskRecord,
  candidate: Candidate,
  example: DatasetExample,
  meta: EngineMeta,
  options: ExecuteExampleOptions = {}
): Promise<ExecutionResult> {
  const harness = meta.settings.harness
  const useHarness = harness?.kind === "claude-code"
  const constraints = useHarness
    ? `允许的工具：${harness.allowedTools.join("、") || "无"}。当前目录是本次 rollout 的隔离副本，请直接在该目录内完成操作。`
    : describeConstraints(meta.settings.constraints)
  const steps: TraceStep[] = []
  let previous = ""
  let output = ""
  const allToolCalls: ToolCallTrace[] = []
  let totalCostUsd = 0
  let lastExitCode: number | null | undefined
  let lastStdout = ""
  let lastStderr = ""
  let workspaceDir: string | undefined

  if (useHarness) {
    try {
      workspaceDir = await prepareRollout(
        task.id,
        meta.runId,
        candidate.id,
        example.id
      )
      options.emitStart?.(workspaceDir)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        exampleId: example.id,
        output: "",
        steps,
        error: `无法准备 rollout 工作目录：${reason}`,
      }
    }
  } else {
    options.emitStart?.()
  }

  for (const skillModule of candidate.modules) {
    const startedAt = Date.now()
    let text = ""
    let durationMs = 0

    if (useHarness) {
      try {
        const result = await runClaudeCode({
          config: harness,
          cwd: workspaceDir as string,
          skill: skillModule.prompt,
          input: example.input,
          previous,
          constraints,
          taskId: task.id,
          runId: meta.runId,
          signal: options.signal,
          onActivity: (activity) => {
            meta.hooks?.onToolActivity?.({
              candidateId: candidate.id,
              exampleId: example.id,
              moduleId: skillModule.id,
              name: activity.name,
              inputPreview: activity.inputPreview,
            })
          },
        })
        text = result.output
        durationMs = result.durationMs
        totalCostUsd += result.costUsd
        lastExitCode = result.exitCode
        lastStdout = result.stdout
        lastStderr = result.stderr
        allToolCalls.push(...result.toolCalls)
        steps.push({
          moduleId: skillModule.id,
          moduleName: skillModule.name,
          prompt: skillModule.prompt,
          input: steps.length === 0 ? example.input : previous,
          output: text,
          durationMs,
          toolCalls: result.toolCalls,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          costUsd: result.costUsd,
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const aborted =
          options.signal?.aborted === true || error instanceof HarnessAbortError
        return {
          exampleId: example.id,
          output,
          steps,
          workspaceDir,
          error: aborted
            ? "Claude Code 执行已取消"
            : `任务「${task.name}」的模块「${skillModule.name}」执行失败：${reason}`,
          exitCode: lastExitCode,
          stdout: lastStdout,
          stderr: lastStderr,
          toolCalls: allToolCalls,
          costUsd: totalCostUsd,
        }
      }
    } else {
      let moduleCostUsd = 0
      try {
        const result = await runAgent(
          "executor",
          {
            skill: skillModule.prompt,
            input: example.input,
            previous,
            constraints,
          },
          llmMeta(meta),
          options.signal
        )
        text = result.text
        durationMs = result.durationMs
        moduleCostUsd = result.costUsd
        totalCostUsd += result.costUsd
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const aborted = options.signal?.aborted === true
        return {
          exampleId: example.id,
          output,
          steps,
          workspaceDir,
          error: aborted
            ? "执行已取消"
            : `任务「${task.name}」的模块「${skillModule.name}」执行失败：${reason}`,
          toolCalls: allToolCalls,
          costUsd: totalCostUsd,
        }
      }

      steps.push({
        moduleId: skillModule.id,
        moduleName: skillModule.name,
        prompt: skillModule.prompt,
        input: steps.length === 0 ? example.input : previous,
        output: text,
        durationMs,
        costUsd: moduleCostUsd,
      })
    }

    output = text
    previous = previous ? `${previous}\n\n${text}` : text
  }

  return {
    exampleId: example.id,
    output,
    steps,
    workspaceDir,
    exitCode: lastExitCode,
    stdout: lastStdout,
    stderr: lastStderr,
    toolCalls: allToolCalls,
    costUsd: totalCostUsd,
  }
}

/**
 * 在给定样本上执行候选，返回每个样本的执行结果。
 * 每个样本计 1 次 rollout；预算耗尽或收到停止信号时在样本边界停止。
 */
export async function executeCandidate(
  task: TaskRecord,
  candidate: Candidate,
  examples: DatasetExample[],
  meta: EngineMeta,
  options: ExecuteCandidateOptions = {}
): Promise<{ results: ExecutionResult[]; executed: number }> {
  const results: ExecutionResult[] = []
  const budget = options.budget

  for (let index = 0; index < examples.length; index += 1) {
    const example = examples[index]
    if (budget && budget.used >= budget.limit) break
    if (options.shouldStop?.()) break
    if (budget) budget.used += 1
    const result = await executeExample(task, candidate, example, meta, {
      signal: options.signal,
      progress: options.progress,
      emitStart: (rolloutDir) => {
        options.onExampleStart?.({
          exampleId: example.id,
          exampleIndex: index,
          exampleTotal: examples.length,
          rolloutDir,
        })
      },
    })
    results.push(result)
  }

  return { results, executed: results.length }
}

/** 调用评估器给单个样本打分；解析失败时记 0 分并保留原始文本作为反馈。 */
export async function evaluateExample(
  task: TaskRecord,
  example: DatasetExample,
  execution: ExecutionResult,
  candidate: Candidate,
  meta: EngineMeta,
  signal?: AbortSignal
): Promise<EvaluationResult> {
  const output = execution.output

  if (execution.error) {
    return {
      score: 0,
      feedback: `执行失败：${execution.error}`,
      passed: false,
    }
  }

  // 配置了测试命令且存在 rollout 工作目录时，用真实退出码评分。
  if (task.testCommand && execution.workspaceDir) {
    const test = await runRawCommand({
      command: task.testCommand,
      cwd: execution.workspaceDir,
      timeoutMs: meta.settings.constraints.bash.timeoutMs,
      maxOutputBytes: meta.settings.constraints.bash.maxOutputBytes,
      signal,
    })
    const passed = test.allowed && test.exitCode === 0
    const feedback = [
      `测试命令：${task.testCommand}`,
      `结果：${test.reason}`,
      test.stdout ? `stdout：\n${truncate(test.stdout, 4000)}` : "",
      test.stderr ? `stderr：\n${truncate(test.stderr, 4000)}` : "",
    ]
      .filter(Boolean)
      .join("\n")
    return { score: passed ? 1 : 0, feedback, passed }
  }

  const skill =
    candidate.modules.length > 0
      ? candidate.modules[candidate.modules.length - 1].prompt
      : task.description

  const result = await runAgent(
    "evaluator",
    {
      input: example.input,
      expected: example.expected ?? "",
      output,
      skill,
    },
    llmMeta(meta),
    signal
  )

  const raw = result.text
  try {
    const data = parseJsonLoose<EvaluatorPayload | null>(raw)
    return {
      score: clamp01(Number(data?.score)),
      feedback: typeof data?.feedback === "string" ? data.feedback : "",
      passed: typeof data?.passed === "boolean" ? data.passed : undefined,
      costUsd: result.costUsd,
    }
  } catch {
    return { score: 0, feedback: truncate(raw, 500), costUsd: result.costUsd }
  }
}

function formatTraces(traces: ExampleTrace[], moduleId: string): string {
  if (traces.length === 0) return "（无轨迹）"
  return traces
    .map((trace, index) => {
      const steps = trace.steps.filter((step) => step.moduleId === moduleId)
  const stepText =
    steps.length > 0
      ? steps
          .map((step) => {
            const toolText =
              step.toolCalls && step.toolCalls.length > 0
                ? `\n  工具调用：\n${step.toolCalls
                    .map(
                      (call, callIndex) =>
                        `    ${callIndex + 1}. ${call.name}(${truncate(call.input, 400)})${
                          call.isError ? " [失败]" : ""
                        }${call.output ? `\n       结果：${truncate(call.output, 800)}` : ""}`
                    )
                    .join("\n")}`
                : ""
            const runText =
              step.exitCode !== undefined && step.exitCode !== null
                ? `\n  退出码：${step.exitCode}`
                : ""
            const stdoutText = step.stdout
              ? `\n  stdout：${truncate(step.stdout, 1200)}`
              : ""
            const stderrText = step.stderr
              ? `\n  stderr：${truncate(step.stderr, 1200)}`
              : ""
            return `  模块输入：${truncate(step.input, 800)}\n  模块输出：${truncate(step.output, 1500)}${toolText}${runText}${stdoutText}${stderrText}`
          })
          .join("\n")
      : "  （该模块未产生轨迹）"
      return [
        `### 示例 ${index + 1}（${trace.exampleId}）`,
        `任务输入：${truncate(trace.input, 800)}`,
        `期望输出：${truncate(trace.expected ?? "（无）", 400)}`,
        "模块轨迹：",
        stepText,
        `最终输出：${truncate(trace.output, 1500)}`,
        `分数：${trace.score.toFixed(3)}`,
        `反馈：${truncate(trace.feedback || "（无）", 800)}`,
      ].join("\n")
    })
    .join("\n\n")
}

/** 汇总反思器输入，调用反思器生成改进后的模块提示词。 */
export async function reflectModule(
  task: TaskRecord,
  _candidate: Candidate,
  skillModule: SkillModule,
  traces: ExampleTrace[],
  meta: EngineMeta,
  signal?: AbortSignal
): Promise<{ newPrompt: string; reasoning: string; costUsd: number }> {
  const feedback = traces
    .map((trace, index) => `${index + 1}. ${trace.feedback || "（无反馈）"}`)
    .join("\n")
  const score = average(traces.map((trace) => trace.score))

  const { data, costUsd } = await runAgentJson<ReflectorPayload | null>(
    "reflector",
    {
      moduleName: skillModule.name,
      currentPrompt: skillModule.prompt,
      traces: formatTraces(traces, skillModule.id),
      score: score.toFixed(3),
      feedback,
    },
    llmMeta(meta),
    signal
  )

  const newPrompt =
    typeof data?.newPrompt === "string" ? data.newPrompt.trim() : ""
  if (!newPrompt) {
    throw new Error(
      `反思器未为任务「${task.name}」的模块「${skillModule.name}」返回有效提示词`
    )
  }
  return {
    newPrompt,
    reasoning: typeof data?.reasoning === "string" ? data.reasoning.trim() : "",
    costUsd,
  }
}

function cloneCandidates(candidates: Candidate[]): Candidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    modules: candidate.modules.map((module) => ({ ...module })),
    scores: { ...candidate.scores },
    reflections: [...candidate.reflections],
  }))
}

function pickExamples(task: TaskRecord, ids: string[]): DatasetExample[] {
  const byId = new Map(task.dataset.map((example) => [example.id, example]))
  const picked: DatasetExample[] = []
  for (const id of ids) {
    const example = byId.get(id)
    if (example) picked.push(example)
  }
  return picked
}

async function evaluateResults(
  task: TaskRecord,
  candidate: Candidate,
  examples: DatasetExample[],
  results: ExecutionResult[],
  meta: EngineMeta,
  signal?: AbortSignal,
  onExample?: (info: { exampleId: string; index: number; total: number }) => void
): Promise<{ traces: ExampleTrace[]; costUsd: number }> {
  const byId = new Map(examples.map((example) => [example.id, example]))
  const traces: ExampleTrace[] = []
  let costUsd = 0
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const example = byId.get(result.exampleId)
    if (!example) continue
    onExample?.({ exampleId: example.id, index, total: results.length })
    const evaluation = await evaluateExample(
      task,
      example,
      result,
      candidate,
      meta,
      signal
    )
    costUsd += evaluation.costUsd ?? 0
    traces.push({
      exampleId: example.id,
      input: example.input,
      expected: example.expected,
      output: result.output,
      score: evaluation.score,
      feedback: evaluation.feedback,
      steps: result.steps,
      error: result.error,
      rolloutDir: result.workspaceDir,
    })
  }
  return { traces, costUsd }
}

function addLog(
  state: RunState,
  level: RunLogEntry["level"],
  message: string,
  iteration?: number
): void {
  state.logs.push({
    id: randomUUID(),
    at: nowIso(),
    level,
    message,
    iteration,
  })
  if (state.logs.length > 1000) {
    state.logs.splice(0, state.logs.length - 1000)
  }
}

/**
 * 执行一次完整的 GEPA 迭代（反思变异 + 帕累托选择）。
 * 纯函数式地返回新的 RunState，不负责持久化；由 run-manager 写入存储。
 * 中止信号导致的异常按「已停止」返回，保留中止前的状态而不是标记失败。
 */
export async function runIteration(
  task: TaskRecord,
  run: RunState,
  meta: EngineMeta,
  options: RunIterationOptions = {}
): Promise<RunState> {
  try {
    return await runIterationInner(task, run, meta, options)
  } catch (error) {
    if (options.signal?.aborted || run.control.stopRequested) {
      const state: RunState = { ...run, control: run.control }
      addLog(state, "warning", "收到停止请求，当前轮次已中止")
      state.status = "stopped"
      state.finishedAt = nowIso()
      state.updatedAt = nowIso()
      state.progress = undefined
      return state
    }
    throw error
  }
}

async function runIterationInner(
  task: TaskRecord,
  run: RunState,
  meta: EngineMeta,
  options: RunIterationOptions = {}
): Promise<RunState> {
  const rng = options.rng ?? Math.random
  const state: RunState = {
    ...run,
    candidates: cloneCandidates(run.candidates),
    iterations: [...run.iterations],
    logs: [...run.logs],
    paretoFrontier: [...run.paretoFrontier],
    feedbackSplit: [...run.feedbackSplit],
    paretoSplit: [...run.paretoSplit],
    // 保持引用共享，使 run-manager 的暂停/停止标志能在一轮内生效。
    control: run.control,
  }
  const budget: BudgetState = {
    used: state.budgetUsed,
    limit: state.budget,
  }
  state.totalCostUsd = state.totalCostUsd ?? 0
  const maxUsdPerRun = meta.settings.harness?.maxUsdPerRun ?? 0
  const shouldStop = () =>
    state.control.pauseRequested || state.control.stopRequested
  const addCost = (results: ExecutionResult[]) => {
    const cost = results.reduce((sum, item) => sum + (item.costUsd ?? 0), 0)
    if (cost > 0) {
      state.totalCostUsd = (state.totalCostUsd ?? 0) + cost
    }
  }
  const costLimitReached = () =>
    maxUsdPerRun > 0 && (state.totalCostUsd ?? 0) >= maxUsdPerRun
  const finishForCost = () => {
    finish(
      "completed",
      `运行费用已达到上限（$${maxUsdPerRun}），运行结束`,
      "warning"
    )
    return state
  }

  // —— 实时进度与事件广播：迭代内每个阶段、每个 rollout 都对 UI 可见。 ——
  const emitEvent = (
    type: RunEventType,
    data: Record<string, unknown>
  ): void => {
    emitRunEvent({
      type,
      taskId: meta.taskId,
      runId: meta.runId,
      at: nowIso(),
      data,
    })
  }
  const setProgress = (
    phase: RunPhase,
    label: string,
    extra?: Partial<RunProgress>
  ): void => {
    state.progress = {
      phase,
      label,
      iteration: state.iteration + 1,
      ...extra,
      startedAt: nowIso(),
    }
    emitEvent("progress", { progress: state.progress })
  }
  const hookedMeta: EngineMeta = {
    ...meta,
    hooks: {
      onToolActivity: (info) => {
        if (state.progress) {
          state.progress = { ...state.progress, toolName: info.name }
        }
        emitEvent("tool-activity", {
          ...info,
          phase: state.progress?.phase,
        })
      },
    },
  }
  const runRollouts = (
    phase: RunPhase,
    label: string,
    candidate: Candidate,
    examples: DatasetExample[],
    moduleInfo?: { moduleId: string; moduleName: string }
  ) =>
    executeCandidate(task, candidate, examples, hookedMeta, {
      budget,
      shouldStop,
      signal: options.signal,
      progress: {
        phase,
        iteration: state.iteration + 1,
        moduleId: moduleInfo?.moduleId,
        moduleName: moduleInfo?.moduleName,
      },
      onExampleStart: (info) => {
        setProgress(
          phase,
          `${label}（${info.exampleIndex + 1}/${info.exampleTotal}）`,
          {
            candidateId: candidate.id,
            exampleId: info.exampleId,
            exampleIndex: info.exampleIndex,
            exampleTotal: info.exampleTotal,
            rolloutDir: info.rolloutDir,
            moduleId: moduleInfo?.moduleId,
            moduleName: moduleInfo?.moduleName,
          }
        )
        emitEvent("rollout-start", {
          phase,
          iteration: state.iteration + 1,
          candidateId: candidate.id,
          ...info,
        })
      },
    })

  const finish = (
    status: RunState["status"],
    message?: string,
    level: RunLogEntry["level"] = "info"
  ) => {
    state.status = status
    if (message) addLog(state, level, message)
    if (status === "completed" || status === "stopped" || status === "failed") {
      state.finishedAt = nowIso()
      state.progress = undefined
    }
    state.budgetUsed = budget.used
    state.updatedAt = nowIso()
  }

  const stopStatus = (): RunState["status"] =>
    state.control.stopRequested ? "stopped" : "paused"

  // 1. 没有候选时先创建种子候选，并在帕累托集上评估。
  if (state.candidates.length === 0) {
    const seed = createSeedCandidate(task)
    state.candidates.push(seed)
    const seedIds =
      state.paretoSplit.length > 0
        ? state.paretoSplit
        : state.feedbackSplit.slice(
            0,
            Math.max(1, task.iteration.minibatchSize)
          )
    const seedExamples = pickExamples(task, seedIds)
    addLog(
      state,
      "info",
      `创建种子候选 ${seed.id}，将在 ${seedExamples.length} 个样本上评估`
    )

    if (seedExamples.length > 0) {
      const { results } = await runRollouts("seed", "评估种子候选", seed, seedExamples)
      addCost(results)
      setProgress("evaluation", "评估种子候选得分", {
        candidateId: seed.id,
        exampleTotal: results.length,
      })
      const seedEvaluation = await evaluateResults(
        task,
        seed,
        seedExamples,
        results,
        hookedMeta,
        options.signal
      )
      state.totalCostUsd = (state.totalCostUsd ?? 0) + seedEvaluation.costUsd
      for (const trace of seedEvaluation.traces) {
        seed.scores[trace.exampleId] = trace.score
      }
      seed.averageScore = average(Object.values(seed.scores))
      addLog(
        state,
        "success",
        `种子候选平均分 ${seed.averageScore.toFixed(3)}（${Object.keys(seed.scores).length} 个样本）`
      )
    }

    state.bestCandidateId = seed.id
    state.paretoFrontier = [seed.id]
    state.budgetUsed = budget.used

    if (costLimitReached()) return finishForCost()

    if (shouldStop()) {
      finish(stopStatus(), "收到停止/暂停请求，运行中止")
      return state
    }
    if (state.budgetUsed >= state.budget) {
      finish("completed", "预算已用尽，运行结束", "warning")
      return state
    }
  }

  // 2. 达到迭代上限或预算上限时结束。
  if (
    state.iteration >= task.iteration.maxIterations ||
    state.budgetUsed >= state.budget
  ) {
    finish(
      "completed",
      state.budgetUsed >= state.budget
        ? "预算已用尽，运行完成"
        : "已达到最大迭代轮数，运行完成",
      "success"
    )
    return state
  }

  // 3. 帕累托选择父代，并按策略选择要变异的模块。
  const parent = selectCandidatePareto(state.candidates, state.paretoSplit, rng)
  if (!parent) {
    finish("completed", "没有可用候选，运行结束", "warning")
    return state
  }
  if (parent.modules.length === 0) {
    state.error = "候选没有可优化的模块"
    finish("failed", state.error, "error")
    return state
  }

  const moduleIndex = selectModuleIndex(
    parent.modules,
    state.moduleCursor,
    task.iteration.moduleSelection,
    rng
  )
  const targetModule = parent.modules[moduleIndex]
  if (task.iteration.moduleSelection === "round-robin") {
    state.moduleCursor = (moduleIndex + 1) % parent.modules.length
  }

  // 4. 从反馈集中采样 minibatch。
  const minibatchIds = sampleIds(
    state.feedbackSplit,
    task.iteration.minibatchSize,
    rng
  )
  const minibatch = pickExamples(task, minibatchIds)
  if (minibatch.length === 0) {
    finish("completed", "没有可用的反馈样本，运行结束", "warning")
    return state
  }

  const nextIteration = state.iteration + 1
  emitEvent("iteration-start", {
    iteration: nextIteration,
    parentId: parent.id,
    moduleId: targetModule.id,
    moduleName: targetModule.name,
    minibatch: minibatchIds,
  })

  // 5. 在 minibatch 上执行父代并评分。
  const startedAt = nowIso()
  const { results: beforeResults } = await runRollouts(
    "parent-rollout",
    "执行父代候选",
    parent,
    minibatch,
    { moduleId: targetModule.id, moduleName: targetModule.name }
  )
  addCost(beforeResults)
  state.budgetUsed = budget.used

  if (beforeResults.length === 0) {
    if (shouldStop()) {
      finish(stopStatus(), "收到停止/暂停请求，运行中止")
    } else {
      finish("completed", "预算已用尽，运行结束", "warning")
    }
    return state
  }

  setProgress("evaluation", "评估父代样本得分", {
    candidateId: parent.id,
    exampleTotal: beforeResults.length,
  })
  const beforeEvaluation = await evaluateResults(
    task,
    parent,
    minibatch,
    beforeResults,
    hookedMeta,
    options.signal
  )
  const beforeTraces = beforeEvaluation.traces
  state.totalCostUsd = (state.totalCostUsd ?? 0) + beforeEvaluation.costUsd
  const beforeScore = average(beforeTraces.map((trace) => trace.score))
  addLog(
    state,
    "info",
    `第 ${state.iteration + 1} 轮：候选 ${parent.id} 在 ${beforeTraces.length} 个样本上的平均分 ${beforeScore.toFixed(3)}`
  )

  if (costLimitReached()) return finishForCost()

  if (shouldStop()) {
    finish(stopStatus(), "收到停止/暂停请求，本轮中止")
    return state
  }

  // 预算已在父代执行阶段耗尽时，不再发起反思与子代执行。
  if (budget.used >= budget.limit) {
    finish("completed", "预算已用尽，运行结束", "warning")
    return state
  }

  // 6. 反思轨迹并生成新候选。
  setProgress("reflection", `反思模块「${targetModule.name}」生成新提示词`, {
    candidateId: parent.id,
    moduleId: targetModule.id,
    moduleName: targetModule.name,
  })
  const reflection = await reflectModule(
    task,
    parent,
    targetModule,
    beforeTraces,
    hookedMeta,
    options.signal
  )
  state.totalCostUsd = (state.totalCostUsd ?? 0) + reflection.costUsd
  const child: Candidate = {
    id: `candidate-${nextIteration}`,
    parentId: parent.id,
    iteration: nextIteration,
    moduleId: targetModule.id,
    modules: parent.modules.map((item) =>
      item.id === targetModule.id
        ? { ...item, prompt: reflection.newPrompt }
        : { ...item }
    ),
    scores: {},
    averageScore: 0,
    reflections: [...parent.reflections, reflection.reasoning].filter(
      (item) => item.length > 0
    ),
    createdAt: nowIso(),
  }
  addLog(
    state,
    "info",
    `第 ${nextIteration} 轮：反思模块「${targetModule.name}」，生成候选 ${child.id}`,
    nextIteration
  )

  // 7. 新候选在同一个 minibatch 上执行并评分。
  const { results: afterResults } = await runRollouts(
    "child-rollout",
    "执行子代候选",
    child,
    minibatch,
    { moduleId: targetModule.id, moduleName: targetModule.name }
  )
  addCost(afterResults)
  state.budgetUsed = budget.used

  setProgress("evaluation", "评估子代样本得分", {
    candidateId: child.id,
    exampleTotal: afterResults.length,
  })
  const afterEvaluation =
    afterResults.length > 0
      ? await evaluateResults(
          task,
          child,
          minibatch,
          afterResults,
          hookedMeta,
          options.signal
        )
      : { traces: [], costUsd: 0 }
  const afterTraces = afterEvaluation.traces
  state.totalCostUsd = (state.totalCostUsd ?? 0) + afterEvaluation.costUsd
  // 仅当子代与父代在同样数量的样本上完成评估时才可比较。
  const afterScore =
    afterTraces.length > 0 && afterTraces.length === beforeTraces.length
      ? average(afterTraces.map((trace) => trace.score))
      : null

  // 8. 仅当分数提升时接受新候选，并在帕累托集上评估。
  const accepted =
    afterScore !== null && afterScore > beforeScore + SCORE_EPSILON

  if (accepted && afterScore !== null) {
    const afterById = new Map(
      afterTraces.map((trace) => [trace.exampleId, trace.score])
    )
    for (const exampleId of state.paretoSplit) {
      if (afterById.has(exampleId)) {
        child.scores[exampleId] = afterById.get(exampleId) as number
      }
    }

    const remainingParetoExamples = pickExamples(
      task,
      state.paretoSplit
    ).filter(
      (example) =>
        !Object.prototype.hasOwnProperty.call(child.scores, example.id)
    )
    for (const example of remainingParetoExamples) {
      if (budget.used >= budget.limit || shouldStop()) break
      const { results } = await runRollouts(
        "pareto-eval",
        "帕累托集评估",
        child,
        [example],
        { moduleId: targetModule.id, moduleName: targetModule.name }
      )
      addCost(results)
      if (results.length === 0) break
      const evaluation = await evaluateResults(
        task,
        child,
        [example],
        results,
        hookedMeta,
        options.signal
      )
      state.totalCostUsd = (state.totalCostUsd ?? 0) + evaluation.costUsd
      const [trace] = evaluation.traces
      if (trace) child.scores[example.id] = trace.score
      if (costLimitReached()) break
    }

    const paretoValues = Object.values(child.scores)
    child.averageScore =
      paretoValues.length > 0 ? average(paretoValues) : afterScore
    state.candidates.push(child)
    state.paretoFrontier = computeParetoFrontier(
      state.candidates,
      state.paretoSplit
    )
    const best = pickBestCandidate(state.candidates, state.paretoSplit)
    if (best) state.bestCandidateId = best.id
    state.budgetUsed = budget.used
    addLog(
      state,
      "success",
      `第 ${nextIteration} 轮：接受候选 ${child.id}（${beforeScore.toFixed(3)} → ${afterScore.toFixed(3)}），当前最佳 ${state.bestCandidateId ?? "无"}`,
      nextIteration
    )
  } else {
    addLog(
      state,
      "warning",
      `第 ${nextIteration} 轮：拒绝候选 ${child.id}（${beforeScore.toFixed(3)} → ${afterScore === null ? "未完成" : afterScore.toFixed(3)}）`,
      nextIteration
    )
  }

  // 9. 记录本轮迭代；开启人工审批时挂起等待批准/否决。
  const record: IterationRecord = {
    index: nextIteration,
    candidateId: parent.id,
    moduleId: targetModule.id,
    beforeScore,
    afterScore,
    accepted,
    reflection: reflection.reasoning || `已更新模块「${targetModule.name}」的提示词`,
    traces: beforeTraces,
    startedAt,
    finishedAt: nowIso(),
  }
  state.iterations.push(record)
  state.iteration = nextIteration
  state.budgetUsed = budget.used
  state.updatedAt = nowIso()
  emitEvent("iteration-end", {
    iteration: nextIteration,
    candidateId: child.id,
    accepted,
    beforeScore,
    afterScore,
    totalCostUsd: state.totalCostUsd,
  })

  if (costLimitReached()) return finishForCost()

  if (
    state.budgetUsed >= state.budget ||
    state.iteration >= task.iteration.maxIterations
  ) {
    finish(
      "completed",
      state.budgetUsed >= state.budget
        ? "预算已用尽，运行完成"
        : "已达到最大迭代轮数，运行完成",
      "success"
    )
    return state
  }

  if (accepted && task.iteration.humanApproval === true) {
    state.pendingApproval = {
      iteration: nextIteration,
      candidateId: child.id,
      moduleId: targetModule.id,
      moduleName: targetModule.name,
      parentCandidateId: parent.id,
      beforeScore,
      afterScore,
      reflection: reflection.reasoning,
      oldPrompt: targetModule.prompt,
      newPrompt: reflection.newPrompt,
      createdAt: nowIso(),
    }
    state.progress = {
      phase: "idle",
      label: "等待人工审批",
      iteration: nextIteration,
      candidateId: child.id,
      moduleId: targetModule.id,
      moduleName: targetModule.name,
      startedAt: nowIso(),
    }
    finish(
      "paused",
      `第 ${nextIteration} 轮：候选 ${child.id} 已接受（${beforeScore.toFixed(3)} → ${afterScore.toFixed(3)}），等待人工审批`,
      "warning"
    )
    emitEvent("approval-requested", { ...state.pendingApproval })
    return state
  }

  if (shouldStop()) {
    finish(stopStatus(), "收到停止/暂停请求，运行暂停")
    return state
  }

  state.progress = {
    phase: "idle",
    label: "等待下一轮迭代",
    iteration: nextIteration,
    startedAt: nowIso(),
  }
  state.status = "running"
  return state
}
