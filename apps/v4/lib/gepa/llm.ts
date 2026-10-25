import { logLlmCall } from "./metrics"
import {
  callProvider,
  callProviderStream,
  type LlmMessage,
  type LlmResult,
  type ProviderStreamHandlers,
} from "./providers"
import { readAgents, readSettings, resolveProvider } from "./storage"
import type {
  AgentConfig,
  AgentId,
  LlmCallLog,
  LlmProvider,
  MonitorConfig,
} from "./types"

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

/** 按监控定价估算单次调用成本（与 metrics.ts 的口径一致）。 */
export function estimateCallCost(
  pricing: MonitorConfig,
  usage: { inputTokens: number; outputTokens: number; cacheTokens: number }
): number {
  const billableInput = Math.max(0, usage.inputTokens - usage.cacheTokens)
  return (
    (billableInput / 1_000_000) * pricing.inputCostPerMillion +
    (usage.cacheTokens / 1_000_000) * pricing.cacheCostPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillion
  )
}

async function safeLog(log: Omit<LlmCallLog, "id" | "at">): Promise<void> {
  try {
    await logLlmCall(log)
  } catch {
    // 指标写入失败不影响主流程
  }
}

interface AgentRunContext {
  agent: AgentConfig
  provider: LlmProvider
  model: string
  prompt: string
  messages: LlmMessage[]
  pricing: MonitorConfig
}

async function resolveAgentRun(
  agentId: AgentId,
  variables: Record<string, string>
): Promise<AgentRunContext> {
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
  return {
    agent,
    provider,
    model,
    prompt,
    messages: [{ role: "system", content: prompt }],
    pricing: settings.monitor,
  }
}

export type AgentRunResult = LlmResult & {
  agent: AgentConfig
  provider: LlmProvider
  /** 按监控定价估算的本次调用成本（美元）。 */
  costUsd: number
}

export async function runAgent(
  agentId: AgentId,
  variables: Record<string, string>,
  meta?: { taskId?: string; runId?: string },
  signal?: AbortSignal
): Promise<AgentRunResult> {
  const context = await resolveAgentRun(agentId, variables)
  const { agent, provider, model, prompt, messages, pricing } = context
  const startedAt = Date.now()

  try {
    const result = await callProvider(provider, { model, messages }, signal)
    const costUsd = estimateCallCost(pricing, result)
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
      costUsd,
    })
    return { ...result, agent, provider, costUsd }
  } catch (error) {
    if (signal?.aborted) throw error
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

/** 流式运行 Agent：逐段回调文本与思考内容，结束后记录完整用量。 */
export async function runAgentStream(
  agentId: AgentId,
  variables: Record<string, string>,
  handlers: ProviderStreamHandlers = {},
  meta?: { taskId?: string; runId?: string },
  signal?: AbortSignal
): Promise<AgentRunResult> {
  const context = await resolveAgentRun(agentId, variables)
  const { agent, provider, model, prompt, messages, pricing } = context
  const startedAt = Date.now()

  try {
    const result = await callProviderStream(
      provider,
      { model, messages },
      handlers,
      signal
    )
    const costUsd = estimateCallCost(pricing, result)
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
      costUsd,
    })
    return { ...result, agent, provider, costUsd }
  } catch (error) {
    if (!signal?.aborted) {
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
    }
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
  meta?: { taskId?: string; runId?: string },
  signal?: AbortSignal
): Promise<{ data: T; raw: string; costUsd: number }> {
  const result = await runAgent(agentId, variables, meta, signal)
  return {
    data: parseJsonLoose<T>(result.text),
    raw: result.text,
    costUsd: result.costUsd,
  }
}
