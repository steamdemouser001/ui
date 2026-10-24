import { randomUUID } from "node:crypto"

import { appendJsonl, readJsonl, withLock, writeJsonl } from "./storage"

/**
 * 会话分析报告的本地存储：每份报告以 JSONL 追加记录，
 * 列表读取最近 N 条，删除/裁剪时重写整个文件。
 */

export type FindingSeverity = "high" | "medium" | "low"

export type FindingCategory =
  | "efficiency"
  | "context"
  | "skill"
  | "hook"
  | "config"
  | "cost"

export interface AnalysisFinding {
  title: string
  severity: FindingSeverity
  category: FindingCategory
  evidence: string
  suggestion: string
}

export interface AnalysisReport {
  id: string
  at: string
  project: string
  projectCwd: string | null
  sessionId: string
  sessionTitle: string
  sessionUpdatedAt: string | null
  digestChars: number
  configsChars: number
  include: {
    skills: boolean
    hooks: boolean
    commands: boolean
    memory: boolean
    mcp: boolean
    plugins: boolean
  }
  summary: string
  score: number | null
  findings: AnalysisFinding[]
  nextSteps: string[]
  providerName: string
  model: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
}

const REPORTS_FILE = "analysis/reports.jsonl"
const MAX_STORED_REPORTS = 200

function normalizeFinding(value: unknown): AnalysisFinding | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const title = typeof record.title === "string" ? record.title.trim() : ""
  const evidence =
    typeof record.evidence === "string" ? record.evidence.trim() : ""
  const suggestion =
    typeof record.suggestion === "string" ? record.suggestion.trim() : ""
  if (!title || !suggestion) return null
  const severity = record.severity
  const category = record.category
  return {
    title,
    severity:
      severity === "high" || severity === "medium" || severity === "low"
        ? severity
        : "medium",
    category:
      category === "efficiency" ||
      category === "context" ||
      category === "skill" ||
      category === "hook" ||
      category === "config" ||
      category === "cost"
        ? category
        : "efficiency",
    evidence,
    suggestion,
  }
}

export function parseAnalysisPayload(raw: unknown): {
  summary: string
  score: number | null
  findings: AnalysisFinding[]
  nextSteps: string[]
} {
  if (typeof raw !== "object" || raw === null) {
    return { summary: "", score: null, findings: [], nextSteps: [] }
  }
  const record = raw as Record<string, unknown>
  const findings = Array.isArray(record.findings)
    ? record.findings
        .map(normalizeFinding)
        .filter((item): item is AnalysisFinding => item !== null)
    : []
  const score =
    typeof record.score === "number" && Number.isFinite(record.score)
      ? Math.min(10, Math.max(0, record.score))
      : null
  return {
    summary: typeof record.summary === "string" ? record.summary.trim() : "",
    score,
    findings,
    nextSteps: Array.isArray(record.nextSteps)
      ? record.nextSteps
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [],
  }
}

export async function saveAnalysisReport(
  report: Omit<AnalysisReport, "id" | "at">
): Promise<AnalysisReport> {
  const entry: AnalysisReport = {
    ...report,
    id: randomUUID(),
    at: new Date().toISOString(),
  }
  await withLock("analysis", async () => {
    await appendJsonl(REPORTS_FILE, entry)
    // 超过上限时裁剪旧记录，避免文件无限增长。
    const all = await readJsonl<AnalysisReport>(REPORTS_FILE)
    if (all.length > MAX_STORED_REPORTS) {
      await writeJsonl(REPORTS_FILE, all.slice(all.length - MAX_STORED_REPORTS))
    }
  })
  return entry
}

export async function listAnalysisReports(
  limit = 30
): Promise<AnalysisReport[]> {
  const all = await readJsonl<AnalysisReport>(REPORTS_FILE)
  return all.slice(-Math.max(1, Math.min(100, limit))).reverse()
}

export async function readAnalysisReport(
  id: string
): Promise<AnalysisReport | null> {
  const all = await readJsonl<AnalysisReport>(REPORTS_FILE)
  return all.find((item) => item.id === id) ?? null
}

export async function deleteAnalysisReport(id: string): Promise<void> {
  await withLock("analysis", async () => {
    const all = await readJsonl<AnalysisReport>(REPORTS_FILE)
    const kept = all.filter((item) => item.id !== id)
    if (kept.length === all.length) return
    await writeJsonl(REPORTS_FILE, kept)
  })
}
