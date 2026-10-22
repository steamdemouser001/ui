export class GepaApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "GepaApiError"
    this.status = status
  }
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new GepaApiError(`网络请求失败：${reason}`, 0)
  }

  let payload: ApiEnvelope<T> | null = null
  try {
    payload = (await response.json()) as ApiEnvelope<T>
  } catch {
    payload = null
  }

  if (!response.ok || !payload?.ok) {
    throw new GepaApiError(
      payload?.error ?? `请求失败（HTTP ${response.status}）`,
      response.status
    )
  }
  return payload.data as T
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>("GET", url)
}

export function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return request<T>("POST", url, body)
}

export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", url, body)
}

export function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  return request<T>("DELETE", url, body)
}

export interface SseEvent {
  event: string
  data: unknown
}

function parseSseBlock(block: string): SseEvent | null {
  let event = "message"
  const dataLines: string[] = []

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue
    if (line.startsWith("event:")) {
      event = line.slice(6).trim()
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""))
    }
  }

  if (dataLines.length === 0) return null
  const raw = dataLines.join("\n")
  let data: unknown = raw
  try {
    data = JSON.parse(raw)
  } catch {
    // 保留原始文本
  }
  return { event, data }
}

/** 以 SSE 方式调用接口，按事件回调；支持 AbortSignal 取消。 */
export async function apiStream(
  url: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new GepaApiError(`网络请求失败：${reason}`, 0)
  }

  if (!response.ok) {
    let payload: ApiEnvelope<unknown> | null = null
    try {
      payload = (await response.json()) as ApiEnvelope<unknown>
    } catch {
      payload = null
    }
    throw new GepaApiError(
      payload?.error ?? `请求失败（HTTP ${response.status}）`,
      response.status
    )
  }

  if (!response.body) {
    throw new GepaApiError("流式响应为空", response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  const flush = (block: string) => {
    const parsed = parseSseBlock(block)
    if (parsed) onEvent(parsed)
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let match = /\r?\n\r?\n/.exec(buffer)
      while (match) {
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        flush(block)
        match = /\r?\n\r?\n/.exec(buffer)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) flush(buffer)
  } finally {
    reader.releaseLock()
  }
}
