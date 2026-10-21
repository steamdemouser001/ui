const numberFormatter = new Intl.NumberFormat("zh-CN")

const compactNumberFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const AGENT_LABELS: Record<string, string> = {
  orchestrator: "总控",
  executor: "执行器",
  evaluator: "评估器",
  reflector: "反思器",
  summarizer: "摘要器",
  "llm-test": "连接测试",
}

export function agentLabel(agentId: string): string {
  return AGENT_LABELS[agentId] ?? (agentId || "未知")
}

export function formatNumber(value: number): string {
  return numberFormatter.format(Number.isFinite(value) ? value : 0)
}

export function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(Number.isFinite(value) ? value : 0)
}

export function formatCost(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toFixed(4)}`
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—"
  return `${(value * 100).toFixed(1)}%`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
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

/** 本地时间 `MM-DD HH:mm:ss`，用于调用流水。 */
export function formatShortDateTime(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return "—"
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 本地时间 `HH:mm:ss`，用于「最后更新」。 */
export function formatClock(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return "—"
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds()
  )}`
}
