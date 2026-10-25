import { readLlmCalls, summarizeMetrics, type MetricsSummary } from "./metrics"
import { getActiveRun } from "./run-manager"
import { listTasks } from "./storage"
import { latestRunOf } from "./task-service"
import type { LlmCallLog, RunState, TaskRecord, TaskStatus } from "./types"

const RECENT_CALL_LIMIT = 20

const TASK_STATUSES: TaskStatus[] = [
  "draft",
  "ready",
  "running",
  "paused",
  "completed",
  "failed",
]

// 监控页把「运行中 / 暂停 / 失败」排在前面，其余按更新时间倒序。
const STATUS_PRIORITY: Record<TaskStatus, number> = {
  running: 0,
  paused: 1,
  failed: 2,
  completed: 3,
  ready: 4,
  draft: 5,
}

const EMPTY_METRICS: MetricsSummary = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  estimatedCost: 0,
  cacheCost: 0,
  harnessCost: 0,
  byAgent: {},
  byTask: {},
  byDay: [],
}

export interface TaskProgress {
  id: string
  name: string
  status: TaskStatus
  runId: string | null
  iteration: number
  budgetUsed: number
  budget: number
  bestScore: number | null
  candidates: number
  updatedAt: string
  href: string
  /** 活动运行的实时阶段描述（如「执行子代候选（2/3）」）。 */
  liveLabel?: string
  /** 运行是否已请求暂停/停止（等待边界生效）。 */
  pausing?: boolean
  /** 是否存在等待人工审批的候选。 */
  awaitingApproval?: boolean
}

export interface MonitorSnapshot {
  generatedAt: string
  metrics: MetricsSummary
  totals: {
    tasks: number
    running: number
    paused: number
    completed: number
    failed: number
    totalIterations: number
    acceptedCandidates: number
    awaitingApproval: number
  }
  tasks: TaskProgress[]
  recentCalls: LlmCallLog[]
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function safeNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback
}

function safeStatus(value: unknown): TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus)
    ? (value as TaskStatus)
    : "draft"
}

function safeIso(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback
}

function bestScoreOf(run: RunState | null): number | null {
  if (!run || !run.bestCandidateId || !Array.isArray(run.candidates)) {
    return null
  }
  const best = run.candidates.find(
    (candidate) => candidate?.id === run.bestCandidateId
  )
  return isFiniteNumber(best?.averageScore) ? best.averageScore : null
}

function acceptedCountOf(run: RunState | null): number {
  if (!run || !Array.isArray(run.iterations)) return 0
  return run.iterations.filter((iteration) => iteration?.accepted === true)
    .length
}

function toProgress(task: TaskRecord, run: RunState | null): TaskProgress {
  return {
    id: task.id,
    name: task.name || task.id,
    status: safeStatus(task.status),
    runId: run?.id ?? task.runId ?? null,
    iteration: safeNumber(run?.iteration, 0),
    budgetUsed: safeNumber(run?.budgetUsed, 0),
    budget: safeNumber(run?.budget, safeNumber(task.iteration?.budget, 0)),
    bestScore: bestScoreOf(run),
    candidates: Array.isArray(run?.candidates) ? run.candidates.length : 0,
    updatedAt: safeIso(run?.updatedAt, task.updatedAt),
    href: `/gepa/tasks/${task.id}`,
  }
}

/**
 * 汇总监控页所需的全部数据：全局指标、任务最新运行进度与最近调用。
 * 单个任务或指标文件损坏不会影响整体快照。
 */
export async function getMonitorSnapshot(): Promise<MonitorSnapshot> {
  const [tasks, metrics, calls] = await Promise.all([
    listTasks(),
    summarizeMetrics().catch(() => EMPTY_METRICS),
    readLlmCalls(RECENT_CALL_LIMIT).catch(() => [] as LlmCallLog[]),
  ])

  const entries = await Promise.all(
    tasks.map(async (task) => {
      const run = await latestRunOf(task.id)
      const item = toProgress(task, run)
      const active = getActiveRun(task.id)
      if (active) {
        if (active.progress) item.liveLabel = active.progress.label
        if (active.control.pauseRequested) item.pausing = true
        if (active.control.stopRequested) item.pausing = true
      }
      if (run?.pendingApproval) item.awaitingApproval = true
      return { progress: item, accepted: acceptedCountOf(run) }
    })
  )

  const progress = entries
    .map((entry) => entry.progress)
    .sort((a, b) => {
      const priority = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
      return priority !== 0 ? priority : b.updatedAt.localeCompare(a.updatedAt)
    })

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    totals: {
      tasks: progress.length,
      running: progress.filter((task) => task.status === "running").length,
      paused: progress.filter((task) => task.status === "paused").length,
      completed: progress.filter((task) => task.status === "completed").length,
      failed: progress.filter((task) => task.status === "failed").length,
      totalIterations: progress.reduce((sum, task) => sum + task.iteration, 0),
      acceptedCandidates: entries.reduce(
        (sum, entry) => sum + entry.accepted,
        0
      ),
      awaitingApproval: progress.filter((task) => task.awaitingApproval).length,
    },
    tasks: progress,
    recentCalls: calls.slice().reverse(),
  }
}
