import { NextResponse } from "next/server"

function jsonInit(init?: ResponseInit): ResponseInit {
  const headers = new Headers(init?.headers)
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8")
  }
  return { ...init, headers }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, jsonInit(init))
}

export function fail(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: message },
    jsonInit({ status })
  )
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class RequestBodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RequestBodyError"
  }
}

/**
 * 严格按 UTF-8 解码并解析 JSON 请求体。
 * 非法字节序列会被拒绝，而不是像 request.json() 那样静默替换为 U+FFFD，
 * 避免把客户端编码错误（例如 GBK）写进任务、数据集或提示词。
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  let buffer: ArrayBuffer
  try {
    buffer = await request.arrayBuffer()
  } catch {
    throw new RequestBodyError("无法读取请求体")
  }
  if (buffer.byteLength === 0) return null

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    throw new RequestBodyError(
      "请求体不是合法的 UTF-8 编码，请确认客户端以 UTF-8 发送 JSON"
    )
  }
  if (text.includes("\uFFFD")) {
    throw new RequestBodyError(
      "请求体包含乱码字符（U+FFFD），请检查文本编码后重试"
    )
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new RequestBodyError("请求体必须是合法的 JSON")
  }
}
