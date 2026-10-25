import type { RunStatus, TaskStatus } from "@/lib/gepa/types"

export interface StatusMeta {
  label: string
  className: string
  dot?: boolean
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  draft: {
    label: "草稿",
    className: "border-border bg-muted text-muted-foreground",
  },
  ready: {
    label: "就绪",
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  running: {
    label: "运行中",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: true,
  },
  paused: {
    label: "已暂停",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "已完成",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "失败",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
}

export const RUN_STATUS_META: Record<RunStatus, StatusMeta> = {
  idle: {
    label: "空闲",
    className: "border-border bg-muted text-muted-foreground",
  },
  running: {
    label: "运行中",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: true,
  },
  paused: {
    label: "已暂停",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "已完成",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  stopped: {
    label: "已停止",
    className: "border-border bg-muted text-muted-foreground",
  },
  failed: {
    label: "失败",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
}

export const LOG_LEVEL_META: Record<
  string,
  { label: string; className: string }
> = {
  info: { label: "信息", className: "text-muted-foreground" },
  success: {
    label: "成功",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  warning: { label: "警告", className: "text-amber-600 dark:text-amber-400" },
  error: { label: "错误", className: "text-destructive" },
}

export const ACTION_LABELS: Record<string, string> = {
  start: "开始运行",
  pause: "暂停",
  resume: "继续",
  stop: "停止",
  step: "单步",
  setBudget: "设置预算",
  setMinibatch: "设置 minibatch",
  setIterationLimit: "设置迭代上限",
  updateModulePrompt: "更新模块提示词",
  createTask: "创建任务",
  deleteTask: "删除任务",
  updateTask: "更新任务",
  note: "备注",
}

export function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 本地时间 `YYYY-MM-DD HH:mm`。 */
export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return "—"
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 本地时间 `HH:mm:ss`，用于日志。 */
export function formatClock(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return "—"
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds()
  )}`
}

export function formatScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "—"
}

export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** 金额格式：固定 4 位小数，例如 $0.0654。 */
export function formatUsd(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(4)}`
    : "—"
}

/** 运行耗时格式：mm:ss（超过 1 小时为 h:mm:ss），用于实时进度计时。 */
export function formatElapsed(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—"
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  return `${pad2(minutes)}:${pad2(seconds)}`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "—"
  }
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function percent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)))
}
