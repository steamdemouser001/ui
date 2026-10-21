import type { LlmProvider, LlmProviderKind } from "./types"

export { resolveProvider } from "./storage"

export function parseProviderKind(value: unknown): LlmProviderKind {
  return value === "anthropic" ? "anthropic" : "openai-compatible"
}

export function parseModelsInput(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(/[,\n，]/)
      : []
  return [...new Set(raw.map((item) => item.trim()).filter(Boolean))]
}

export interface LlmMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LlmResult {
  text: string
  inputTokens: number
  outputTokens: number
  durationMs: number
}

export interface CallProviderOptions {
  model: string
  messages: LlmMessage[]
  temperature?: number
  maxTokens?: number
}

const REQUEST_TIMEOUT_MS = 120_000

export function maskApiKey(apiKey: string): string {
  if (!apiKey) return ""
  if (apiKey.length <= 7) {
    return "*".repeat(Math.max(4, apiKey.length))
  }
  return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`
}

export function maskProvider(provider: LlmProvider): LlmProvider {
  return { ...provider, apiKey: maskApiKey(provider.apiKey) }
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "")
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text
          if (typeof text === "string") return text
        }
        return ""
      })
      .join("")
  }
  return ""
}

function summarizeErrorBody(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return summarizeErrorBody(await response.text())
  } catch {
    return ""
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `LLM 请求超时（${Math.round(REQUEST_TIMEOUT_MS / 1000)}s）`
      )
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`LLM 请求失败：${reason}`)
  } finally {
    clearTimeout(timer)
  }
}

interface OpenAiResponse {
  choices?: { message?: { content?: unknown } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
}

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

async function callOpenAiCompatible(
  provider: LlmProvider,
  options: CallProviderOptions
): Promise<Omit<LlmResult, "durationMs">> {
  const url = `${trimBaseUrl(provider.baseUrl)}/chat/completions`
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false,
    }),
  })
  if (!response.ok) {
    throw new Error(
      `LLM 请求失败（HTTP ${response.status}）：${await readErrorBody(response)}`
    )
  }
  const payload = (await response.json()) as OpenAiResponse
  const text = normalizeContent(payload.choices?.[0]?.message?.content)
  const usage = payload.usage
  return {
    text,
    inputTokens:
      usage?.prompt_tokens ??
      usage?.input_tokens ??
      estimateTokens(options.messages.map((message) => message.content).join("\n")),
    outputTokens:
      usage?.completion_tokens ?? usage?.output_tokens ?? estimateTokens(text),
  }
}

async function callAnthropic(
  provider: LlmProvider,
  options: CallProviderOptions
): Promise<Omit<LlmResult, "durationMs">> {
  const base = trimBaseUrl(provider.baseUrl)
  const url = /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`
  const system = options.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const messages = options.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }))
  if (messages.length === 0) {
    messages.push({ role: "user", content: "请按照系统提示完成任务。" })
  }
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      system: system || undefined,
      messages,
    }),
  })
  if (!response.ok) {
    throw new Error(
      `LLM 请求失败（HTTP ${response.status}）：${await readErrorBody(response)}`
    )
  }
  const payload = (await response.json()) as AnthropicResponse
  const text = (payload.content ?? [])
    .filter((block) => typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
  return {
    text,
    inputTokens:
      payload.usage?.input_tokens ??
      estimateTokens(options.messages.map((message) => message.content).join("\n")),
    outputTokens:
      payload.usage?.output_tokens ?? estimateTokens(text),
  }
}

export async function callProvider(
  provider: LlmProvider,
  options: CallProviderOptions
): Promise<LlmResult> {
  if (!provider.baseUrl.trim()) {
    throw new Error(`LLM 供应商「${provider.name}」未配置 Base URL`)
  }
  if (!provider.apiKey.trim()) {
    throw new Error(`LLM 供应商「${provider.name}」未配置 API Key`)
  }
  if (!options.model.trim()) {
    throw new Error(`LLM 供应商「${provider.name}」未指定模型`)
  }
  const startedAt = Date.now()
  const result =
    provider.kind === "anthropic"
      ? await callAnthropic(provider, options)
      : await callOpenAiCompatible(provider, options)
  return { ...result, durationMs: Date.now() - startedAt }
}
