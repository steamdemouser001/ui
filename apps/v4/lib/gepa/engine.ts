import { randomUUID } from "node:crypto"

import { parseJsonLoose, runAgent, runAgentJson } from "./llm"
import type {
  Candidate,
  DatasetExample,
  ExampleTrace,
  GlobalConstraints,
  GlobalSettings,
  IterationRecord,
  RunLogEntry,
  RunState,
  SkillModule,
  TaskRecord,
  TraceStep,
} from "./types"

/** 分数比较容差：用于帕累托并列判断。 */
export const SCORE_EPSILON = 1e-9

export interface EngineMeta {
  taskId: string
  runId: string
  settings: GlobalSettings
}

export interface BudgetState {
  used: number
  limit: number
}

export interface ExecutionResult {
  exampleId: string
  output: string
  steps: TraceStep[]
}

export interface ExecuteCandidateOptions {
  /** 共享预算计数器；每个样本执行一次计 1 次 rollout。 */
  budget?: BudgetState
  /** 返回 true 时在当前样本边界停止执行。 */
  shouldStop?: () => boolean
}

export interface EvaluationResult {
  score: number
  feedback: string
  passed?: boolean
}

export interface RunIterationOptions {
  rng?: () => number
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

/** 将全局约束压缩为可注入执行器提示词的简要文本。 */
export function describeConstraints(constraints: GlobalConstraints): string {
  const lines: string[] = []
  const tools = constraints.tools
  if (tools.enabled) {
    lines.push(
      `工具：允许 ${tools.allowedTools.join("、") || "无"}；禁止 ${tools.deniedTools.join("、") || "无"}；每轮最多调用 ${tools.maxCallsPerIteration} 次。`
    )
    lines.push(
      tools.requireApprovalForWrite
        ? "写入类工具需要人工确认。"
        : "写入类工具无需人工确认。"
    )
    lines.push(
      tools.allowNetwork
        ? `允许网络访问${tools.allowedHosts.length > 0 ? `（仅限 ${tools.allowedHosts.join("、")}）` : ""}。`
        : "禁止网络访问。"
    )
  } else {
    lines.push("工具调用已禁用。")
  }

  const bash = constraints.bash
  if (bash.enabled) {
    lines.push(
      `Bash：允许 ${bash.allowedCommands.join("、") || "无"}；禁止 ${bash.deniedCommands.join("、") || "无"}；超时 ${bash.timeoutMs}ms；输出上限 ${bash.maxOutputBytes} 字节。`
    )
    if (!bash.allowShellOperators) {
      lines.push("禁止使用 shell 操作符（管道、重定向、&& 等）。")
    }
    if (bash.workingDirOnly) {
      lines.push("只允许在任务工作目录内操作。")
    }
  } else {
    lines.push("Bash 已禁用。")
  }

  return lines.join("\n")
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

/**
 * 按候选的模块顺序执行一个样本。
 * 每个模块都会调用执行器；模块失败时抛错，由上层统一处理。
 */
async function executeExample(
  task: TaskRecord,
  candidate: Candidate,
  example: DatasetExample,
  meta: EngineMeta
): Promise<ExecutionResult> {
  const constraints = describeConstraints(meta.settings.constraints)
  const steps: TraceStep[] = []
  let previous = ""
  let output = ""

  for (const module of candidate.modules) {
    const startedAt = Date.now()
    let text: string
    let durationMs: number
    try {
      const result = await runAgent(
        "executor",
        {
          skill: module.prompt,
          input: example.input,
          previous,
          constraints,
        },
        llmMeta(meta)
      )
      text = result.text
      durationMs = result.durationMs
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `任务「${task.name}」的模块「${module.name}」执行失败：${reason}`
      )
    }

    steps.push({
      moduleId: module.id,
      moduleName: module.name,
      prompt: module.prompt,
      input: steps.length === 0 ? example.input : previous,
      output: text,
      durationMs,
    })
    output = text
    previous = previous ? `${previous}\n\n${text}` : text
  }

  return { exampleId: example.id, output, steps }
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

  for (const example of examples) {
    if (budget && budget.used >= budget.limit) break
    if (options.shouldStop?.()) break
    if (budget) budget.used += 1
    results.push(await executeExample(task, candidate, example, meta))
  }

  return { results, executed: results.length }
}

/** 调用评估器给单个样本打分；解析失败时记 0 分并保留原始文本作为反馈。 */
export async function evaluateExample(
  task: TaskRecord,
  example: DatasetExample,
  output: string,
  candidate: Candidate,
  meta: EngineMeta
): Promise<EvaluationResult> {
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
    llmMeta(meta)
  )

  const raw = result.text
  try {
    const data = parseJsonLoose<EvaluatorPayload | null>(raw)
    return {
      score: clamp01(Number(data?.score)),
      feedback: typeof data?.feedback === "string" ? data.feedback : "",
      passed: typeof data?.passed === "boolean" ? data.passed : undefined,
    }
  } catch {
    return { score: 0, feedback: truncate(raw, 500) }
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
              .map(
                (step) =>
                  `  模块输入：${truncate(step.input, 800)}\n  模块输出：${truncate(step.output, 1500)}`
              )
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

/** 汇总执行轨迹，调用反思器生成改进后的模块提示词。 */
export async function reflectModule(
  task: TaskRecord,
  _candidate: Candidate,
  module: SkillModule,
  traces: ExampleTrace[],
  meta: EngineMeta
): Promise<{ newPrompt: string; reasoning: string }> {
  const feedback = traces
    .map((trace, index) => `${index + 1}. ${trace.feedback || "（无反馈）"}`)
    .join("\n")
  const score = average(traces.map((trace) => trace.score))

  const { data } = await runAgentJson<ReflectorPayload | null>(
    "reflector",
    {
      moduleName: module.name,
      currentPrompt: module.prompt,
      traces: formatTraces(traces, module.id),
      score: score.toFixed(3),
      feedback,
    },
    llmMeta(meta)
  )

  const newPrompt =
    typeof data?.newPrompt === "string" ? data.newPrompt.trim() : ""
  if (!newPrompt) {
    throw new Error(
      `反思器未为任务「${task.name}」的模块「${module.name}」返回有效提示词`
    )
  }
  return {
    newPrompt,
    reasoning: typeof data?.reasoning === "string" ? data.reasoning.trim() : "",
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
  meta: EngineMeta
): Promise<ExampleTrace[]> {
  const byId = new Map(examples.map((example) => [example.id, example]))
  const traces: ExampleTrace[] = []
  for (const result of results) {
    const example = byId.get(result.exampleId)
    if (!example) continue
    const evaluation = await evaluateExample(
      task,
      example,
      result.output,
      candidate,
      meta
    )
    traces.push({
      exampleId: example.id,
      input: example.input,
      expected: example.expected,
      output: result.output,
      score: evaluation.score,
      feedback: evaluation.feedback,
      steps: result.steps,
    })
  }
  return traces
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
 */
export async function runIteration(
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
  const shouldStop = () =>
    state.control.pauseRequested || state.control.stopRequested

  const finish = (
    status: RunState["status"],
    message?: string,
    level: RunLogEntry["level"] = "info"
  ) => {
    state.status = status
    if (message) addLog(state, level, message)
    if (status === "completed" || status === "stopped" || status === "failed") {
      state.finishedAt = nowIso()
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
      const { results } = await executeCandidate(
        task,
        seed,
        seedExamples,
        meta,
        { budget, shouldStop }
      )
      const byId = new Map(seedExamples.map((example) => [example.id, example]))
      for (const result of results) {
        const example = byId.get(result.exampleId)
        if (!example) continue
        const evaluation = await evaluateExample(
          task,
          example,
          result.output,
          seed,
          meta
        )
        seed.scores[result.exampleId] = evaluation.score
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
  const module = parent.modules[moduleIndex]
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

  // 5. 在 minibatch 上执行父代并评分。
  const startedAt = nowIso()
  const { results: beforeResults } = await executeCandidate(
    task,
    parent,
    minibatch,
    meta,
    { budget, shouldStop }
  )
  state.budgetUsed = budget.used

  if (beforeResults.length === 0) {
    if (shouldStop()) {
      finish(stopStatus(), "收到停止/暂停请求，运行中止")
    } else {
      finish("completed", "预算已用尽，运行结束", "warning")
    }
    return state
  }

  const beforeTraces = await evaluateResults(
    task,
    parent,
    minibatch,
    beforeResults,
    meta
  )
  const beforeScore = average(beforeTraces.map((trace) => trace.score))
  addLog(
    state,
    "info",
    `第 ${state.iteration + 1} 轮：候选 ${parent.id} 在 ${beforeTraces.length} 个样本上的平均分 ${beforeScore.toFixed(3)}`
  )

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
  const reflection = await reflectModule(
    task,
    parent,
    module,
    beforeTraces,
    meta
  )
  const nextIteration = state.iteration + 1
  const child: Candidate = {
    id: `candidate-${nextIteration}`,
    parentId: parent.id,
    iteration: nextIteration,
    moduleId: module.id,
    modules: parent.modules.map((item) =>
      item.id === module.id
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
    `第 ${nextIteration} 轮：反思模块「${module.name}」，生成候选 ${child.id}`,
    nextIteration
  )

  // 7. 新候选在同一个 minibatch 上执行并评分。
  const { results: afterResults } = await executeCandidate(
    task,
    child,
    minibatch,
    meta,
    { budget, shouldStop }
  )
  state.budgetUsed = budget.used

  const afterTraces =
    afterResults.length > 0
      ? await evaluateResults(task, child, minibatch, afterResults, meta)
      : []
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
      const { results } = await executeCandidate(task, child, [example], meta, {
        budget,
        shouldStop,
      })
      if (results.length === 0) break
      const [trace] = await evaluateResults(
        task,
        child,
        [example],
        results,
        meta
      )
      if (trace) child.scores[example.id] = trace.score
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

  // 9. 记录本轮迭代。
  const record: IterationRecord = {
    index: nextIteration,
    candidateId: parent.id,
    moduleId: module.id,
    beforeScore,
    afterScore,
    accepted,
    reflection: reflection.reasoning || `已更新模块「${module.name}」的提示词`,
    traces: beforeTraces,
    startedAt,
    finishedAt: nowIso(),
  }
  state.iterations.push(record)
  state.iteration = nextIteration
  state.budgetUsed = budget.used
  state.updatedAt = nowIso()

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

  if (shouldStop()) {
    finish(stopStatus(), "收到停止/暂停请求，运行暂停")
    return state
  }

  state.status = "running"
  return state
}
