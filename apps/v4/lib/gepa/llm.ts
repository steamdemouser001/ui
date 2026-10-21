import { logLlmCall } from "./metrics"
import { callProvider, type LlmMessage, type LlmResult } from "./providers"
import { readAgents, readSettings, resolveProvider } from "./storage"
import type { AgentConfig, AgentId, LlmCallLog, LlmProvider } from "./types"

export function renderPrompt(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(
    /\{\{\s*([\w.-]+)\s*\}\}/g,
    (_match, name: string) => {
      return variables[name] ?? ""
    }
  )
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function safeLog(log: Omit<LlmCallLog, "id" | "at">): Promise<void> {
  try {
    await logLlmCall(log)
  } catch {
    // 指标写入失败不影响主流程
  }
}

export async function runAgent(
  agentId: AgentId,
  variables: Record<string, string>,
  meta?: { taskId?: string; runId?: string }
): Promise<LlmResult & { agent: AgentConfig; provider: LlmProvider }> {
  const agents = await readAgents()
  const agent = agents.find((item) => item.id === agentId)
  if (!agent) {
    throw new Error(`未知 Agent：${agentId}`)
  }
  if (!agent.enabled) {
    throw new Error(`Agent「${agent.name}」已停用`)
  }
  const settings = await readSettings()
  const provider = await resolveProvider(
    agent.providerId ?? settings.defaultProviderId
  )
  const model =
    agent.model.trim() || provider.defaultModel || provider.models[0] || ""
  if (!model) {
    throw new Error(
      `供应商「${provider.name}」没有可用模型，请先在 /gepa/llm 配置默认模型`
    )
  }
  const prompt = renderPrompt(agent.prompt, variables)
  const messages: LlmMessage[] = [{ role: "system", content: prompt }]
  const startedAt = Date.now()

  try {
    const result = await callProvider(provider, {
      model,
      messages,
    })
    await safeLog({
      providerId: provider.id,
      providerName: provider.name,
      model,
      agentId,
      taskId: meta?.taskId,
      runId: meta?.runId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheTokens: result.cacheTokens,
      durationMs: result.durationMs,
      success: true,
    })
    return { ...result, agent, provider }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await safeLog({
      providerId: provider.id,
      providerName: provider.name,
      model,
      agentId,
      taskId: meta?.taskId,
      runId: meta?.runId,
      inputTokens: estimateTokens(prompt),
      outputTokens: 0,
      cacheTokens: 0,
      durationMs: Date.now() - startedAt,
      success: false,
      error: message,
    })
    throw error
  }
}

export function parseJsonLoose<T>(raw: string): T {
  const text = raw.trim().replace(/^\uFEFF/, "")
  if (!text) {
    throw new Error("LLM 返回为空，无法解析 JSON")
  }
  const candidates: string[] = []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim())
  }
  candidates.push(text)
  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1))
  }
  const firstBracket = text.indexOf("[")
  const lastBracket = text.lastIndexOf("]")
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1))
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      // 尝试下一个候选片段
    }
  }
  const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text
  throw new Error(`无法解析 LLM 返回的 JSON：${snippet}`)
}

export async function runAgentJson<T>(
  agentId: AgentId,
  variables: Record<string, string>,
  meta?: { taskId?: string; runId?: string }
): Promise<{ data: T; raw: string }> {
  const result = await runAgent(agentId, variables, meta)
  return { data: parseJsonLoose<T>(result.text), raw: result.text }
}
