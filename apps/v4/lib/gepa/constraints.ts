import type { GlobalConstraints } from "./types"

export interface PolicyResult {
  allowed: boolean
  reason: string
  normalized?: string
}

export const MAX_COMMAND_LENGTH = 4000

export const KNOWN_TOOLS = [
  "read_file",
  "write_file",
  "list_dir",
  "search",
  "bash",
  "http_fetch",
  "network",
  "delete",
] as const

const NETWORK_TOOLS = new Set([
  "http_fetch",
  "network",
  "web_fetch",
  "http_request",
  "fetch",
  "browser",
])

const WRITE_TOOLS = new Set([
  "write_file",
  "delete",
  "edit_file",
  "move_file",
  "rename_file",
  "mkdir",
  "remove_file",
  "rm",
])

const EXECUTABLE_EXTENSION = /\.(exe|cmd|bat|com)$/i
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const HOME_ESCAPE = /\$HOME\b|\$\{HOME\}|%USERPROFILE%|%APPDATA%|%TEMP%|%TMP%/i

const COMMAND_SEPARATORS = new Set([
  ";",
  "&",
  "|",
  ">",
  "<",
  "(",
  ")",
  "`",
  "\n",
  "\r",
])

export function normalizeToolName(tool: string): string {
  return tool.trim().toLowerCase()
}

export function isNetworkTool(tool: string): boolean {
  return NETWORK_TOOLS.has(normalizeToolName(tool))
}

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.has(normalizeToolName(tool))
}

export function getToolCallLimit(constraints: GlobalConstraints): number {
  return constraints.tools.maxCallsPerIteration
}

function deny(reason: string, normalized?: string): PolicyResult {
  return { allowed: false, reason, normalized }
}

function formatList(values: string[], limit = 12): string {
  const cleaned = values.map((value) => value.trim()).filter(Boolean)
  if (cleaned.length === 0) return "无"
  if (cleaned.length <= limit) return cleaned.join("、")
  return `${cleaned.slice(0, limit).join("、")} 等 ${cleaned.length} 项`
}

export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase()
  if (!host) return ""
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
  const slash = host.indexOf("/")
  if (slash >= 0) host = host.slice(0, slash)
  if (host.startsWith("[")) {
    const end = host.indexOf("]")
    if (end >= 0) host = host.slice(1, end)
  } else {
    const colon = host.indexOf(":")
    if (colon >= 0 && colon === host.lastIndexOf(":")) {
      host = host.slice(0, colon)
    }
  }
  return host.replace(/\.$/, "")
}

export function hostMatches(pattern: string, host: string): boolean {
  const normalizedPattern = normalizeHost(pattern)
  const normalizedHost = normalizeHost(host)
  if (!normalizedPattern || !normalizedHost) return false
  if (normalizedPattern === "*") return true
  if (normalizedPattern === normalizedHost) return true
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1)
    return (
      normalizedHost.length > suffix.length && normalizedHost.endsWith(suffix)
    )
  }
  return false
}

interface ScannedToken {
  value: string
  separator: boolean
}

function scanCommand(command: string): ScannedToken[] {
  const tokens: ScannedToken[] = []
  let current = ""
  let hasValue = false
  let quote: '"' | "'" | null = null

  const pushValue = () => {
    if (!hasValue) return
    tokens.push({ value: current, separator: false })
    current = ""
    hasValue = false
  }
  const pushSeparator = (value: string) => {
    pushValue()
    tokens.push({ value, separator: true })
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote === "'") {
      if (char === "'") {
        quote = null
      } else {
        current += char
        hasValue = true
      }
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null
        continue
      }
      if (
        char === "\\" &&
        (command[index + 1] === '"' || command[index + 1] === "\\")
      ) {
        current += command[index + 1]
        hasValue = true
        index += 1
        continue
      }
      current += char
      hasValue = true
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      hasValue = true
      continue
    }
    if (/\s/.test(char)) {
      pushValue()
      continue
    }
    if (COMMAND_SEPARATORS.has(char)) {
      pushSeparator(char)
      continue
    }
    current += char
    hasValue = true
  }

  pushValue()
  return tokens
}

export function tokenizeCommand(command: string): string[] {
  return scanCommand(command)
    .filter((token) => !token.separator)
    .map((token) => token.value)
}

const COMMAND_SEPARATOR_VALUES = new Set([
  ";",
  "&",
  "|",
  "&&",
  "||",
  "(",
  ")",
  "`",
  "\n",
  "\r",
])

function commandSegments(command: string): string[][] {
  const segments: string[][] = []
  let current: string[] = []
  for (const token of scanCommand(command)) {
    if (token.separator) {
      if (COMMAND_SEPARATOR_VALUES.has(token.value)) {
        if (current.length > 0) segments.push(current)
        current = []
      }
      continue
    }
    current.push(token.value)
  }
  if (current.length > 0) segments.push(current)
  return segments
}

export function findShellOperator(command: string): string | null {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote === "'") {
      if (char === "'") quote = null
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null
        continue
      }
      if (char === "`") return "`"
      if (char === "$" && command[index + 1] === "(") return "$("
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "`") return "`"
    if (char === "$" && command[index + 1] === "(") return "$("
    if (char === "\n" || char === "\r") return "换行"
    if (
      char === ";" ||
      char === "|" ||
      char === "&" ||
      char === "(" ||
      char === ")"
    ) {
      if (
        (char === "&" && command[index + 1] === "&") ||
        (char === "|" && command[index + 1] === "|")
      ) {
        return `${char}${char}`
      }
      return char
    }
    if (char === ">" || char === "<") {
      return command[index + 1] === char ? `${char}${char}` : char
    }
  }
  return null
}

function commandBaseName(token: string): string {
  const cleaned = token.trim().replace(/^["']+|["']+$/g, "")
  const parts = cleaned.split(/[\\/]+/)
  const last = parts[parts.length - 1] || cleaned
  return last.replace(EXECUTABLE_EXTENSION, "").toLowerCase()
}

function normalizeCommandEntry(entry: string): string {
  return entry.trim().toLowerCase().replace(EXECUTABLE_EXTENSION, "")
}

function matchesCommand(token: string, entry: string): boolean {
  const normalizedEntry = normalizeCommandEntry(entry)
  if (!normalizedEntry) return false
  const full = token
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .toLowerCase()
  return commandBaseName(token) === normalizedEntry || full === normalizedEntry
}

function findExecutableIndex(tokens: string[]): number {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].trim()
    if (!token) continue
    if (ENV_ASSIGNMENT.test(token)) continue
    return index
  }
  return -1
}

function matchDeniedCommand(
  tokens: string[],
  deniedCommands: string[]
): string | null {
  for (const entry of deniedCommands) {
    const words = entry.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    if (words.length === 1) {
      if (tokens.some((token) => matchesCommand(token, words[0]))) {
        return entry.trim()
      }
      continue
    }
    for (let start = 0; start <= tokens.length - words.length; start += 1) {
      let matched = true
      for (let offset = 0; offset < words.length; offset += 1) {
        const token = tokens[start + offset]
        const word = words[offset]
        if (
          token.trim().toLowerCase() !== word &&
          commandBaseName(token) !== word
        ) {
          matched = false
          break
        }
      }
      if (matched) return entry.trim()
    }
  }
  return null
}

function findPathEscape(token: string): string | null {
  const value = token.trim()
  if (!value) return null
  if (HOME_ESCAPE.test(value)) return "包含可能指向工作目录外的环境变量"

  const candidates = [value]
  const equals = value.indexOf("=")
  if (equals >= 0 && equals < value.length - 1) {
    candidates.push(value.slice(equals + 1))
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    const lower = candidate.toLowerCase()
    if (
      lower === "/dev/null" ||
      lower === "/dev/stdout" ||
      lower === "/dev/stderr" ||
      lower === "nul"
    ) {
      continue
    }
    if (candidate.startsWith("~")) return "包含 ~ 路径"
    if (/^[a-zA-Z]:([\\/]|$)/.test(candidate)) return "包含 Windows 盘符路径"
    if (/^[\\/]/.test(candidate)) return "包含绝对路径"
    if (/(^|[\\/])\.\.([\\/]|$)/.test(candidate)) return "包含 .. 路径"
  }
  return null
}

function isPathInside(root: string, target: string): boolean {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
  const normalizedRoot = normalize(root)
  const normalizedTarget = normalize(target)
  if (!normalizedRoot) return false
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}/`)
  )
}

export function evaluateToolCall(
  tool: string,
  constraints: GlobalConstraints,
  context: {
    taskId?: string
    path?: string
    host?: string
    destructive?: boolean
  } = {}
): PolicyResult {
  const normalized = normalizeToolName(tool)
  if (!normalized) {
    return deny("工具名称为空，无法执行策略校验。")
  }

  const tools = constraints.tools
  if (!tools.enabled) {
    return deny(
      "工具调用已被全局禁用：请在 /gepa/constraints 启用工具约束。",
      normalized
    )
  }

  if (tools.deniedTools.map(normalizeToolName).includes(normalized)) {
    return deny(
      `工具「${normalized}」在禁止列表中：请先在 /gepa/constraints 的禁止工具中移除。`,
      normalized
    )
  }

  if (!tools.allowedTools.map(normalizeToolName).includes(normalized)) {
    return deny(
      `工具「${normalized}」不在允许列表中：请在 /gepa/constraints 的允许工具中添加。`,
      normalized
    )
  }

  if (normalized === "bash" && !constraints.bash.enabled) {
    return deny("工具「bash」不可用：Bash 约束已全局禁用。", normalized)
  }

  if (NETWORK_TOOLS.has(normalized) && !tools.allowNetwork) {
    return deny(
      `工具「${normalized}」需要网络访问，但网络访问已全局禁用：请在 /gepa/constraints 开启「允许网络」。`,
      normalized
    )
  }

  const host = typeof context.host === "string" ? context.host.trim() : ""
  if (host && tools.allowedHosts.length > 0) {
    const matched = tools.allowedHosts.some((pattern) =>
      hostMatches(pattern, host)
    )
    if (!matched) {
      return deny(
        `目标主机「${host}」不在 host 白名单中：允许的主机：${formatList(tools.allowedHosts)}。`,
        normalized
      )
    }
  }

  const destructive =
    context.destructive === true || WRITE_TOOLS.has(normalized)
  if (destructive && tools.requireApprovalForWrite) {
    return deny(
      `工具「${normalized}」属于写操作，当前要求人工批准：请通过审批流程执行，或在 /gepa/constraints 关闭「写操作需审批」。`,
      normalized
    )
  }

  const target = context.path ? `，目标路径：${context.path}` : ""
  return {
    allowed: true,
    reason: `工具「${normalized}」已通过策略校验${target}。`,
    normalized,
  }
}

export function evaluateBashCommand(
  command: string,
  constraints: GlobalConstraints,
  context: {
    taskId?: string
    workspaceDir?: string
    cwd?: string
  } = {}
): PolicyResult {
  const bash = constraints.bash
  const normalized = typeof command === "string" ? command.trim() : ""

  if (!bash.enabled) {
    return deny(
      "Bash 命令已被全局禁用：请在 /gepa/constraints 启用 Bash 约束。",
      normalized
    )
  }
  if (!normalized) {
    return deny("命令为空，请输入要执行的命令。")
  }
  if (normalized.length > MAX_COMMAND_LENGTH) {
    return deny(
      `命令过长（${normalized.length} 字符，上限 ${MAX_COMMAND_LENGTH} 字符），请拆分后再执行。`,
      normalized
    )
  }

  const tokens = tokenizeCommand(normalized)
  const executableIndex = findExecutableIndex(tokens)
  if (executableIndex === -1) {
    return deny("无法解析命令的可执行程序，请检查命令格式。", normalized)
  }
  const executable = tokens[executableIndex]

  if (commandBaseName(executable) === "sudo") {
    return deny("不允许使用 sudo 提权：请直接执行允许的命令。", normalized)
  }

  const denied = matchDeniedCommand(tokens, bash.deniedCommands)
  if (denied) {
    return deny(
      `命令「${denied}」在禁止列表中：请在 /gepa/constraints 调整禁止命令。`,
      normalized
    )
  }

  if (bash.allowedCommands.length === 0) {
    return deny(
      "允许命令列表为空，所有 Bash 命令都会被拒绝：请在 /gepa/constraints 添加允许命令。",
      normalized
    )
  }
  if (
    !bash.allowedCommands.some((entry) => matchesCommand(executable, entry))
  ) {
    return deny(
      `命令「${commandBaseName(executable)}」不在允许列表中：请在 /gepa/constraints 的允许命令中添加。`,
      normalized
    )
  }

  if (!bash.allowShellOperators) {
    const operator = findShellOperator(normalized)
    if (operator) {
      return deny(
        `不允许使用 shell 操作符「${operator}」：请改写为单条命令，或在 /gepa/constraints 开启「允许 shell 操作符」。`,
        normalized
      )
    }
  }

  if (bash.allowShellOperators) {
    for (const segment of commandSegments(normalized)) {
      const index = findExecutableIndex(segment)
      if (index === -1) continue
      const candidate = segment[index]
      if (/^\d+$/.test(candidate)) continue
      if (commandBaseName(candidate) === "sudo") {
        return deny("不允许使用 sudo 提权：请直接执行允许的命令。", normalized)
      }
      if (
        !bash.allowedCommands.some((entry) => matchesCommand(candidate, entry))
      ) {
        return deny(
          `链式命令中的「${commandBaseName(candidate)}」不在允许列表中：请在 /gepa/constraints 的允许命令中添加。`,
          normalized
        )
      }
    }
  }

  if (bash.workingDirOnly) {
    if (
      context.workspaceDir &&
      context.cwd &&
      !isPathInside(context.workspaceDir, context.cwd)
    ) {
      return deny(
        `当前工作目录「${context.cwd}」不在允许的工作空间「${context.workspaceDir}」内。`,
        normalized
      )
    }
    const executableEscape = findPathEscape(executable)
    if (executableEscape) {
      return deny(
        `可执行文件「${executable}」${executableEscape}，可能绕过命令白名单：请使用 PATH 中的命令名。`,
        normalized
      )
    }
    for (let index = 0; index < tokens.length; index += 1) {
      if (index === executableIndex) continue
      const token = tokens[index]
      if (!token || /^\d+$/.test(token)) continue
      const escape = findPathEscape(token)
      if (escape) {
        return deny(
          `参数「${token}」${escape}，可能逃逸工作目录：仅允许工作目录内的相对路径。`,
          normalized
        )
      }
    }
  }

  return {
    allowed: true,
    reason: `命令已通过策略校验（超时 ${bash.timeoutMs}ms，输出上限 ${bash.maxOutputBytes} 字节）。`,
    normalized,
  }
}

export function describeConstraints(constraints: GlobalConstraints): string {
  const tools = constraints.tools
  const bash = constraints.bash

  const toolLines = tools.enabled
    ? [
        "工具约束：已启用",
        `允许工具：${formatList(tools.allowedTools)}`,
        `禁止工具：${formatList(tools.deniedTools)}`,
        `每轮最大调用数：${tools.maxCallsPerIteration}`,
        `写操作审批：${tools.requireApprovalForWrite ? "需要人工批准" : "无需批准"}`,
        `网络访问：${tools.allowNetwork ? "允许" : "禁止"}`,
        `Host 白名单：${
          tools.allowedHosts.length > 0
            ? formatList(tools.allowedHosts)
            : "不限"
        }`,
      ]
    : ["工具约束：已禁用（所有工具调用都会被拒绝）"]

  const bashLines = bash.enabled
    ? [
        "Bash 约束：已启用",
        `允许命令：${formatList(bash.allowedCommands)}`,
        `禁止命令：${formatList(bash.deniedCommands)}`,
        `Shell 操作符：${bash.allowShellOperators ? "允许" : "禁止"}`,
        `超时：${bash.timeoutMs}ms`,
        `输出上限：${bash.maxOutputBytes} 字节`,
        `工作目录：${bash.workingDirOnly ? "仅允许工作目录内" : "不限制"}`,
      ]
    : ["Bash 约束：已禁用（所有 Bash 命令都会被拒绝）"]

  return [...toolLines, ...bashLines].join("\n")
}
