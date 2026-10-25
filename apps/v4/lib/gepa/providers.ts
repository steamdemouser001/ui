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
  cacheTokens: number
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

/** 取第一个有限数字，用于兼容不同供应商的缓存 Token 字段。 */
function firstFiniteTokenCount(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
  }
  return 0
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
  prefix = "LLM 请求",
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener("abort", onAbort, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new Error("请求已取消")
    }
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
    externalSignal?.removeEventListener("abort", onAbort)
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
    prompt_tokens_details?: { cached_tokens?: number }
    input_tokens_details?: { cached_tokens?: number }
    cached_tokens?: number
    prompt_cache_hit_tokens?: number
  }
}

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
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
  maxOutput: number,
  signal?: AbortSignal
): Promise<Omit<LlmResult, "durationMs">> {
  const url = `${trimBaseUrl(provider.baseUrl)}/chat/completions`
  const response = await fetchWithTimeout(
    url,
    {
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
    },
    REQUEST_TIMEOUT_MS,
    "LLM 请求",
    signal
  )
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
    cacheTokens: firstFiniteTokenCount(
      usage?.prompt_tokens_details?.cached_tokens,
      usage?.input_tokens_details?.cached_tokens,
      usage?.cached_tokens,
      usage?.prompt_cache_hit_tokens
    ),
  }
}

async function callAnthropic(
  provider: LlmProvider,
  options: CallProviderOptions,
  generation: ProviderGeneration,
  estimatedInput: number,
  contextTokens: number,
  signal?: AbortSignal
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

  const response = await fetchWithTimeout(
    url,
    {
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
    },
    REQUEST_TIMEOUT_MS,
    "LLM 请求",
    signal
  )
  if (!response.ok) {
    throw await createHttpError(response)
  }
  const payload = (await response.json()) as AnthropicResponse
  const text = (payload.content ?? [])
    .filter((block) => typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
  const usage = payload.usage
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0
  const cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0
  const reportedInputTokens = usage?.input_tokens ?? null
  return {
    text,
    // Anthropic 的 input_tokens 不含缓存，这里归一化为包含缓存的总输入
    inputTokens:
      reportedInputTokens !== null
        ? reportedInputTokens + cacheReadTokens + cacheCreationTokens
        : estimateTokens(
            options.messages.map((message) => message.content).join("\n")
          ),
    outputTokens: usage?.output_tokens ?? estimateTokens(text),
    cacheTokens: cacheReadTokens,
  }
}

export interface ProviderStreamHandlers {
  onText?: (delta: string) => void
  onReasoning?: (delta: string) => void
}

interface StreamFetchState {
  response: Response
  touch: () => void
  cleanup: () => void
  timedOut: () => boolean
}

async function fetchStreamWithIdleTimeout(
  url: string,
  init: RequestInit,
  externalSignal: AbortSignal | undefined,
  idleMs = REQUEST_TIMEOUT_MS
): Promise<StreamFetchState> {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const onAbort = () => controller.abort()
  const cleanup = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    externalSignal?.removeEventListener("abort", onAbort)
  }
  const touch = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, idleMs)
  }

  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener("abort", onAbort, { once: true })
  touch()

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return {
      response,
      touch,
      cleanup,
      timedOut: () => timedOut,
    }
  } catch (error) {
    cleanup()
    if (timedOut) {
      throw new ProviderRequestError(
        `LLM 请求超时（${Math.round(idleMs / 1000)}s 无响应）`,
        { retryable: true }
      )
    }
    if (externalSignal?.aborted) {
      throw new Error("请求已取消")
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new ProviderRequestError(`LLM 请求失败：${reason}`, {
      retryable: true,
    })
  }
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: StreamFetchState,
  idleMs = REQUEST_TIMEOUT_MS
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return reader.read().catch((error: unknown) => {
    if (state.timedOut()) {
      throw new ProviderRequestError(
        `LLM 流式响应超时（${Math.round(idleMs / 1000)}s 无响应）`,
        { retryable: true }
      )
    }
    throw error
  })
}

interface OpenAiStreamChunk {
  choices?: {
    delta?: {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
    }
  }[]
  usage?: OpenAiResponse["usage"]
  error?: { message?: unknown } | string
}

interface AnthropicStreamEvent {
  type?: string
  message?: { usage?: AnthropicResponse["usage"] }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  delta?: { type?: string; text?: string; thinking?: string }
  error?: { message?: unknown }
}

function readOpenAiUsage(usage: OpenAiResponse["usage"]): {
  inputTokens: number | null
  outputTokens: number | null
  cacheTokens: number
} | null {
  if (!usage) return null
  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? null,
    cacheTokens: firstFiniteTokenCount(
      usage.prompt_tokens_details?.cached_tokens,
      usage.input_tokens_details?.cached_tokens,
      usage.cached_tokens,
      usage.prompt_cache_hit_tokens
    ),
  }
}

function errorTextFromPayload(payload: unknown): string {
  if (typeof payload === "string") return payload
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  return "未知错误"
}

async function callOpenAiCompatibleStream(
  provider: LlmProvider,
  options: CallProviderOptions,
  generation: ProviderGeneration,
  maxOutput: number,
  handlers: ProviderStreamHandlers,
  signal?: AbortSignal
): Promise<Omit<LlmResult, "durationMs">> {
  const url = `${trimBaseUrl(provider.baseUrl)}/chat/completions`
  const state = await fetchStreamWithIdleTimeout(
    url,
    {
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
        stream: true,
        stream_options: { include_usage: true },
      }),
    },
    signal
  )

  if (!state.response.ok) {
    state.cleanup()
    throw await createHttpError(state.response)
  }
  if (!state.response.body) {
    state.cleanup()
    throw new Error("LLM 流式响应为空")
  }

  const reader = state.response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let text = ""
  let reasoning = ""
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let cacheTokens = 0
  let finished = false

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(":")) return
    if (!trimmed.startsWith("data:")) return
    const data = trimmed.slice(5).trim()
    if (!data) return
    if (data === "[DONE]") {
      finished = true
      return
    }
    let payload: OpenAiStreamChunk
    try {
      payload = JSON.parse(data) as OpenAiStreamChunk
    } catch {
      return
    }
    if (payload.error) {
      throw new ProviderRequestError(
        `LLM 返回错误：${errorTextFromPayload(payload.error)}`,
        { retryable: false }
      )
    }
    const delta = payload.choices?.[0]?.delta
    if (delta) {
      const content = normalizeContent(delta.content)
      if (content) {
        text += content
        handlers.onText?.(content)
      }
      const reasoningDelta = normalizeContent(
        delta.reasoning_content ?? delta.reasoning
      )
      if (reasoningDelta) {
        reasoning += reasoningDelta
        handlers.onReasoning?.(reasoningDelta)
      }
    }
    const usage = readOpenAiUsage(payload.usage)
    if (usage) {
      if (usage.inputTokens !== null) inputTokens = usage.inputTokens
      if (usage.outputTokens !== null) outputTokens = usage.outputTokens
      cacheTokens = usage.cacheTokens
    }
  }

  try {
    while (!finished) {
      const chunk = await readStreamChunk(reader, state)
      if (chunk.done) break
      state.touch()
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        handleLine(line)
        if (finished) break
      }
    }
    if (!finished && buffer.trim()) {
      handleLine(buffer)
    }
  } finally {
    state.cleanup()
    await reader.cancel().catch(() => undefined)
  }

  return {
    text,
    inputTokens:
      inputTokens ??
      estimateTokens(
        options.messages.map((message) => message.content).join("\n")
      ),
    outputTokens: outputTokens ?? estimateTokens(text),
    cacheTokens,
  }
}

async function callAnthropicStream(
  provider: LlmProvider,
  options: CallProviderOptions,
  generation: ProviderGeneration,
  estimatedInput: number,
  contextTokens: number,
  handlers: ProviderStreamHandlers,
  signal?: AbortSignal
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

  const state = await fetchStreamWithIdleTimeout(
    url,
    {
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
        stream: true,
      }),
    },
    signal
  )

  if (!state.response.ok) {
    state.cleanup()
    throw await createHttpError(state.response)
  }
  if (!state.response.body) {
    state.cleanup()
    throw new Error("LLM 流式响应为空")
  }

  const reader = state.response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let text = ""
  let reasoning = ""
  let reportedInputTokens: number | null = null
  let outputTokens: number | null = null
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let eventName = ""
  let finished = false

  const handleEvent = (event: string, data: string): void => {
    if (!data || data === "[DONE]") return
    let payload: AnthropicStreamEvent
    try {
      payload = JSON.parse(data) as AnthropicStreamEvent
    } catch {
      return
    }
    const type = payload.type ?? event
    if (type === "error") {
      throw new ProviderRequestError(
        `LLM 返回错误：${errorTextFromPayload(payload.error)}`,
        { retryable: false }
      )
    }
    if (type === "message_start") {
      const usage = payload.message?.usage
      if (usage) {
        if (typeof usage.input_tokens === "number") {
          reportedInputTokens = usage.input_tokens
        }
        if (typeof usage.cache_read_input_tokens === "number") {
          cacheReadTokens = usage.cache_read_input_tokens
        }
        if (typeof usage.cache_creation_input_tokens === "number") {
          cacheCreationTokens = usage.cache_creation_input_tokens
        }
        if (typeof usage.output_tokens === "number") {
          outputTokens = usage.output_tokens
        }
      }
      return
    }
    if (type === "content_block_delta") {
      const delta = payload.delta
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        text += delta.text
        handlers.onText?.(delta.text)
      } else if (
        delta?.type === "thinking_delta" &&
        typeof delta.thinking === "string"
      ) {
        reasoning += delta.thinking
        handlers.onReasoning?.(delta.thinking)
      }
      return
    }
    if (type === "message_delta") {
      if (typeof payload.usage?.output_tokens === "number") {
        outputTokens = payload.usage.output_tokens
      }
      return
    }
    if (type === "message_stop") {
      finished = true
    }
  }

  try {
    while (!finished) {
      const chunk = await readStreamChunk(reader, state)
      if (chunk.done) break
      state.touch()
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          handleEvent(eventName, line.slice(5).trim())
          if (finished) break
        }
      }
    }
  } finally {
    state.cleanup()
    await reader.cancel().catch(() => undefined)
  }

  return {
    text,
    inputTokens:
      reportedInputTokens !== null
        ? reportedInputTokens + cacheReadTokens + cacheCreationTokens
        : estimateTokens(
            options.messages.map((message) => message.content).join("\n")
          ),
    outputTokens: outputTokens ?? estimateTokens(text),
    cacheTokens: cacheReadTokens,
  }
}

/**
 * 流式调用供应商：逐段回调文本与思考内容，结束后返回完整结果与用量。
 * 一旦已经向调用方输出过内容，失败时不再重试，避免前端收到重复文本。
 */
export async function callProviderStream(
  provider: LlmProvider,
  options: CallProviderOptions,
  handlers: ProviderStreamHandlers = {},
  signal?: AbortSignal
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
  let emitted = false

  const guardedHandlers: ProviderStreamHandlers = {
    onText: (delta) => {
      emitted = true
      handlers.onText?.(delta)
    },
    onReasoning: (delta) => {
      emitted = true
      handlers.onReasoning?.(delta)
    },
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      const result =
        provider.kind === "anthropic"
          ? await callAnthropicStream(
              provider,
              options,
              generation,
              estimatedInput,
              contextTokens,
              guardedHandlers,
              signal
            )
          : await callOpenAiCompatibleStream(
              provider,
              options,
              generation,
              maxOutput,
              guardedHandlers,
              signal
            )
      return { ...result, durationMs: Date.now() - startedAt }
    } catch (error) {
      const aborted = signal?.aborted === true
      const retryable =
        error instanceof ProviderRequestError ? error.retryable : !emitted
      if (aborted || attempt >= maxRetries || !retryable || emitted) {
        throw error
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }
}

export async function callProvider(
  provider: LlmProvider,
  options: CallProviderOptions,
  signal?: AbortSignal
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
              contextTokens,
              signal
            )
          : await callOpenAiCompatible(
              provider,
              options,
              generation,
              maxOutput,
              signal
            )
      return { ...result, durationMs: Date.now() - startedAt }
    } catch (error) {
      if (signal?.aborted) {
        throw new Error("请求已取消")
      }
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }
}
