import type { GlobalConstraints } from "@/lib/gepa/types"

export interface ToolOption {
  value: string
  label: string
}

export const TOOL_OPTIONS: ToolOption[] = [
  { value: "read_file", label: "读取文件" },
  { value: "write_file", label: "写入文件" },
  { value: "list_dir", label: "列出目录" },
  { value: "search", label: "搜索" },
  { value: "bash", label: "执行命令" },
  { value: "http_fetch", label: "HTTP 请求" },
  { value: "network", label: "网络访问" },
  { value: "delete", label: "删除" },
]

export const LIMITS = {
  maxCalls: { min: 1, max: 1000 },
  timeoutMs: { min: 1000, max: 600_000 },
  maxOutputBytes: { min: 1024, max: 10 * 1024 * 1024 },
} as const

export interface ConstraintsForm {
  toolsEnabled: boolean
  allowedTools: string[]
  deniedTools: string[]
  maxCallsPerIteration: string
  requireApprovalForWrite: boolean
  allowNetwork: boolean
  allowedHostsText: string
  bashEnabled: boolean
  allowedCommandsText: string
  deniedCommandsText: string
  allowShellOperators: boolean
  timeoutMs: string
  maxOutputBytes: string
  workingDirOnly: boolean
}

export function splitLines(value: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

export function toForm(constraints: GlobalConstraints): ConstraintsForm {
  return {
    toolsEnabled: constraints.tools.enabled,
    allowedTools: [...constraints.tools.allowedTools],
    deniedTools: [...constraints.tools.deniedTools],
    maxCallsPerIteration: String(constraints.tools.maxCallsPerIteration),
    requireApprovalForWrite: constraints.tools.requireApprovalForWrite,
    allowNetwork: constraints.tools.allowNetwork,
    allowedHostsText: constraints.tools.allowedHosts.join("\n"),
    bashEnabled: constraints.bash.enabled,
    allowedCommandsText: constraints.bash.allowedCommands.join("\n"),
    deniedCommandsText: constraints.bash.deniedCommands.join("\n"),
    allowShellOperators: constraints.bash.allowShellOperators,
    timeoutMs: String(constraints.bash.timeoutMs),
    maxOutputBytes: String(constraints.bash.maxOutputBytes),
    workingDirOnly: constraints.bash.workingDirOnly,
  }
}

function parseIntegerField(
  value: string,
  label: string,
  min: number,
  max: number
): number {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label}必须是整数`)
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须在 ${min}-${max} 之间`)
  }
  return parsed
}

export function buildConstraints(form: ConstraintsForm): GlobalConstraints {
  return {
    tools: {
      enabled: form.toolsEnabled,
      allowedTools: [...new Set(form.allowedTools)],
      deniedTools: [...new Set(form.deniedTools)],
      maxCallsPerIteration: parseIntegerField(
        form.maxCallsPerIteration,
        "每轮最大调用数",
        LIMITS.maxCalls.min,
        LIMITS.maxCalls.max
      ),
      requireApprovalForWrite: form.requireApprovalForWrite,
      allowNetwork: form.allowNetwork,
      allowedHosts: splitLines(form.allowedHostsText),
    },
    bash: {
      enabled: form.bashEnabled,
      allowedCommands: splitLines(form.allowedCommandsText),
      deniedCommands: splitLines(form.deniedCommandsText),
      allowShellOperators: form.allowShellOperators,
      timeoutMs: parseIntegerField(
        form.timeoutMs,
        "超时时间",
        LIMITS.timeoutMs.min,
        LIMITS.timeoutMs.max
      ),
      maxOutputBytes: parseIntegerField(
        form.maxOutputBytes,
        "输出上限",
        LIMITS.maxOutputBytes.min,
        LIMITS.maxOutputBytes.max
      ),
      workingDirOnly: form.workingDirOnly,
    },
  }
}
