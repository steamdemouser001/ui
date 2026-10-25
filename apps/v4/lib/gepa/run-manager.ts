import { randomUUID } from "node:crypto"

import {
  computeParetoFrontier,
  pickBestCandidate,
  runIteration,
  splitDataset,
} from "./engine"
import { emitRunEvent } from "./run-events"
import {
  readRun,
  readSettings,
  readTask,
  writeRun,
  writeRunArtifact,
  writeTask,
} from "./storage"
import type { RunLogEntry, RunState, TaskRecord, TaskStatus } from "./types"

export interface StartRunOptions {
  budget?: number
  minibatchSize?: number
  maxIterations?: number
}

interface ActiveRun {
  runId: string
  run: RunState
  promise: Promise<void>
  abort: AbortController
}

/** 进程内活动运行表：taskId -> 正在后台执行的运行。 */
const activeRuns = new Map<string, ActiveRun>()

/** 正在启动中的运行，避免并发 startRun 创建重复运行。 */
const startingRuns = new Map<string, Promise<RunState>>()

const TASK_STATUS_BY_RUN: Record<RunState["status"], TaskStatus> = {
  idle: "draft",
  running: "running",
  paused: "paused",
  completed: "completed",
  stopped: "paused",
  failed: "failed",
}

function nowIso(): string {
  return new Date().toISOString()
}

function toPositiveInt(
  value: number | undefined,
  fallback: number,
  min = 1
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.trunc(value))
}

function addLog(
  run: RunState,
  level: RunLogEntry["level"],
  message: string,
  iteration?: number
): void {
  run.logs.push({ id: randomUUID(), at: nowIso(), level, message, iteration })
  if (run.logs.length > 1000) {
    run.logs.splice(0, run.logs.length - 1000)
  }
}

async function requireTask(taskId: string): Promise<TaskRecord> {
  const task = await readTask(taskId)
  if (!task) throw new Error(`任务不存在：${taskId}`)
  return task
}

async function syncTask(task: TaskRecord, run: RunState): Promise<void> {
  task.status = TASK_STATUS_BY_RUN[run.status] ?? "draft"
  task.runId = run.id
  task.updatedAt = nowIso()
  await writeTask(task)
}

function applyOptions(task: TaskRecord, options: StartRunOptions): boolean {
  let changed = false
  if (options.budget !== undefined) {
    task.iteration.budget = toPositiveInt(options.budget, task.iteration.budget)
    changed = true
  }
  if (options.minibatchSize !== undefined) {
    task.iteration.minibatchSize = toPositiveInt(
      options.minibatchSize,
      task.iteration.minibatchSize
    )
    changed = true
  }
  if (options.maxIterations !== undefined) {
    task.iteration.maxIterations = toPositiveInt(
      options.maxIterations,
      task.iteration.maxIterations
    )
    changed = true
  }
  return changed
}

async function createRun(
  task: TaskRecord,
  options: StartRunOptions = {}
): Promise<RunState> {
  if (task.modules.length === 0) {
    throw new Error(`任务「${task.name}」没有技能模块，无法运行`)
  }
  if (task.dataset.length === 0) {
    throw new Error(`任务「${task.name}」没有数据集，无法运行`)
  }

  const settings = await readSettings()
  const split = splitDataset(task.dataset, task.iteration.paretoSize)
  // 数据集过小时帕累托集可能为空；退化为复用反馈集，保证选择与评估仍可进行。
  const paretoSplit =
    split.pareto.length > 0 ? split.pareto : [...split.feedback]
  const budget = toPositiveInt(options.budget, task.iteration.budget)
  const now = nowIso()
  const run: RunState = {
    id: `run-${randomUUID().slice(0, 8)}`,
    taskId: task.id,
    status: "running",
    iteration: 0,
    budget,
    budgetUsed: 0,
    candidates: [],
    paretoFrontier: [],
    bestCandidateId: null,
    iterations: [],
    logs: [],
    feedbackSplit: split.feedback,
    paretoSplit,
    moduleCursor: 0,
    startedAt: now,
    updatedAt: now,
    harness: {
      kind: settings.harness.kind,
      model: settings.harness.model,
    },
    totalCostUsd: 0,
    control: { pauseRequested: false, stopRequested: false },
  }
  addLog(
    run,
    "info",
    `开始运行：harness ${settings.harness.kind}，预算 ${budget} 次 rollout，minibatch ${task.iteration.minibatchSize}，帕累托样本 ${paretoSplit.length} 个，反馈样本 ${split.feedback.length} 个`
  )
  return run
}

async function writeIterationArtifact(
  taskId: string,
  run: RunState
): Promise<void> {
  const record = run.iterations[run.iterations.length - 1]
  if (!record) return
  await writeRunArtifact(taskId, run.id, record.index, {
    record,
    bestCandidateId: run.bestCandidateId,
    paretoFrontier: run.paretoFrontier,
    budgetUsed: run.budgetUsed,
    candidate:
      run.candidates.find((candidate) => candidate.id === record.candidateId) ??
      null,
  })
}

function launch(
  taskId: string,
  run: RunState,
  loop: (signal: AbortSignal) => Promise<void>
): ActiveRun {
  const entry: ActiveRun = {
    runId: run.id,
    run,
    promise: Promise.resolve(),
    abort: new AbortController(),
  }
  activeRuns.set(taskId, entry)
  entry.promise = loop(entry.abort.signal)
    .catch(() => undefined)
    .finally(() => {
      if (activeRuns.get(taskId) === entry) {
        activeRuns.delete(taskId)
      }
    })
  return entry
}

async function finishRun(
  taskId: string,
  run: RunState,
  status: RunState["status"],
  message: string
): Promise<void> {
  if (run.status !== status) {
    run.status = status
    addLog(run, status === "completed" ? "success" : "info", message)
  }
  if (status === "completed" || status === "stopped") {
    run.finishedAt = run.finishedAt ?? nowIso()
    run.progress = undefined
  }
  run.control = { pauseRequested: false, stopRequested: false }
  run.updatedAt = nowIso()
  await writeRun(run)
  const task = await readTask(taskId)
  if (task) await syncTask(task, run)
}

async function failRun(
  taskId: string,
  run: RunState,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  run.status = "failed"
  run.error = message
  run.finishedAt = nowIso()
  run.control = { pauseRequested: false, stopRequested: false }
  run.updatedAt = nowIso()
  addLog(run, "error", `运行失败：${message}`)
  try {
    await writeRun(run)
    const task = await readTask(taskId)
    if (task) await syncTask(task, run)
  } catch {
    // 持久化失败时保留内存中的错误信息，避免掩盖原始异常
  }
}

async function runLoop(
  taskId: string,
  run: RunState,
  signal: AbortSignal
): Promise<void> {
  try {
    for (;;) {
      if (signal.aborted || run.control.stopRequested) {
        await finishRun(taskId, run, "stopped", "运行已停止")
        return
      }
      if (run.control.pauseRequested) {
        await finishRun(taskId, run, "paused", "运行已暂停")
        return
      }
      if (run.status === "completed" || run.status === "failed") return

      const task = await requireTask(taskId)
      const settings = await readSettings()
      const next = await runIteration(task, run, {
        taskId,
        runId: run.id,
        settings,
      }, { signal })
      Object.assign(run, next)
      run.updatedAt = nowIso()
      const status = run.status as RunState["status"]

      await writeRun(run)
      await writeIterationArtifact(taskId, run)
      await syncTask(task, run)

      if (status === "completed") {
        await finishRun(taskId, run, "completed", "运行已完成")
        return
      }
      if (status === "stopped" || signal.aborted) {
        await finishRun(taskId, run, "stopped", "运行已停止")
        return
      }
      if (status === "paused" || run.control.pauseRequested) {
        await finishRun(taskId, run, "paused", "运行已暂停")
        return
      }
      if (run.control.stopRequested) {
        await finishRun(taskId, run, "stopped", "运行已停止")
        return
      }

      // 让出事件循环，保证控制请求与指标写入及时生效。
      await new Promise((resolve) => setImmediate(resolve))
    }
  } catch (error) {
    await failRun(taskId, run, error)
  }
}

async function stepLoop(
  taskId: string,
  run: RunState,
  signal: AbortSignal
): Promise<void> {
  try {
    const task = await requireTask(taskId)
    const settings = await readSettings()
    const next = await runIteration(task, run, {
      taskId,
      runId: run.id,
      settings,
    }, { signal })
    Object.assign(run, next)
    run.updatedAt = nowIso()

    if (
      run.status !== "completed" &&
      run.status !== "failed" &&
      run.status !== "stopped"
    ) {
      run.status = "paused"
      run.control = { pauseRequested: false, stopRequested: false }
      addLog(run, "info", "单步执行完成，运行已暂停")
    }

    await writeRun(run)
    await writeIterationArtifact(taskId, run)
    await syncTask(task, run)
  } catch (error) {
    await failRun(taskId, run, error)
  }
}

/**
 * 开始运行。已有活动运行直接返回；已有暂停的运行则恢复；否则创建新运行。
 * 后台循环在 API 返回后继续执行，不阻塞请求。
 */
export async function startRun(
  taskId: string,
  options: StartRunOptions = {}
): Promise<RunState> {
  const active = activeRuns.get(taskId)
  if (active) return active.run
  const starting = startingRuns.get(taskId)
  if (starting) return starting

  const promise = startRunInternal(taskId, options)
  startingRuns.set(taskId, promise)
  try {
    return await promise
  } finally {
    startingRuns.delete(taskId)
  }
}

async function startRunInternal(
  taskId: string,
  options: StartRunOptions
): Promise<RunState> {
  const task = await requireTask(taskId)
  if (applyOptions(task, options)) {
    task.updatedAt = nowIso()
    await writeTask(task)
  }

  if (task.runId) {
    const existing = await readRun(taskId, task.runId)
    if (existing) {
      if (existing.status === "running") {
        existing.status = "paused"
        existing.control = { pauseRequested: false, stopRequested: false }
        existing.updatedAt = nowIso()
        addLog(existing, "warning", "检测到上次运行未正常结束，已标记为暂停")
        await writeRun(existing)
        await syncTask(task, existing)
      }
      if (existing.status === "paused") {
        return resumeRun(taskId)
      }
    }
  }

  const run = await createRun(task, options)
  await writeRun(run)
  await syncTask(task, run)
  launch(taskId, run, (signal) => runLoop(taskId, run, signal))
  return run
}

/** 请求暂停：活动运行在当前样本/轮次边界暂停，否则直接把运行标记为暂停。 */
export async function pauseRun(taskId: string): Promise<RunState> {
  const active = activeRuns.get(taskId)
  if (active) {
    active.run.control.pauseRequested = true
    active.run.updatedAt = nowIso()
    addLog(active.run, "warning", "收到暂停请求，将在当前样本/轮次结束后暂停")
    await writeRun(active.run)
    return active.run
  }

  const task = await requireTask(taskId)
  const run = task.runId ? await readRun(taskId, task.runId) : null
  if (!run) throw new Error("该任务还没有运行记录")
  if (run.status !== "running") {
    throw new Error(`当前运行状态为「${run.status}」，无法暂停`)
  }
  run.status = "paused"
  run.control = { pauseRequested: false, stopRequested: false }
  run.updatedAt = nowIso()
  addLog(run, "info", "运行已暂停")
  await writeRun(run)
  await syncTask(task, run)
  return run
}

/** 请求停止：活动运行在当前样本边界停止；否则直接标记为已停止。 */
export async function stopRun(taskId: string): Promise<RunState> {
  const active = activeRuns.get(taskId)
  if (active) {
    active.run.control.stopRequested = true
    active.abort.abort()
    active.run.updatedAt = nowIso()
    addLog(active.run, "warning", "收到停止请求，将在当前样本结束后停止")
    await writeRun(active.run)
    return active.run
  }

  const task = await requireTask(taskId)
  const run = task.runId ? await readRun(taskId, task.runId) : null
  if (!run) throw new Error("该任务还没有运行记录")
  if (run.status !== "running" && run.status !== "paused") {
    throw new Error(`当前运行状态为「${run.status}」，无法停止`)
  }
  run.status = "stopped"
  run.finishedAt = nowIso()
  run.control = { pauseRequested: false, stopRequested: false }
  run.updatedAt = nowIso()
  addLog(run, "info", "运行已停止")
  await writeRun(run)
  await syncTask(task, run)
  return run
}

/** 单步执行：后台执行恰好一次迭代，然后暂停。 */
export async function stepRun(taskId: string): Promise<RunState> {
  if (activeRuns.has(taskId)) {
    throw new Error("运行正在进行中，请先暂停或等待当前轮次结束")
  }

  const task = await requireTask(taskId)
  let run = task.runId ? await readRun(taskId, task.runId) : null
  if (run?.pendingApproval) {
    throw new Error("存在等待人工审批的候选，请先批准或否决")
  }
  if (
    !run ||
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "stopped"
  ) {
    run = await createRun(task)
  } else {
    run.control = { pauseRequested: false, stopRequested: false }
    run.error = undefined
  }

  run.status = "running"
  run.updatedAt = nowIso()
  addLog(run, "info", "单步执行：开始一轮迭代")
  await writeRun(run)
  await syncTask(task, run)
  launch(taskId, run, (signal) => stepLoop(taskId, run, signal))
  return run
}

/** 恢复暂停的运行，清除暂停/停止标志并重新启动后台循环。 */
export async function resumeRun(taskId: string): Promise<RunState> {
  const active = activeRuns.get(taskId)
  if (active) return active.run

  const task = await requireTask(taskId)
  if (!task.runId) {
    throw new Error("该任务还没有运行记录，请先开始运行")
  }
  const run = await readRun(taskId, task.runId)
  if (!run) throw new Error(`找不到运行记录：${task.runId}`)
  if (run.pendingApproval) {
    throw new Error(
      `存在等待人工审批的候选（${run.pendingApproval.candidateId}），请先批准或否决`
    )
  }
  if (run.status === "completed") {
    throw new Error("运行已完成，请开始新的运行")
  }
  if (run.status === "failed") {
    throw new Error("运行已失败，请开始新的运行")
  }
  if (run.status === "stopped") {
    throw new Error("运行已停止，请开始新的运行")
  }

  run.status = "running"
  run.control = { pauseRequested: false, stopRequested: false }
  run.finishedAt = undefined
  run.error = undefined
  run.updatedAt = nowIso()
  addLog(run, "info", "运行已恢复")
  await writeRun(run)
  await syncTask(task, run)
  launch(taskId, run, (signal) => runLoop(taskId, run, signal))
  return run
}

/**
 * 读取运行状态。若持久化的运行仍标记为 running 但内存中没有活动任务，
 * 说明服务已重启，返回前将其标记为 paused。
 */
export async function getRunStatus(taskId: string): Promise<RunState | null> {
  const active = activeRuns.get(taskId)
  if (active) return active.run

  const task = await readTask(taskId)
  if (!task?.runId) return null
  const run = await readRun(taskId, task.runId)
  if (!run) return null

  if (run.status === "running") {
    run.status = "paused"
    run.control = { pauseRequested: false, stopRequested: false }
    run.updatedAt = nowIso()
    addLog(run, "warning", "检测到服务重启后中断的运行，已标记为暂停")
    await writeRun(run)
    await syncTask(task, run)
  }
  return run
}

/** 当前任务是否有活动运行（供任务页/监控页判断）。 */
export function isRunActive(taskId: string): boolean {
  return activeRuns.has(taskId)
}

/** 读取任务的活动运行（含迭代内实时进度）；无活动运行时返回 null。 */
export function getActiveRun(taskId: string): RunState | null {
  return activeRuns.get(taskId)?.run ?? null
}

/** 全部活动运行（供监控页展示实时阶段）。 */
export function getActiveRuns(): RunState[] {
  return [...activeRuns.values()].map((entry) => entry.run)
}

/** 运行中实时调整预算：对活动运行立即生效，从下一轮迭代起按新预算执行。 */
export async function setLiveBudget(
  taskId: string,
  budget: number
): Promise<RunState> {
  const active = activeRuns.get(taskId)
  if (!active) {
    throw new Error("该任务当前没有进行中的运行")
  }
  const next = Math.max(1, Math.trunc(budget))
  active.run.budget = next
  active.run.updatedAt = nowIso()
  addLog(active.run, "info", `预算已实时调整为 ${next} 次 rollout`)
  await writeRun(active.run)
  return active.run
}

function emitApprovalResolved(
  run: RunState,
  decision: "approved" | "rejected"
): void {
  emitRunEvent({
    type: "approval-resolved",
    taskId: run.taskId,
    runId: run.id,
    at: nowIso(),
    data: { candidateId: run.pendingApproval?.candidateId, decision },
  })
}

/** 批准等待人工审批的候选：保留候选并自动继续运行。 */
export async function approveCandidate(taskId: string): Promise<RunState> {
  const active = activeRuns.get(taskId)
  if (active) {
    throw new Error("运行正在进行中，没有等待审批的候选")
  }

  const task = await requireTask(taskId)
  const run = task.runId ? await readRun(taskId, task.runId) : null
  if (!run) throw new Error("该任务还没有运行记录")
  const pending = run.pendingApproval
  if (!pending) throw new Error("当前没有等待审批的候选")

  const record = run.iterations.find((item) => item.index === pending.iteration)
  if (record) record.humanDecision = "approved"
  run.pendingApproval = undefined
  run.updatedAt = nowIso()
  addLog(
    run,
    "success",
    `已批准第 ${pending.iteration} 轮候选 ${pending.candidateId}，继续运行`
  )
  await writeRun(run)
  emitApprovalResolved(run, "approved")

  // 批准即继续：恢复后台循环（运行已因等待审批而暂停）。
  if (run.status === "paused") {
    return resumeRun(taskId)
  }
  await syncTask(task, run)
  return run
}

/** 否决等待人工审批的候选：从候选池移除并重算帕累托前沿与最佳候选。 */
export async function rejectCandidate(taskId: string): Promise<RunState> {
  const active = activeRuns.get(taskId)
  if (active) {
    throw new Error("运行正在进行中，没有等待审批的候选")
  }

  const task = await requireTask(taskId)
  const run = task.runId ? await readRun(taskId, task.runId) : null
  if (!run) throw new Error("该任务还没有运行记录")
  const pending = run.pendingApproval
  if (!pending) throw new Error("当前没有等待审批的候选")

  run.candidates = run.candidates.filter(
    (candidate) => candidate.id !== pending.candidateId
  )
  run.paretoFrontier = computeParetoFrontier(run.candidates, run.paretoSplit)
  const best = pickBestCandidate(run.candidates, run.paretoSplit)
  run.bestCandidateId = best?.id ?? null
  const record = run.iterations.find((item) => item.index === pending.iteration)
  if (record) {
    record.accepted = false
    record.humanDecision = "rejected"
  }
  run.pendingApproval = undefined
  run.updatedAt = nowIso()
  addLog(
    run,
    "warning",
    `已否决第 ${pending.iteration} 轮候选 ${pending.candidateId}，已从候选池移除；继续运行将基于既有候选重新反思`
  )
  await writeRun(run)
  await syncTask(task, run)
  emitApprovalResolved(run, "rejected")
  return run
}

/** 将指定候选人工设为最佳（不改写分数，只改写选择结果）。 */
export async function promoteCandidate(
  taskId: string,
  candidateId: string,
  runId?: string
): Promise<RunState> {
  const active = activeRuns.get(taskId)
  let run: RunState | null = active?.run ?? null
  if (!run) {
    const task = await requireTask(taskId)
    const targetRunId = runId ?? task.runId
    if (!targetRunId) throw new Error("该任务还没有运行记录")
    run = await readRun(taskId, targetRunId)
  }
  if (!run) throw new Error("找不到运行记录")

  const candidate = run.candidates.find((item) => item.id === candidateId)
  if (!candidate) throw new Error(`找不到候选：${candidateId}`)

  run.bestCandidateId = candidateId
  run.updatedAt = nowIso()
  addLog(
    run,
    "info",
    `已人工将候选 ${candidateId} 设为最佳候选（平均分 ${candidate.averageScore.toFixed(3)}）`
  )
  await writeRun(run)
  const task = await readTask(taskId)
  if (task) await syncTask(task, run)
  return run
}
