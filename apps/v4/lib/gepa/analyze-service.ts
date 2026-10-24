import {
  parseAnalysisPayload,
  saveAnalysisReport,
  type AnalysisReport,
} from "./analysis-store"
import {
  readClaudeConfigs,
  readSessionScan,
  renderConfigsText,
  renderDigestText,
  type AnalysisIncludeOptions,
  type ClaudeConfigSnapshot,
  type SessionScan,
} from "./claude-inspect"
import { parseJsonLoose, runAgent } from "./llm"

export interface AnalyzeDigest {
  scan: SessionScan
  digestText: string
  configsText: string
  configs: ClaudeConfigSnapshot
  include: AnalysisIncludeOptions
}

/** 扫描会话并（按选项）收集配置，渲染为可预览/可发送的摘要文本。 */
export async function buildAnalyzeDigest(
  project: string,
  sessionId: string,
  include: AnalysisIncludeOptions
): Promise<AnalyzeDigest> {
  const scan = await readSessionScan(project, sessionId)
  const configs = await readClaudeConfigs(include, scan.cwd)
  return {
    scan,
    digestText: renderDigestText(scan),
    configsText: renderConfigsText(configs),
    configs,
    include,
  }
}

export async function runAnalysis(
  project: string,
  sessionId: string,
  include: AnalysisIncludeOptions
): Promise<AnalysisReport> {
  const digest = await buildAnalyzeDigest(project, sessionId, include)
  const result = await runAgent("analyst", {
    digest: digest.digestText,
    configs: digest.configsText,
  })
  const payload = parseAnalysisPayload(parseJsonLoose<unknown>(result.text))
  if (!payload.summary && payload.findings.length === 0) {
    throw new Error("分析结果为空，请检查会话分析师 Agent 的提示词与输出格式")
  }
  return saveAnalysisReport({
    project,
    projectCwd: digest.scan.cwd,
    sessionId,
    sessionTitle: digest.scan.title ?? "(无标题)",
    sessionUpdatedAt: digest.scan.updatedAt,
    digestChars: digest.digestText.length,
    configsChars: digest.configsText.length,
    include,
    summary: payload.summary,
    score: payload.score,
    findings: payload.findings,
    nextSteps: payload.nextSteps,
    providerName: result.provider.name,
    model:
      result.agent.model.trim() ||
      result.provider.defaultModel ||
      result.provider.models[0] ||
      "",
    durationMs: result.durationMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheTokens: result.cacheTokens,
  })
}
