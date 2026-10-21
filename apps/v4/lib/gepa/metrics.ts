import { randomUUID } from "node:crypto"

import { appendJsonl, readJsonl, readSettings, withLock } from "./storage"
import type { LlmCallLog } from "./types"

const METRICS_FILE = "metrics/llm-calls.jsonl"

export async function logLlmCall(
  log: Omit<LlmCallLog, "id" | "at">
): Promise<void> {
  const entry: LlmCallLog = {
    ...log,
    id: randomUUID(),
    at: new Date().toISOString(),
  }
  await withLock("metrics", () => appendJsonl(METRICS_FILE, entry))
}

export async function readLlmCalls(limit?: number): Promise<LlmCallLog[]> {
  return readJsonl<LlmCallLog>(METRICS_FILE, limit)
}

export interface MetricsSummary {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  byAgent: Record<string, number>
  byTask: Record<string, number>
  byDay: {
    date: string
    calls: number
    inputTokens: number
    outputTokens: number
  }[]
}

export async function summarizeMetrics(): Promise<MetricsSummary> {
  const [calls, settings] = await Promise.all([readLlmCalls(), readSettings()])
  const summary: MetricsSummary = {
    totalCalls: calls.length,
    successfulCalls: 0,
    failedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    byAgent: {},
    byTask: {},
    byDay: [],
  }
  const days = new Map<
    string,
    { date: string; calls: number; inputTokens: number; outputTokens: number }
  >()

  for (const call of calls) {
    if (call.success) {
      summary.successfulCalls += 1
    } else {
      summary.failedCalls += 1
    }
    const inputTokens = Number.isFinite(call.inputTokens) ? call.inputTokens : 0
    const outputTokens = Number.isFinite(call.outputTokens)
      ? call.outputTokens
      : 0
    summary.inputTokens += inputTokens
    summary.outputTokens += outputTokens

    const agentKey = call.agentId || "unknown"
    summary.byAgent[agentKey] = (summary.byAgent[agentKey] ?? 0) + 1

    const taskKey = call.taskId || "未关联任务"
    summary.byTask[taskKey] = (summary.byTask[taskKey] ?? 0) + 1

    const date = call.at.slice(0, 10)
    const day = days.get(date) ?? {
      date,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    day.calls += 1
    day.inputTokens += inputTokens
    day.outputTokens += outputTokens
    days.set(date, day)
  }

  const inputCost =
    (summary.inputTokens / 1_000_000) * settings.monitor.inputCostPerMillion
  const outputCost =
    (summary.outputTokens / 1_000_000) * settings.monitor.outputCostPerMillion
  summary.estimatedCost =
    Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
  summary.byDay = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  return summary
}
