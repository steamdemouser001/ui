import { parseJsonLoose, runAgentStream } from "./llm"
import type { AgentId } from "./types"

function parsePartialString(raw: string, start: number): string {
  let out = ""
  let index = start

  while (index < raw.length) {
    const char = raw[index]
    if (char === '"') break
    if (char !== "\\") {
      out += char
      index += 1
      continue
    }

    const next = raw[index + 1]
    if (next === undefined) break
    switch (next) {
      case '"':
        out += '"'
        index += 2
        break
      case "\\":
        out += "\\"
        index += 2
        break
      case "/":
        out += "/"
        index += 2
        break
      case "b":
        out += "\b"
        index += 2
        break
      case "f":
        out += "\f"
        index += 2
        break
      case "n":
        out += "\n"
        index += 2
        break
      case "r":
        out += "\r"
        index += 2
        break
      case "t":
        out += "\t"
        index += 2
        break
      case "u": {
        const hex = raw.slice(index + 2, index + 6)
        if (hex.length < 4) return out
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          index += 6
        } else {
          index += 2
        }
        break
      }
      default:
        out += next
        index += 2
    }
  }

  return out
}

/**
 * 从可能尚未结束的 JSON 文本中提取顶层字符串字段的值。
 * 用于把 LLM 的 `{"reply":"..."}` 流式转换为可逐字显示的回复。
 */
export function extractJsonStringField(raw: string, field: string): string {
  let depth = 0
  let inString = false
  let escape = false
  let stringStart = -1
  let stringDepth = -1

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]

    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (char === "\\") {
        escape = true
        continue
      }
      if (char !== '"') continue

      inString = false
      if (stringDepth !== 1) continue

      const content = raw.slice(stringStart + 1, index)
      let cursor = index + 1
      while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1
      if (raw[cursor] !== ":") continue

      let key = content
      try {
        key = JSON.parse(`"${content}"`) as string
      } catch {
        // 保留原始内容作为 key
      }
      if (key !== field) continue

      cursor += 1
      while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1
      if (raw[cursor] !== '"') return ""
      return parsePartialString(raw, cursor + 1)
    }

    if (char === '"') {
      inString = true
      stringStart = index
      stringDepth = depth
      continue
    }
    if (char === "{" || char === "[") depth += 1
    else if (char === "}" || char === "]") depth -= 1
  }

  return ""
}

export interface JsonStreamHandlers {
  onReplyDelta?: (delta: string) => void
  onReasoning?: (delta: string) => void
}

/**
 * 流式运行返回 JSON 的 Agent：把 `reply` 字段逐字推给前端，
 * 结束后再解析完整 JSON 供调用方执行 actions。
 */
export async function runAgentJsonStream<T>(
  agentId: AgentId,
  variables: Record<string, string>,
  handlers: JsonStreamHandlers = {},
  meta?: { taskId?: string; runId?: string },
  signal?: AbortSignal
): Promise<{ data: T | null; raw: string }> {
  let raw = ""
  let emitted = 0

  const result = await runAgentStream(
    agentId,
    variables,
    {
      onText: (delta) => {
        raw += delta
        const partial = extractJsonStringField(raw, "reply")
        if (partial.length > emitted) {
          handlers.onReplyDelta?.(partial.slice(emitted))
          emitted = partial.length
        }
      },
      onReasoning: handlers.onReasoning,
    },
    meta,
    signal
  )

  raw = result.text || raw
  let data: T | null = null
  try {
    data = parseJsonLoose<T>(raw)
  } catch {
    data = null
  }
  return { data, raw }
}
