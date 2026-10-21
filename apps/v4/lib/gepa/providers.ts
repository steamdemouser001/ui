import { normalizeProviderGeneration } from "./defaults"
import type {
  LlmProvider,
  LlmProviderKind,
  ProviderGeneration,
  ReasoningEffort,
} from "./types"

export { resolveProvider } from "./storage"

export function parseProviderKind(value: unknown): LlmProviderKind {
  return value === "anthropic" ? "anthropic" : "openai-compatible"
}

export function parseProviderGeneration(value: unknown): ProviderGeneration {
  return normalizeProviderGeneration(value)
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
}

const REQUEST_TIMEOUT_MS = 120_000
const MODELS_TIMEOUT_MS = 30_000
const MODELS_MAX_PAGES = 10
const RETRY_BASE_DELAY_MS = 500

class ProviderRequestError extends Error {
  readonly status: number | null
  readonly retryable: boolean

  constructor(
    message: string,
    options: { status?: number; retryable: boolean }
  ) {
    super(message)
    this.name = "ProviderRequestError"
    this.status = options.status ?? null
    this.retryable = options.retryable
  }
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(error: unknown): boolean {
  return error instanceof ProviderRequestError && error.retryable
}

async function createHttpError(
  response: Response,
  prefix = "LLM 请求"
): Promise<ProviderRequestError> {
  const body = await readErrorBody(response)
  return new ProviderRequestError(
    `${prefix}失败（HTTP ${response.status}）：${body}`,
    {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    }
  )
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
  prefix = "LLM 请求"
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderRequestError(
        `${prefix}超时（${Math.round(timeoutMs / 1000)}s）`,
        { retryable: true }
      )
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new ProviderRequestError(`${prefix}失败：${reason}`, {
      retryable: true,
    })
  } finally {
    clearTimeout(timer)
  }
}

function extractModelIds(items: unknown[]): string[] {
  const ids: string[] = []
  for (const item of items) {
    if (typeof item === "string") {
      const id = item.trim()
      if (id) ids.push(id)
      continue
    }
    if (item && typeof item === "object") {
      const id = (item as { id?: unknown }).id
      if (typeof id === "string" && id.trim()) {
        ids.push(id.trim())
      }
    }
  }
  return ids
}

function extractModelsFromPayload(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return extractModelIds(payload)
  }
  if (!payload || typeof payload !== "object") {
    return []
  }
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.data)) {
    return extractModelIds(record.data)
  }
  if (Array.isArray(record.models)) {
    return extractModelIds(record.models)
  }
  return []
}

function dedupeModels(models: string[]): string[] {
  return [...new Set(models)]
}

async function parseModelsResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ProviderRequestError(
      `获取模型列表失败（HTTP ${response.status}）：响应不是合法 JSON`,
      { status: response.status, retryable: false }
    )
  }
}

async function listOpenAiCompatibleModels(
  provider: Pick<LlmProvider, "baseUrl" | "apiKey">
): Promise<string[]> {
  const response = await fetchWithTimeout(
    `${trimBaseUrl(provider.baseUrl)}/models`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
    },
    MODELS_TIMEOUT_MS,
    "获取模型列表"
  )
  if (!response.ok) {
    throw await createHttpError(response, "获取模型列表")
  }
  return dedupeModels(
    extractModelsFromPayload(await parseModelsResponse(response))
  )
}

interface AnthropicModelsPage {
  data?: unknown
  has_more?: unknown
  last_id?: unknown
}

async function listAnthropicModels(
  provider: Pick<LlmProvider, "baseUrl" | "apiKey">
): Promise<string[]> {
  const base = trimBaseUrl(provider.baseUrl)
  const root = /\/v1$/.test(base) ? base : `${base}/v1`
  const models: string[] = []
  let afterId: string | null = null

  for (let page = 0; page < MODELS_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: "1000" })
    if (afterId) params.set("after_id", afterId)
    const response = await fetchWithTimeout(
      `${root}/models?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
      MODELS_TIMEOUT_MS,
      "获取模型列表"
    )
    if (!response.ok) {
      throw await createHttpError(response, "获取模型列表")
    }
    const payload = (await parseModelsResponse(response)) as AnthropicModelsPage
    models.push(...extractModelsFromPayload(payload))
    if (
      payload.has_more !== true ||
      typeof payload.last_id !== "string" ||
      !payload.last_id
    ) {
      break
    }
    afterId = payload.last_id
  }

  return dedupeModels(models)
}

export async function listProviderModels(
  provider: Pick<LlmProvider, "kind" | "baseUrl" | "apiKey">
): Promise<string[]> {
  if (!provider.baseUrl.trim()) {
    throw new Error("请填写 Base URL")
  }
  if (!provider.apiKey.trim()) {
    throw new Error("请填写 API Key")
  }
  return provider.kind === "anthropic"
    ? listAnthropicModels(provider)
    : listOpenAiCompatibleModels(provider)
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

const THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  low: 1024,
  high: 8192,
  max: 16384,
}

async function callOpenAiCompatible(
  provider: LlmProvider,
  options: CallProviderOptions,
  generation: ProviderGeneration,
  maxOutput: number
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
      reasoning_effort: generation.reasoningEffort,
      max_tokens: maxOutput,
      stream: false,
    }),
  })
  if (!response.ok) {
    throw await createHttpError(response)
  }
  const payload = (await response.json()) as OpenAiResponse
  const text = normalizeContent(payload.choices?.[0]?.message?.content)
  const usage = payload.usage
  return {
    text,
    inputTokens:
      usage?.prompt_tokens ??
      usage?.input_tokens ??
      estimateTokens(
        options.messages.map((message) => message.content).join("\n")
      ),
    outputTokens:
      usage?.completion_tokens ?? usage?.output_tokens ?? estimateTokens(text),
  }
}

async function callAnthropic(
  provider: LlmProvider,
  options: CallProviderOptions,
  generation: ProviderGeneration,
  estimatedInput: number,
  contextTokens: number
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

  const available = contextTokens - estimatedInput
  if (available < 2048) {
    throw new Error(
      `供应商「${provider.name}」的上下文长度不足以支持思考模式（当前 ${generation.contextLength}k），请增大上下文长度或缩短输入`
    )
  }
  const budget = Math.min(
    THINKING_BUDGETS[generation.reasoningEffort],
    available - 1024
  )
  const maxTokens = Math.min(
    available,
    Math.max(budget + 1024, Math.min(8192, available))
  )

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: maxTokens,
      thinking: { type: "enabled", budget_tokens: budget },
      system: system || undefined,
      messages,
    }),
  })
  if (!response.ok) {
    throw await createHttpError(response)
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
      estimateTokens(
        options.messages.map((message) => message.content).join("\n")
      ),
    outputTokens: payload.usage?.output_tokens ?? estimateTokens(text),
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

  const generation = normalizeProviderGeneration(provider.generation)
  const contextTokens = generation.contextLength * 1024
  const estimatedInput = estimateTokens(
    options.messages.map((message) => message.content).join("\n")
  )
  if (estimatedInput >= contextTokens) {
    throw new Error(
      `输入约 ${estimatedInput} tokens，超过供应商「${provider.name}」的上下文长度 ${generation.contextLength}k（${contextTokens} tokens）`
    )
  }
  const available = contextTokens - estimatedInput
  if (available < 256) {
    throw new Error(
      `供应商「${provider.name}」的上下文长度不足以生成回复（当前 ${generation.contextLength}k），请增大上下文长度或缩短输入`
    )
  }
  const maxOutput = Math.min(8192, available)
  const maxRetries = Math.max(0, Math.trunc(generation.maxRetries))
  const startedAt = Date.now()

  for (let attempt = 0; ; attempt += 1) {
    try {
      const result =
        provider.kind === "anthropic"
          ? await callAnthropic(
              provider,
              options,
              generation,
              estimatedInput,
              contextTokens
            )
          : await callOpenAiCompatible(provider, options, generation, maxOutput)
      return { ...result, durationMs: Date.now() - startedAt }
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }
}
