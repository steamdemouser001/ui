import type { DatasetExample } from "@/lib/gepa/types"

/**
 * 客户端数据集解析：与服务端 `parseDatasetText` 语义保持一致，
 * 用于「批量导入」预览，最终仍由服务端校验。
 */
export const MAX_DATASET_EXAMPLES = 500

export interface ParsedExample {
  input: string
  expected?: string
  metadata?: Record<string, unknown>
}

function parseValue(value: unknown, index: number): ParsedExample {
  if (typeof value === "string") {
    const input = value.trim()
    if (!input) {
      throw new Error(`第 ${index + 1} 条示例的输入不能为空`)
    }
    return { input }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `第 ${index + 1} 条示例格式不正确：应为文本或包含 input 字段的对象`
    )
  }
  const record = value as Record<string, unknown>
  const input = typeof record.input === "string" ? record.input.trim() : ""
  if (!input) {
    throw new Error(`第 ${index + 1} 条示例缺少 input 字段或内容为空`)
  }
  const example: ParsedExample = { input }
  if (typeof record.expected === "string" && record.expected.trim()) {
    example.expected = record.expected.trim()
  }
  if (
    record.metadata &&
    typeof record.metadata === "object" &&
    !Array.isArray(record.metadata)
  ) {
    example.metadata = record.metadata as Record<string, unknown>
  }
  return example
}

export function parseDatasetText(text: string): ParsedExample[] {
  const raw = text.trim()
  if (!raw) return []

  let values: unknown[]
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) throw new Error("not an array")
      values = parsed
    } catch {
      throw new Error("数据集不是合法的 JSON 数组，请检查括号与引号")
    }
  } else {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return []

    if (lines[0].startsWith("{")) {
      values = lines.map((line, index) => {
        try {
          const parsed = JSON.parse(line) as unknown
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("not an object")
          }
          return parsed
        } catch {
          throw new Error(`第 ${index + 1} 行不是合法的 JSON 对象`)
        }
      })
    } else {
      values = lines
    }
  }

  if (values.length > MAX_DATASET_EXAMPLES) {
    throw new Error(
      `数据集最多支持 ${MAX_DATASET_EXAMPLES} 条示例（当前 ${values.length} 条）`
    )
  }
  return values.map((value, index) => parseValue(value, index))
}

/** 生成下一个不冲突的示例 id。 */
export function nextExampleId(examples: DatasetExample[]): string {
  const used = new Set(examples.map((example) => example.id))
  for (let index = 1; index <= MAX_DATASET_EXAMPLES + 1; index += 1) {
    const id = `example-${index}`
    if (!used.has(id)) return id
  }
  return `example-${Date.now()}`
}

/** 将解析结果追加到现有示例，自动分配唯一 id。 */
export function appendParsedExamples(
  current: DatasetExample[],
  parsed: ParsedExample[]
): DatasetExample[] {
  const next = [...current]
  for (const item of parsed) {
    const example: DatasetExample = {
      id: nextExampleId(next),
      input: item.input,
    }
    if (item.expected !== undefined) example.expected = item.expected
    if (item.metadata !== undefined) example.metadata = item.metadata
    next.push(example)
  }
  return next
}
