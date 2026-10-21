import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { getDataRoot, readSettings, writeSettings } from "@/lib/gepa/storage"
import type {
  BashConstraints,
  GlobalConstraints,
  ToolConstraints,
} from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type UnknownRecord = Record<string, unknown>

const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function has(record: UnknownRecord, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, key) &&
    record[key] !== undefined
  )
}

function readBoolean(
  record: UnknownRecord,
  key: string,
  label: string
): boolean | undefined {
  if (!has(record, key)) return undefined
  const value = record[key]
  if (typeof value !== "boolean") {
    throw new Error(`${label} 必须是布尔值`)
  }
  return value
}

function readInteger(
  record: UnknownRecord,
  key: string,
  label: string,
  min: number,
  max: number
): number | undefined {
  if (!has(record, key)) return undefined
  const value = record[key]
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} 必须是整数`)
  }
  if (value < min || value > max) {
    throw new Error(`${label} 必须在 ${min}-${max} 之间`)
  }
  return value
}

function readStringArray(
  record: UnknownRecord,
  key: string,
  label: string,
  options: {
    maxItems: number
    maxLength: number
    validate?: (value: string) => boolean
    invalidMessage?: string
  }
): string[] | undefined {
  if (!has(record, key)) return undefined
  const value = record[key]
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是字符串数组`)
  }
  if (value.length > options.maxItems) {
    throw new Error(`${label} 最多允许 ${options.maxItems} 项`)
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`${label} 的每一项都必须是字符串`)
    }
    const trimmed = item.trim()
    if (!trimmed) continue
    if (trimmed.length > options.maxLength) {
      throw new Error(`${label} 的单项长度不能超过 ${options.maxLength} 个字符`)
    }
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new Error(`${label} 的单项不能包含控制字符或换行`)
    }
    if (options.validate && !options.validate(trimmed)) {
      throw new Error(
        options.invalidMessage ?? `${label} 包含不合法的条目：${trimmed}`
      )
    }
    const dedupeKey = trimmed.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    result.push(trimmed)
  }
  return result
}

function isHostPattern(value: string): boolean {
  if (value === "*") return true
  if (value.length > 253) return false
  if (/\s/.test(value)) return false
  if (/[/?#@]/.test(value)) return false
  if (value.includes("*") && !value.startsWith("*.")) return false
  if (value.startsWith("*.") && value.length <= 2) return false
  return /^(\*\.)?[a-zA-Z0-9_\-.:[\]]+$/.test(value)
}

function assertKnownKeys(
  record: UnknownRecord,
  allowed: string[],
  groupLabel: string
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new Error(`${groupLabel}包含未知字段：${unknown.join("、")}`)
  }
}

function parseToolsPatch(input: UnknownRecord): Partial<ToolConstraints> {
  assertKnownKeys(
    input,
    [
      "enabled",
      "allowedTools",
      "deniedTools",
      "maxCallsPerIteration",
      "requireApprovalForWrite",
      "allowNetwork",
      "allowedHosts",
    ],
    "工具约束"
  )

  const patch: Partial<ToolConstraints> = {}
  const enabled = readBoolean(input, "enabled", "工具约束总开关")
  if (enabled !== undefined) patch.enabled = enabled

  const allowedTools = readStringArray(input, "allowedTools", "允许工具", {
    maxItems: 200,
    maxLength: 100,
    validate: (value) => TOOL_NAME_PATTERN.test(value),
    invalidMessage:
      "允许工具名称不合法：只允许字母、数字、下划线、点、冒号和连字符",
  })
  if (allowedTools !== undefined) patch.allowedTools = allowedTools

  const deniedTools = readStringArray(input, "deniedTools", "禁止工具", {
    maxItems: 200,
    maxLength: 100,
    validate: (value) => TOOL_NAME_PATTERN.test(value),
    invalidMessage:
      "禁止工具名称不合法：只允许字母、数字、下划线、点、冒号和连字符",
  })
  if (deniedTools !== undefined) patch.deniedTools = deniedTools

  const maxCalls = readInteger(
    input,
    "maxCallsPerIteration",
    "每轮最大调用数",
    1,
    1000
  )
  if (maxCalls !== undefined) patch.maxCallsPerIteration = maxCalls

  const approval = readBoolean(
    input,
    "requireApprovalForWrite",
    "写操作审批开关"
  )
  if (approval !== undefined) patch.requireApprovalForWrite = approval

  const allowNetwork = readBoolean(input, "allowNetwork", "允许网络开关")
  if (allowNetwork !== undefined) patch.allowNetwork = allowNetwork

  const allowedHosts = readStringArray(input, "allowedHosts", "Host 白名单", {
    maxItems: 200,
    maxLength: 253,
    validate: isHostPattern,
    invalidMessage:
      "Host 白名单条目必须是不含协议与路径的主机名，支持 *.example.com 通配",
  })
  if (allowedHosts !== undefined) patch.allowedHosts = allowedHosts

  return patch
}

function parseBashPatch(input: UnknownRecord): Partial<BashConstraints> {
  assertKnownKeys(
    input,
    [
      "enabled",
      "allowedCommands",
      "deniedCommands",
      "allowShellOperators",
      "timeoutMs",
      "maxOutputBytes",
      "workingDirOnly",
    ],
    "Bash 约束"
  )

  const patch: Partial<BashConstraints> = {}
  const enabled = readBoolean(input, "enabled", "Bash 约束总开关")
  if (enabled !== undefined) patch.enabled = enabled

  const allowedCommands = readStringArray(
    input,
    "allowedCommands",
    "允许命令",
    { maxItems: 200, maxLength: 200 }
  )
  if (allowedCommands !== undefined) patch.allowedCommands = allowedCommands

  const deniedCommands = readStringArray(input, "deniedCommands", "禁止命令", {
    maxItems: 200,
    maxLength: 200,
  })
  if (deniedCommands !== undefined) patch.deniedCommands = deniedCommands

  const shellOperators = readBoolean(
    input,
    "allowShellOperators",
    "允许 shell 操作符开关"
  )
  if (shellOperators !== undefined) patch.allowShellOperators = shellOperators

  const timeoutMs = readInteger(input, "timeoutMs", "超时时间", 1000, 600000)
  if (timeoutMs !== undefined) patch.timeoutMs = timeoutMs

  const maxOutputBytes = readInteger(
    input,
    "maxOutputBytes",
    "输出上限",
    1024,
    10 * 1024 * 1024
  )
  if (maxOutputBytes !== undefined) patch.maxOutputBytes = maxOutputBytes

  const workingDirOnly = readBoolean(input, "workingDirOnly", "仅工作目录开关")
  if (workingDirOnly !== undefined) patch.workingDirOnly = workingDirOnly

  return patch
}

interface ConstraintsPatch {
  tools?: Partial<ToolConstraints>
  bash?: Partial<BashConstraints>
}

function parseConstraintsPatch(body: UnknownRecord): ConstraintsPatch {
  assertKnownKeys(body, ["tools", "bash"], "约束")

  const patch: ConstraintsPatch = {}
  if (has(body, "tools")) {
    if (!isRecord(body.tools)) {
      throw new Error("tools 必须是对象")
    }
    patch.tools = parseToolsPatch(body.tools)
  }
  if (has(body, "bash")) {
    if (!isRecord(body.bash)) {
      throw new Error("bash 必须是对象")
    }
    patch.bash = parseBashPatch(body.bash)
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("没有可更新的约束字段")
  }
  return patch
}

export async function GET() {
  try {
    const settings = await readSettings()
    return ok({ constraints: settings.constraints, dataRoot: getDataRoot() })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function PATCH(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail("请求体必须是合法的 JSON")
  }
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }

  let patch: ConstraintsPatch
  try {
    patch = parseConstraintsPatch(body)
  } catch (error) {
    return fail(errorMessage(error), 400)
  }

  try {
    // writeSettings 会在锁内深合并，因此允许传入部分字段
    const settings = await writeSettings({
      constraints: patch as unknown as GlobalConstraints,
    })
    return ok({ constraints: settings.constraints })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
