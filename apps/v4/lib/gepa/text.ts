const REPLACEMENT_CHAR = "\uFFFD"

/** 递归查找字符串中的 U+FFFD（编码损坏后的替换字符），返回所在路径。 */
export function findReplacementChar(
  value: unknown,
  path = "root"
): string | null {
  if (typeof value === "string") {
    return value.includes(REPLACEMENT_CHAR) ? path : null
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findReplacementChar(value[index], `${path}[${index}]`)
      if (found) return found
    }
    return null
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      const found = findReplacementChar(entry, `${path}.${key}`)
      if (found) return found
    }
  }
  return null
}

/**
 * 拒绝包含 U+FFFD 的文本。这类字符几乎总是客户端编码错误
 * （例如把 GBK 当成 UTF-8 发送）留下的痕迹，写入后会永久污染数据。
 */
export function assertCleanText(value: unknown, label: string): void {
  const path = findReplacementChar(value)
  if (!path) return
  throw new Error(
    `${label}包含乱码字符（U+FFFD，位置：${path}）。请确认文本以 UTF-8 编码提交。`
  )
}
