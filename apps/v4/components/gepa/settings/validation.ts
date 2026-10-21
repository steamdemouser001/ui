import type {
  BashConstraints,
  IterationDefaults,
  MonitorConfig,
  ToolConstraints,
} from "@/lib/gepa/types"

import type { IterationDraft, MonitorDraft } from "./types"

export interface NumberSpec {
  min: number
  max: number
  integer: boolean
  label: string
}

export const NUMBER_SPECS = {
  budget: { min: 1, max: 100000, integer: true, label: "预算" },
  minibatchSize: { min: 1, max: 50, integer: true, label: "Minibatch 大小" },
  paretoSize: { min: 1, max: 500, integer: true, label: "帕累托集大小" },
  maxIterations: { min: 1, max: 1000, integer: true, label: "最大迭代轮数" },
  inputCostPerMillion: {
    min: 0,
    max: 100000,
    integer: false,
    label: "输入单价",
  },
  outputCostPerMillion: {
    min: 0,
    max: 100000,
    integer: false,
    label: "输出单价",
  },
  cacheCostPerMillion: {
    min: 0,
    max: 100000,
    integer: false,
    label: "缓存单价",
  },
  retentionDays: { min: 1, max: 3650, integer: true, label: "指标保留天数" },
} satisfies Record<string, NumberSpec>

export type NumberFieldKey = keyof typeof NUMBER_SPECS

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; errors: Record<string, string> }

export type NumberParseResult =
  | { ok: true; value: number }
  | { ok: false; message: string }

export function parseNumberField(
  raw: string,
  key: NumberFieldKey
): NumberParseResult {
  const spec = NUMBER_SPECS[key]
  const text = raw.trim()
  if (!text) {
    return { ok: false, message: `请填写${spec.label}` }
  }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    return { ok: false, message: `${spec.label}必须是数字` }
  }
  if (spec.integer && !Number.isInteger(value)) {
    return { ok: false, message: `${spec.label}必须是整数` }
  }
  if (value < spec.min || value > spec.max) {
    return {
      ok: false,
      message: `${spec.label}必须在 ${spec.min}-${spec.max} 之间`,
    }
  }
  return { ok: true, value }
}

function readDraftNumber(
  raw: string,
  key: NumberFieldKey,
  errors: Record<string, string>
): number {
  const result = parseNumberField(raw, key)
  if (result.ok) return result.value
  errors[key] = result.message
  return 0
}

export function parseIterationDraft(
  draft: IterationDraft
): ParseResult<IterationDefaults> {
  const errors: Record<string, string> = {}
  const value: IterationDefaults = {
    budget: readDraftNumber(draft.budget, "budget", errors),
    minibatchSize: readDraftNumber(
      draft.minibatchSize,
      "minibatchSize",
      errors
    ),
    paretoSize: readDraftNumber(draft.paretoSize, "paretoSize", errors),
    maxIterations: readDraftNumber(
      draft.maxIterations,
      "maxIterations",
      errors
    ),
    moduleSelection: draft.moduleSelection,
    mergeEnabled: draft.mergeEnabled,
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "请修正标红的迭代参数", errors }
  }
  return { ok: true, value }
}

export function parseMonitorDraft(
  draft: MonitorDraft
): ParseResult<MonitorConfig> {
  const errors: Record<string, string> = {}
  const value: MonitorConfig = {
    inputCostPerMillion: readDraftNumber(
      draft.inputCostPerMillion,
      "inputCostPerMillion",
      errors
    ),
    outputCostPerMillion: readDraftNumber(
      draft.outputCostPerMillion,
      "outputCostPerMillion",
      errors
    ),
    cacheCostPerMillion: readDraftNumber(
      draft.cacheCostPerMillion,
      "cacheCostPerMillion",
      errors
    ),
    retentionDays: readDraftNumber(
      draft.retentionDays,
      "retentionDays",
      errors
    ),
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "请修正标红的监控与成本字段", errors }
  }
  return { ok: true, value }
}

/* -------------------------------------------------------------------------- */
/* 配置导入校验                                                                */
/* -------------------------------------------------------------------------- */

export interface SettingsImportPatch {
  iteration?: Partial<IterationDefaults>
  monitor?: Partial<MonitorConfig>
  constraints?: {
    tools?: Partial<ToolConstraints>
    bash?: Partial<BashConstraints>
  }
}

const ITERATION_KEYS = [
  "budget",
  "minibatchSize",
  "paretoSize",
  "maxIterations",
  "moduleSelection",
  "mergeEnabled",
] as const

const MONITOR_KEYS = [
  "inputCostPerMillion",
  "outputCostPerMillion",
  "cacheCostPerMillion",
  "retentionDays",
] as const

const TOOL_KEYS = [
  "enabled",
  "allowedTools",
  "deniedTools",
  "maxCallsPerIteration",
  "requireApprovalForWrite",
  "allowNetwork",
  "allowedHosts",
] as const

const BASH_KEYS = [
  "enabled",
  "allowedCommands",
  "deniedCommands",
  "allowShellOperators",
  "timeoutMs",
  "maxOutputBytes",
  "workingDirOnly",
] as const

const MAX_STRING_ITEMS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function has(record: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, key) &&
    record[key] !== undefined
  )
}

function findUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[]
): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key))
}

function readImportNumber(
  record: Record<string, unknown>,
  key: string,
  spec: NumberSpec,
  prefix: string,
  errors: Record<string, string>
): number | undefined {
  if (!has(record, key)) return undefined
  const raw = record[key]
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    errors[`${prefix}.${key}`] = `${spec.label}必须是数字`
    return undefined
  }
  if (spec.integer && !Number.isInteger(raw)) {
    errors[`${prefix}.${key}`] = `${spec.label}必须是整数`
    return undefined
  }
  if (raw < spec.min || raw > spec.max) {
    errors[`${prefix}.${key}`] =
      `${spec.label}必须在 ${spec.min}-${spec.max} 之间`
    return undefined
  }
  return raw
}

function readImportBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string,
  prefix: string,
  errors: Record<string, string>
): boolean | undefined {
  if (!has(record, key)) return undefined
  const raw = record[key]
  if (typeof raw !== "boolean") {
    errors[`${prefix}.${key}`] = `${label}必须是布尔值`
    return undefined
  }
  return raw
}

function readImportStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
  prefix: string,
  errors: Record<string, string>
): string[] | undefined {
  if (!has(record, key)) return undefined
  const raw = record[key]
  if (!Array.isArray(raw)) {
    errors[`${prefix}.${key}`] = `${label}必须是字符串数组`
    return undefined
  }
  if (raw.length > MAX_STRING_ITEMS) {
    errors[`${prefix}.${key}`] = `${label}最多允许 ${MAX_STRING_ITEMS} 项`
    return undefined
  }
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") {
      errors[`${prefix}.${key}`] = `${label}的每一项都必须是字符串`
      return undefined
    }
    const trimmed = item.trim()
    if (trimmed) result.push(trimmed)
  }
  return result
}

function parseIterationImport(
  record: Record<string, unknown>,
  errors: Record<string, string>
): Partial<IterationDefaults> {
  const unknown = findUnknownKeys(record, ITERATION_KEYS)
  if (unknown.length > 0) {
    errors.iteration = `iteration 包含未知字段：${unknown.join("、")}`
  }
  const result: Partial<IterationDefaults> = {}

  const budget = readImportNumber(
    record,
    "budget",
    NUMBER_SPECS.budget,
    "iteration",
    errors
  )
  if (budget !== undefined) result.budget = budget

  const minibatchSize = readImportNumber(
    record,
    "minibatchSize",
    NUMBER_SPECS.minibatchSize,
    "iteration",
    errors
  )
  if (minibatchSize !== undefined) result.minibatchSize = minibatchSize

  const paretoSize = readImportNumber(
    record,
    "paretoSize",
    NUMBER_SPECS.paretoSize,
    "iteration",
    errors
  )
  if (paretoSize !== undefined) result.paretoSize = paretoSize

  const maxIterations = readImportNumber(
    record,
    "maxIterations",
    NUMBER_SPECS.maxIterations,
    "iteration",
    errors
  )
  if (maxIterations !== undefined) result.maxIterations = maxIterations

  if (has(record, "moduleSelection")) {
    const value = record.moduleSelection
    if (value === "round-robin" || value === "random") {
      result.moduleSelection = value
    } else {
      errors["iteration.moduleSelection"] =
        "模块选择策略只能是 round-robin 或 random"
    }
  }

  const mergeEnabled = readImportBoolean(
    record,
    "mergeEnabled",
    "Merge 开关",
    "iteration",
    errors
  )
  if (mergeEnabled !== undefined) result.mergeEnabled = mergeEnabled

  return result
}

function parseMonitorImport(
  record: Record<string, unknown>,
  errors: Record<string, string>
): Partial<MonitorConfig> {
  const unknown = findUnknownKeys(record, MONITOR_KEYS)
  if (unknown.length > 0) {
    errors.monitor = `monitor 包含未知字段：${unknown.join("、")}`
  }
  const result: Partial<MonitorConfig> = {}

  const inputCost = readImportNumber(
    record,
    "inputCostPerMillion",
    NUMBER_SPECS.inputCostPerMillion,
    "monitor",
    errors
  )
  if (inputCost !== undefined) result.inputCostPerMillion = inputCost

  const outputCost = readImportNumber(
    record,
    "outputCostPerMillion",
    NUMBER_SPECS.outputCostPerMillion,
    "monitor",
    errors
  )
  if (outputCost !== undefined) result.outputCostPerMillion = outputCost

  const cacheCost = readImportNumber(
    record,
    "cacheCostPerMillion",
    NUMBER_SPECS.cacheCostPerMillion,
    "monitor",
    errors
  )
  if (cacheCost !== undefined) result.cacheCostPerMillion = cacheCost

  const retentionDays = readImportNumber(
    record,
    "retentionDays",
    NUMBER_SPECS.retentionDays,
    "monitor",
    errors
  )
  if (retentionDays !== undefined) result.retentionDays = retentionDays

  return result
}

const MAX_CALLS_SPEC: NumberSpec = {
  min: 1,
  max: 1000,
  integer: true,
  label: "每轮最大调用数",
}

const TIMEOUT_SPEC: NumberSpec = {
  min: 1000,
  max: 600000,
  integer: true,
  label: "超时时间",
}

const MAX_OUTPUT_SPEC: NumberSpec = {
  min: 1024,
  max: 10 * 1024 * 1024,
  integer: true,
  label: "输出上限",
}

function parseConstraintsImport(
  record: Record<string, unknown>,
  errors: Record<string, string>
): {
  tools?: Partial<ToolConstraints>
  bash?: Partial<BashConstraints>
} {
  const unknown = findUnknownKeys(record, ["tools", "bash"])
  if (unknown.length > 0) {
    errors.constraints = `constraints 包含未知字段：${unknown.join("、")}`
  }
  const result: {
    tools?: Partial<ToolConstraints>
    bash?: Partial<BashConstraints>
  } = {}

  if (has(record, "tools")) {
    if (!isRecord(record.tools)) {
      errors["constraints.tools"] = "tools 必须是对象"
    } else {
      result.tools = parseToolImport(record.tools, errors)
    }
  }

  if (has(record, "bash")) {
    if (!isRecord(record.bash)) {
      errors["constraints.bash"] = "bash 必须是对象"
    } else {
      result.bash = parseBashImport(record.bash, errors)
    }
  }

  return result
}

function parseToolImport(
  record: Record<string, unknown>,
  errors: Record<string, string>
): Partial<ToolConstraints> {
  const unknown = findUnknownKeys(record, TOOL_KEYS)
  if (unknown.length > 0) {
    errors["constraints.tools"] = `tools 包含未知字段：${unknown.join("、")}`
  }
  const result: Partial<ToolConstraints> = {}

  const enabled = readImportBoolean(
    record,
    "enabled",
    "工具约束总开关",
    "constraints.tools",
    errors
  )
  if (enabled !== undefined) result.enabled = enabled

  const allowedTools = readImportStringArray(
    record,
    "allowedTools",
    "允许工具",
    "constraints.tools",
    errors
  )
  if (allowedTools !== undefined) result.allowedTools = allowedTools

  const deniedTools = readImportStringArray(
    record,
    "deniedTools",
    "禁止工具",
    "constraints.tools",
    errors
  )
  if (deniedTools !== undefined) result.deniedTools = deniedTools

  const maxCalls = readImportNumber(
    record,
    "maxCallsPerIteration",
    MAX_CALLS_SPEC,
    "constraints.tools",
    errors
  )
  if (maxCalls !== undefined) result.maxCallsPerIteration = maxCalls

  const approval = readImportBoolean(
    record,
    "requireApprovalForWrite",
    "写操作审批开关",
    "constraints.tools",
    errors
  )
  if (approval !== undefined) result.requireApprovalForWrite = approval

  const allowNetwork = readImportBoolean(
    record,
    "allowNetwork",
    "允许网络开关",
    "constraints.tools",
    errors
  )
  if (allowNetwork !== undefined) result.allowNetwork = allowNetwork

  const allowedHosts = readImportStringArray(
    record,
    "allowedHosts",
    "Host 白名单",
    "constraints.tools",
    errors
  )
  if (allowedHosts !== undefined) result.allowedHosts = allowedHosts

  return result
}

function parseBashImport(
  record: Record<string, unknown>,
  errors: Record<string, string>
): Partial<BashConstraints> {
  const unknown = findUnknownKeys(record, BASH_KEYS)
  if (unknown.length > 0) {
    errors["constraints.bash"] = `bash 包含未知字段：${unknown.join("、")}`
  }
  const result: Partial<BashConstraints> = {}

  const enabled = readImportBoolean(
    record,
    "enabled",
    "Bash 约束总开关",
    "constraints.bash",
    errors
  )
  if (enabled !== undefined) result.enabled = enabled

  const allowedCommands = readImportStringArray(
    record,
    "allowedCommands",
    "允许命令",
    "constraints.bash",
    errors
  )
  if (allowedCommands !== undefined) result.allowedCommands = allowedCommands

  const deniedCommands = readImportStringArray(
    record,
    "deniedCommands",
    "禁止命令",
    "constraints.bash",
    errors
  )
  if (deniedCommands !== undefined) result.deniedCommands = deniedCommands

  const shellOperators = readImportBoolean(
    record,
    "allowShellOperators",
    "允许 shell 操作符开关",
    "constraints.bash",
    errors
  )
  if (shellOperators !== undefined) result.allowShellOperators = shellOperators

  const timeoutMs = readImportNumber(
    record,
    "timeoutMs",
    TIMEOUT_SPEC,
    "constraints.bash",
    errors
  )
  if (timeoutMs !== undefined) result.timeoutMs = timeoutMs

  const maxOutputBytes = readImportNumber(
    record,
    "maxOutputBytes",
    MAX_OUTPUT_SPEC,
    "constraints.bash",
    errors
  )
  if (maxOutputBytes !== undefined) result.maxOutputBytes = maxOutputBytes

  const workingDirOnly = readImportBoolean(
    record,
    "workingDirOnly",
    "仅工作目录开关",
    "constraints.bash",
    errors
  )
  if (workingDirOnly !== undefined) result.workingDirOnly = workingDirOnly

  return result
}

export function parseSettingsImport(
  input: unknown
): ParseResult<SettingsImportPatch> {
  if (!isRecord(input)) {
    return { ok: false, message: "配置文件必须是 JSON 对象", errors: {} }
  }

  // 兼容完整导出文件（settings 字段）与直接导出的 settings 对象。
  const source = isRecord(input.settings) ? input.settings : input
  const patch: SettingsImportPatch = {}
  const errors: Record<string, string> = {}

  if (has(source, "iteration")) {
    if (!isRecord(source.iteration)) {
      errors.iteration = "iteration 必须是对象"
    } else {
      patch.iteration = parseIterationImport(source.iteration, errors)
    }
  }

  if (has(source, "monitor")) {
    if (!isRecord(source.monitor)) {
      errors.monitor = "monitor 必须是对象"
    } else {
      patch.monitor = parseMonitorImport(source.monitor, errors)
    }
  }

  if (has(source, "constraints")) {
    if (!isRecord(source.constraints)) {
      errors.constraints = "constraints 必须是对象"
    } else {
      patch.constraints = parseConstraintsImport(source.constraints, errors)
    }
  }

  if (Object.keys(patch).length === 0 && Object.keys(errors).length === 0) {
    return {
      ok: false,
      message: "未找到可导入的字段（iteration / monitor / constraints）",
      errors,
    }
  }

  const errorValues = Object.values(errors)
  if (errorValues.length > 0) {
    return {
      ok: false,
      message: `配置校验失败：${errorValues[0]}`,
      errors,
    }
  }

  return { ok: true, value: patch }
}
