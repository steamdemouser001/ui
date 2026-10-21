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
