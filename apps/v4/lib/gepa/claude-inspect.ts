import {
  createReadStream,
  promises as fs,
  type Dirent,
  type Stats,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"

/**
 * 读取本地 Claude Code 的会话记录（~/.claude/projects 下各项目的 jsonl 文件）
 * 与可选的技能 / 钩子 / 命令 / 记忆等配置，为「会话分析」功能提供数据。
 * 只做只读访问，所有解析都尽量容错：单个文件损坏不影响整体扫描。
 */

export const DEFAULT_INCLUDE_OPTIONS = {
  skills: true,
  hooks: true,
  commands: false,
  memory: true,
  mcp: true,
  plugins: false,
} as const

export interface AnalysisIncludeOptions {
  skills: boolean
  hooks: boolean
  commands: boolean
  memory: boolean
  mcp: boolean
  plugins: boolean
}

export interface ClaudeProjectInfo {
  slug: string
  sessionCount: number
  lastActiveAt: string | null
  cwd: string | null
}

export interface SessionIntent {
  at: string | null
  text: string
}

export interface SessionAssistantText {
  at: string | null
  text: string
}

export interface SessionToolStat {
  name: string
  count: number
  errors: number
  sampleInputs: string[]
}

export interface SessionErrorSample {
  tool: string
  detail: string
}

export interface SessionHookError {
  hookName: string
  event: string
  detail: string
}

export interface SessionScan {
  project: string
  sessionId: string
  fileName: string
  filePath: string
  cwd: string | null
  gitBranch: string | null
  claudeVersion: string | null
  title: string | null
  startedAt: string | null
  updatedAt: string | null
  userMessages: number
  assistantMessages: number
  sidechainMessages: number
  toolCalls: number
  toolErrors: number
  hookErrors: number
  models: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number | null
  totalDurationMs: number | null
  bytes: number
  truncated: boolean
  userIntents: SessionIntent[]
  assistantTexts: SessionAssistantText[]
  toolStats: SessionToolStat[]
  toolErrorSamples: SessionErrorSample[]
  hookErrorSamples: SessionHookError[]
}

export interface ClaudeSkillInfo {
  name: string
  source: string
  path: string
  description: string
  body: string
}

export interface ClaudeHookEntry {
  matchers: string
  type: string
  command: string
  timeout: number | null
}

export interface ClaudeHookEvent {
  source: string
  path: string
  event: string
  entries: ClaudeHookEntry[]
}

export interface ClaudeCommandInfo {
  name: string
  source: string
  path: string
  body: string
}

export interface ClaudeMemoryInfo {
  name: string
  source: string
  path: string
  body: string
}

export interface ClaudeMcpInfo {
  name: string
  source: string
  kind: string
  detail: string
}

export interface ClaudePluginInfo {
  source: string
  plugins: string[]
}

export interface ClaudeConfigSnapshot {
  claudeDir: string
  projectCwd: string | null
  skills: ClaudeSkillInfo[]
  hooks: ClaudeHookEvent[]
  commands: ClaudeCommandInfo[]
  memory: ClaudeMemoryInfo[]
  mcp: ClaudeMcpInfo[]
  plugins: ClaudePluginInfo[]
  warnings: string[]
}

const PROJECT_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SESSION_ID_PATTERN = /^[A-Fa-f0-9-]{8,80}$/
const MAX_SCAN_BYTES = 32_000_000
const MAX_USER_INTENTS = 30
const MAX_INTENT_CHARS = 600
const MAX_ASSISTANT_TEXTS = 3
const MAX_ASSISTANT_TEXT_CHARS = 2_400
const MAX_TOOL_SAMPLES = 3
const MAX_TOOL_SAMPLE_CHARS = 240
const MAX_ERROR_SAMPLES = 12
const MAX_ERROR_SAMPLE_CHARS = 500
const MAX_TITLE_CHARS = 90

export function resolveClaudeDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR
  const dir = configured?.trim()
    ? path.resolve(configured.trim())
    : path.join(os.homedir(), ".claude")
  return dir
}

export function isProjectSlug(value: string): boolean {
  return PROJECT_SLUG_PATTERN.test(value)
}

export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value)
}

function truncate(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

function truncateBlock(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 跳过系统注入与命令包装类内容，只保留用户真实输入。 */
function isRealUserText(text: string): boolean {
  if (!text.trim()) return false
  const skipPrefixes = [
    "<",
    "Caveat:",
    "[Request interrupted",
    "[Request canceled",
  ]
  return !skipPrefixes.some((prefix) => text.trimStart().startsWith(prefix))
}

interface ToolAccumulator {
  count: number
  errors: number
  sampleInputs: string[]
}

interface ScanAccumulator {
  scan: SessionScan
  tools: Map<string, ToolAccumulator>
  assistantTexts: SessionAssistantText[]
  modelSet: Set<string>
  summaryTitle: string | null
  titleFromUser: string | null
  costState: {
    costUsd: number | null
    totalDurationMs: number | null
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  } | null
}

function collectContentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content) {
    if (
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      parts.push(block.text)
    }
  }
  return parts.join("\n")
}

function collectToolResultErrors(content: unknown, acc: ScanAccumulator): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (
      isRecord(block) &&
      block.type === "tool_result" &&
      block.is_error === true
    ) {
      acc.scan.toolErrors += 1
      if (acc.scan.toolErrorSamples.length < MAX_ERROR_SAMPLES) {
        const detail = truncate(
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content ?? ""),
          MAX_ERROR_SAMPLE_CHARS
        )
        const toolUseId =
          typeof block.tool_use_id === "string" ? block.tool_use_id : ""
        acc.scan.toolErrorSamples.push({
          tool: toolUseId
            ? `tool_result(${toolUseId.slice(0, 8)})`
            : "tool_result",
          detail,
        })
      }
    }
  }
}

function processAssistantEntry(
  entry: Record<string, unknown>,
  acc: ScanAccumulator
): void {
  const isSidechain = entry.isSidechain === true
  if (isSidechain) {
    acc.scan.sidechainMessages += 1
  } else {
    acc.scan.assistantMessages += 1
  }
  const message = isRecord(entry.message) ? entry.message : null
  const model = typeof message?.model === "string" ? message.model : ""
  if (model) acc.modelSet.add(model)
  const usage = isRecord(message?.usage) ? message.usage : null
  if (usage && !isSidechain) {
    acc.scan.inputTokens += toCount(usage.input_tokens)
    acc.scan.outputTokens += toCount(usage.output_tokens)
    acc.scan.cacheReadTokens += toCount(usage.cache_read_input_tokens)
    acc.scan.cacheCreationTokens += toCount(usage.cache_creation_input_tokens)
  }
  const content = message?.content
  if (!Array.isArray(content)) return
  const at = typeof entry.timestamp === "string" ? entry.timestamp : null
  for (const block of content) {
    if (!isRecord(block)) continue
    if (
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.trim()
    ) {
      const text = truncateBlock(block.text, MAX_ASSISTANT_TEXT_CHARS)
      if (acc.assistantTexts.length >= MAX_ASSISTANT_TEXTS) {
        acc.assistantTexts.shift()
      }
      acc.assistantTexts.push({ at, text })
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      const name = block.name
      acc.scan.toolCalls += 1
      const stat = acc.tools.get(name) ?? {
        count: 0,
        errors: 0,
        sampleInputs: [],
      }
      stat.count += 1
      if (stat.sampleInputs.length < MAX_TOOL_SAMPLES) {
        const input = isRecord(block.input) ? JSON.stringify(block.input) : ""
        if (input)
          stat.sampleInputs.push(truncate(input, MAX_TOOL_SAMPLE_CHARS))
      }
      acc.tools.set(name, stat)
    }
  }
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0
}

function processUserEntry(
  entry: Record<string, unknown>,
  acc: ScanAccumulator
): void {
  const isSidechain = entry.isSidechain === true
  if (entry.isMeta === true) {
    collectToolResultErrors(
      (entry.message as Record<string, unknown> | undefined)?.content,
      acc
    )
    return
  }
  const message = isRecord(entry.message) ? entry.message : null
  const content = message?.content
  const text = collectContentText(content)
  if (!isSidechain && text && isRealUserText(text)) {
    acc.scan.userMessages += 1
    if (!acc.titleFromUser) {
      acc.titleFromUser = truncate(text, MAX_TITLE_CHARS)
    }
    if (acc.scan.userIntents.length < MAX_USER_INTENTS) {
      acc.scan.userIntents.push({
        at: typeof entry.timestamp === "string" ? entry.timestamp : null,
        text: truncateBlock(text, MAX_INTENT_CHARS),
      })
    }
  }
  collectToolResultErrors(content, acc)
}

function processAttachment(
  entry: Record<string, unknown>,
  acc: ScanAccumulator
): void {
  const attachment = isRecord(entry.attachment) ? entry.attachment : null
  if (!attachment) return
  const type = typeof attachment.type === "string" ? attachment.type : ""
  if (!type.includes("error")) return
  const hookName =
    typeof attachment.hookName === "string" ? attachment.hookName : "unknown"
  const event =
    typeof attachment.hookEvent === "string" ? attachment.hookEvent : ""
  const detail = truncate(
    [attachment.stderr, attachment.stdout]
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
      .join("\n") || JSON.stringify(attachment),
    MAX_ERROR_SAMPLE_CHARS
  )
  acc.scan.hookErrors += 1
  if (acc.scan.hookErrorSamples.length < MAX_ERROR_SAMPLES) {
    acc.scan.hookErrorSamples.push({ hookName, event, detail })
  }
}

function processCostState(
  entry: Record<string, unknown>,
  acc: ScanAccumulator
): void {
  const state = {
    costUsd:
      typeof entry.totalCostUSD === "number" &&
      Number.isFinite(entry.totalCostUSD)
        ? entry.totalCostUSD
        : null,
    totalDurationMs:
      typeof entry.totalDuration === "number" &&
      Number.isFinite(entry.totalDuration)
        ? entry.totalDuration
        : null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
  const modelUsage = isRecord(entry.modelUsage) ? entry.modelUsage : null
  if (modelUsage) {
    for (const value of Object.values(modelUsage)) {
      if (!isRecord(value)) continue
      state.inputTokens += toCount(value.inputTokens)
      state.outputTokens += toCount(value.outputTokens)
      state.cacheReadTokens += toCount(value.cacheReadInputTokens)
      state.cacheCreationTokens += toCount(value.cacheCreationInputTokens)
    }
  }
  acc.costState = state
}

async function scanSessionFile(
  project: string,
  filePath: string,
  stat: { size: number }
): Promise<SessionScan> {
  const sessionId = path.basename(filePath).replace(/\.jsonl$/i, "")
  const scan: SessionScan = {
    project,
    sessionId,
    fileName: path.basename(filePath),
    filePath,
    cwd: null,
    gitBranch: null,
    claudeVersion: null,
    title: null,
    startedAt: null,
    updatedAt: null,
    userMessages: 0,
    assistantMessages: 0,
    sidechainMessages: 0,
    toolCalls: 0,
    toolErrors: 0,
    hookErrors: 0,
    models: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: null,
    totalDurationMs: null,
    bytes: stat.size,
    truncated: false,
    userIntents: [],
    assistantTexts: [],
    toolStats: [],
    toolErrorSamples: [],
    hookErrorSamples: [],
  }
  const acc: ScanAccumulator = {
    scan,
    tools: new Map(),
    assistantTexts: [],
    modelSet: new Set(),
    summaryTitle: null,
    titleFromUser: null,
    costState: null,
  }

  const stream = createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let bytesRead = 0
  try {
    for await (const line of rl) {
      bytesRead += line.length + 1
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(line)
        if (!isRecord(parsed)) continue
        entry = parsed
      } catch {
        continue
      }
      if (!scan.startedAt && typeof entry.timestamp === "string") {
        scan.startedAt = entry.timestamp
      }
      if (typeof entry.timestamp === "string") {
        scan.updatedAt = entry.timestamp
      }
      if (!scan.cwd && typeof entry.cwd === "string" && entry.cwd) {
        scan.cwd = entry.cwd
      }
      if (
        !scan.gitBranch &&
        typeof entry.gitBranch === "string" &&
        entry.gitBranch
      ) {
        scan.gitBranch = entry.gitBranch
      }
      if (!scan.claudeVersion && typeof entry.version === "string") {
        scan.claudeVersion = entry.version
      }
      if (entry.type === "summary" && !acc.summaryTitle) {
        const summary = entry.summary
        if (typeof summary === "string" && summary.trim()) {
          acc.summaryTitle = truncate(summary, MAX_TITLE_CHARS)
        }
      } else if (entry.type === "user") {
        processUserEntry(entry, acc)
      } else if (entry.type === "assistant") {
        processAssistantEntry(entry, acc)
      } else if (entry.type === "attachment") {
        processAttachment(entry, acc)
      } else if (entry.type === "cost-state") {
        processCostState(entry, acc)
      }
      if (bytesRead > MAX_SCAN_BYTES) {
        scan.truncated = true
        break
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  scan.assistantTexts = acc.assistantTexts
  scan.models = [...acc.modelSet]
  scan.toolStats = [...acc.tools.entries()]
    .map(([name, stat]) => ({ name, ...stat }))
    .sort((a, b) => b.count - a.count)
  if (acc.costState) {
    scan.costUsd = acc.costState.costUsd
    scan.totalDurationMs = acc.costState.totalDurationMs
    if (scan.inputTokens === 0) scan.inputTokens = acc.costState.inputTokens
    if (scan.outputTokens === 0) scan.outputTokens = acc.costState.outputTokens
    if (scan.cacheReadTokens === 0) {
      scan.cacheReadTokens = acc.costState.cacheReadTokens
    }
    if (scan.cacheCreationTokens === 0) {
      scan.cacheCreationTokens = acc.costState.cacheCreationTokens
    }
  }
  scan.title = acc.summaryTitle ?? acc.titleFromUser ?? "(无用户消息)"
  return scan
}

async function listSessionFiles(projectDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true })
    return entries
      .filter(
        (item) => item.isFile() && item.name.toLowerCase().endsWith(".jsonl")
      )
      .map((item) => path.join(projectDir, item.name))
  } catch {
    return []
  }
}

/** 读取 JSONL 文件开头，提取 cwd 字段，用于把项目目录名还原为实际路径。 */
async function peekCwd(filePath: string): Promise<string | null> {
  try {
    const handle = await fs.open(filePath, "r")
    try {
      const buffer = Buffer.alloc(262_144)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const text = buffer.toString("utf8", 0, bytesRead)
      const match = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(text)
      if (!match) return null
      try {
        return JSON.parse(`"${match[1]}"`) as string
      } catch {
        return match[1]
      }
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

export async function listClaudeProjects(): Promise<ClaudeProjectInfo[]> {
  const projectsDir = path.join(resolveClaudeDir(), "projects")
  let entries: Dirent[]
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true })
  } catch {
    throw new Error(
      `无法读取 Claude 会话目录：${projectsDir}（请确认本机已安装并使用过 Claude Code）`
    )
  }
  const projects: ClaudeProjectInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const files = await listSessionFiles(path.join(projectsDir, entry.name))
    if (files.length === 0) continue
    const stats = await Promise.all(
      files.map(async (file) => {
        try {
          return { file, stat: await fs.stat(file) }
        } catch {
          return null
        }
      })
    )
    const valid = stats.filter(
      (item): item is { file: string; stat: Stats } => item !== null
    )
    const latest = valid.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]
    projects.push({
      slug: entry.name,
      sessionCount: valid.length,
      lastActiveAt: latest ? latest.stat.mtime.toISOString() : null,
      cwd: latest ? await peekCwd(latest.file) : null,
    })
  }
  return projects.sort((a, b) => {
    const aAt = a.lastActiveAt ?? ""
    const bAt = b.lastActiveAt ?? ""
    return bAt.localeCompare(aAt)
  })
}

function projectDirFor(slug: string): string {
  if (!isProjectSlug(slug)) {
    throw new Error(`项目目录名不合法：${slug}`)
  }
  return path.join(resolveClaudeDir(), "projects", slug)
}

export interface SessionListResult {
  project: string | null
  sessions: SessionScan[]
  total: number
  scanErrors?: string[]
}

interface SessionFileStat {
  project: string
  file: string
  stat: Stats
}

async function statSessionFiles(
  project: string,
  projectDir: string
): Promise<SessionFileStat[]> {
  const files = await listSessionFiles(projectDir)
  const stats = await Promise.all(
    files.map(async (file) => {
      try {
        return { project, file, stat: await fs.stat(file) }
      } catch {
        return null
      }
    })
  )
  return stats.filter((item): item is SessionFileStat => item !== null)
}

async function scanSessionFiles(
  capped: SessionFileStat[],
  errors?: string[]
): Promise<SessionScan[]> {
  const sessions: SessionScan[] = []
  for (const { project, file, stat } of capped) {
    try {
      sessions.push(await scanSessionFile(project, file, { size: stat.size }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[claude-inspect] 扫描会话失败 ${file}:`, message)
      errors?.push(`${path.basename(file)}: ${message}`)
    }
  }
  return sessions
}

function capByMtime(
  entries: SessionFileStat[],
  limit: number
): SessionFileStat[] {
  return [...entries]
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, Math.max(1, Math.min(200, limit)))
}

/** 扫描某个项目下最近 limit 个会话（按修改时间倒序）。 */
export async function listProjectSessions(
  slug: string,
  limit = 50
): Promise<SessionListResult> {
  const entries = await statSessionFiles(slug, projectDirFor(slug))
  const capped = capByMtime(entries, limit)
  const scanErrors: string[] = []
  const sessions = await scanSessionFiles(capped, scanErrors)
  return {
    project: slug,
    sessions,
    total: entries.length,
    scanErrors: scanErrors.slice(0, 5),
  }
}

/** 跨项目扫描全局最近的 limit 个会话（按修改时间倒序）。 */
export async function listRecentSessions(
  limit = 40
): Promise<SessionListResult> {
  const projectsDir = path.join(resolveClaudeDir(), "projects")
  let dirs: Dirent[]
  try {
    dirs = await fs.readdir(projectsDir, { withFileTypes: true })
  } catch {
    throw new Error(
      `无法读取 Claude 会话目录：${projectsDir}（请确认本机已安装并使用过 Claude Code）`
    )
  }
  const grouped = await Promise.all(
    dirs
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        statSessionFiles(entry.name, path.join(projectsDir, entry.name))
      )
  )
  const all = grouped.flat()
  const capped = capByMtime(all, limit)
  const scanErrors: string[] = []
  const sessions = await scanSessionFiles(capped, scanErrors)
  return {
    project: null,
    sessions,
    total: all.length,
    scanErrors: scanErrors.slice(0, 5),
  }
}

export async function readSessionScan(
  slug: string,
  sessionId: string
): Promise<SessionScan> {
  const { filePath, stat } = await locateSessionFile(slug, sessionId)
  return scanSessionFile(slug, filePath, { size: stat.size })
}

async function locateSessionFile(
  slug: string,
  sessionId: string
): Promise<{ filePath: string; stat: Stats }> {
  if (!isSessionId(sessionId)) {
    throw new Error(`会话 ID 不合法：${sessionId}`)
  }
  const filePath = path.join(projectDirFor(slug), `${sessionId}.jsonl`)
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat) {
    throw new Error(`会话文件不存在：${slug}/${sessionId}.jsonl`)
  }
  return { filePath, stat }
}

// ---------------------------------------------------------------------------
// 会话转录预览：输出 Claude Code 终端风格的对话流水
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  kind: "user" | "assistant" | "tool" | "thinking" | "hook"
  at: string | null
  text: string
  /** 工具调用行：工具名与参数摘要。 */
  tool?: string
  detail?: string
  /** 工具结果摘录（目前只记录错误，模拟 ⎿ 输出行）。 */
  output?: string
  isError?: boolean
  sidechain?: boolean
}

export interface SessionTranscript {
  entries: TranscriptEntry[]
  truncated: boolean
}

const MAX_TRANSCRIPT_TEXT_CHARS = 1_500
const MAX_TRANSCRIPT_THINKING_CHARS = 300
const MAX_TRANSCRIPT_TOOL_DETAIL_CHARS = 140
const MAX_TRANSCRIPT_OUTPUT_CHARS = 400
const DEFAULT_TRANSCRIPT_ENTRIES = 400

function clipText(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n…` : trimmed
}

/** 生成工具调用的单行摘要，如 Bash(arm-none-eabi-gcc --version…)。 */
function summarizeToolInput(
  name: string,
  input: Record<string, unknown>
): string {
  const preferred = [
    "command",
    "file_path",
    "path",
    "pattern",
    "url",
    "query",
    "description",
    "prompt",
    "skill",
    "name",
  ]
  for (const key of preferred) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) {
      return truncate(value, MAX_TRANSCRIPT_TOOL_DETAIL_CHARS)
    }
  }
  return truncate(JSON.stringify(input), MAX_TRANSCRIPT_TOOL_DETAIL_CHARS)
}

/** 读取会话的对话转录，用于前端按 Claude Code 终端风格回放。 */
export async function readSessionTranscript(
  slug: string,
  sessionId: string,
  maxEntries = DEFAULT_TRANSCRIPT_ENTRIES
): Promise<SessionTranscript> {
  const { filePath } = await locateSessionFile(slug, sessionId)
  const cap = Math.max(50, Math.min(2_000, maxEntries))
  const entries: TranscriptEntry[] = []
  const pendingTools = new Map<string, number>()
  let truncated = false

  const push = (entry: TranscriptEntry): boolean => {
    if (entries.length >= cap) {
      truncated = true
      return false
    }
    entries.push(entry)
    return true
  }

  const stream = createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (truncated) break
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(line)
        if (!isRecord(parsed)) continue
        entry = parsed
      } catch {
        continue
      }
      const at = typeof entry.timestamp === "string" ? entry.timestamp : null
      const sidechain = entry.isSidechain === true

      if (entry.type === "user") {
        const message = isRecord(entry.message) ? entry.message : null
        const content = message?.content
        const blocks = Array.isArray(content) ? content : null
        if (blocks) {
          for (const block of blocks) {
            if (!isRecord(block)) continue
            if (block.type === "tool_result") {
              const index =
                typeof block.tool_use_id === "string"
                  ? pendingTools.get(block.tool_use_id)
                  : undefined
              if (index === undefined || block.is_error !== true) continue
              const detail = truncate(
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content ?? ""),
                MAX_TRANSCRIPT_OUTPUT_CHARS
              )
              entries[index] = {
                ...entries[index],
                isError: true,
                output: detail,
              }
            } else if (
              block.type === "text" &&
              typeof block.text === "string" &&
              !sidechain &&
              entry.isMeta !== true &&
              isRealUserText(block.text)
            ) {
              if (
                !push({
                  kind: "user",
                  at,
                  text: clipText(block.text, MAX_TRANSCRIPT_TEXT_CHARS),
                })
              ) {
                break
              }
            }
          }
        } else if (
          typeof content === "string" &&
          !sidechain &&
          entry.isMeta !== true &&
          isRealUserText(content)
        ) {
          push({
            kind: "user",
            at,
            text: clipText(content, MAX_TRANSCRIPT_TEXT_CHARS),
          })
        }
      } else if (entry.type === "assistant") {
        const message = isRecord(entry.message) ? entry.message : null
        const content = message?.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (!isRecord(block)) continue
          if (block.type === "text" && typeof block.text === "string") {
            if (
              !push({
                kind: "assistant",
                at,
                sidechain,
                text: clipText(block.text, MAX_TRANSCRIPT_TEXT_CHARS),
              })
            ) {
              break
            }
          } else if (
            block.type === "thinking" &&
            typeof block.thinking === "string"
          ) {
            if (
              !push({
                kind: "thinking",
                at,
                sidechain,
                text: clipText(block.thinking, MAX_TRANSCRIPT_THINKING_CHARS),
              })
            ) {
              break
            }
          } else if (
            block.type === "tool_use" &&
            typeof block.name === "string"
          ) {
            const detail = isRecord(block.input)
              ? summarizeToolInput(block.name, block.input)
              : ""
            const accepted = push({
              kind: "tool",
              at,
              text: "",
              sidechain,
              tool: block.name,
              detail,
            })
            if (!accepted) break
            if (typeof block.id === "string") {
              pendingTools.set(block.id, entries.length - 1)
            }
          }
        }
      } else if (entry.type === "attachment") {
        const attachment = isRecord(entry.attachment) ? entry.attachment : null
        if (!attachment) continue
        const type = typeof attachment.type === "string" ? attachment.type : ""
        if (!type.includes("error")) continue
        const hookName =
          typeof attachment.hookName === "string" ? attachment.hookName : "hook"
        const detail = truncate(
          [attachment.stderr, attachment.stdout]
            .filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0
            )
            .join("\n") || JSON.stringify(attachment),
          MAX_TRANSCRIPT_OUTPUT_CHARS
        )
        push({
          kind: "hook",
          at,
          text: hookName,
          output: detail,
          isError: true,
        })
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return { entries, truncated }
}

// ---------------------------------------------------------------------------
// 可选配置读取：skills / hooks / commands / 记忆 / MCP / 插件
// ---------------------------------------------------------------------------

const MAX_SKILLS = 40
const MAX_SKILL_BODY_CHARS = 1_600
const MAX_COMMANDS = 30
const MAX_COMMAND_BODY_CHARS = 1_200
const MAX_MEMORY_BODY_CHARS = 4_000
const MAX_HOOK_EVENTS = 24
const MAX_HOOK_ENTRIES_PER_EVENT = 8

function parseFrontmatter(raw: string): {
  name: string
  description: string
  body: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) {
    return { name: "", description: "", body: raw }
  }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([\w-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (pair) meta[pair[1].toLowerCase()] = pair[2].trim()
  }
  return {
    name: meta.name ?? "",
    description: meta.description ?? "",
    body: raw.slice(match[0].length),
  }
}

async function readTextFile(
  filePath: string,
  maxChars: number
): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return raw.length > maxChars
      ? `${raw.slice(0, maxChars)}\n…（已截断）`
      : raw
  } catch {
    return null
  }
}

async function readSkillsIn(
  dir: string,
  source: string
): Promise<ClaudeSkillInfo[]> {
  const skills: ClaudeSkillInfo[] = []
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return skills
  }
  for (const entry of entries) {
    if (skills.length >= MAX_SKILLS) break
    const skillPath = entry.isDirectory()
      ? path.join(dir, entry.name, "SKILL.md")
      : entry.isFile() && entry.name.toLowerCase().endsWith(".md")
        ? path.join(dir, entry.name)
        : null
    if (!skillPath) continue
    const raw = await readTextFile(skillPath, MAX_SKILL_BODY_CHARS + 2_000)
    if (raw === null) continue
    const { name, description, body } = parseFrontmatter(raw)
    skills.push({
      name: name || entry.name,
      source,
      path: skillPath,
      description: truncate(description, 200),
      body: truncateBlock(body, MAX_SKILL_BODY_CHARS),
    })
  }
  return skills
}

async function readHookEvents(
  settingsPath: string,
  source: string
): Promise<ClaudeHookEvent[]> {
  const raw = await readTextFile(settingsPath, 200_000)
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) return []
  const events: ClaudeHookEvent[] = []
  for (const [event, value] of Object.entries(parsed.hooks)) {
    const groups = Array.isArray(value) ? value : [value]
    const entries: ClaudeHookEntry[] = []
    for (const group of groups) {
      if (!isRecord(group) || entries.length >= MAX_HOOK_ENTRIES_PER_EVENT)
        break
      const hooks = Array.isArray(group.hooks) ? group.hooks : []
      const matchers =
        typeof group.matcher === "string" && group.matcher
          ? group.matcher
          : Array.isArray(group.matcher)
            ? group.matcher.filter((m) => typeof m === "string").join("|")
            : "*"
      for (const hook of hooks) {
        if (!isRecord(hook)) continue
        entries.push({
          matchers,
          type: typeof hook.type === "string" ? hook.type : "command",
          command:
            typeof hook.command === "string"
              ? truncate(hook.command, 200)
              : typeof hook.prompt === "string"
                ? truncate(hook.prompt, 200)
                : "",
          timeout:
            typeof hook.timeout === "number" && Number.isFinite(hook.timeout)
              ? hook.timeout
              : null,
        })
        if (entries.length >= MAX_HOOK_ENTRIES_PER_EVENT) break
      }
    }
    if (entries.length > 0) {
      events.push({ source, path: settingsPath, event, entries })
    }
    if (events.length >= MAX_HOOK_EVENTS) break
  }
  return events
}

async function readCommandsIn(
  dir: string,
  source: string
): Promise<ClaudeCommandInfo[]> {
  const commands: ClaudeCommandInfo[] = []
  const walk = async (current: string, depth: number): Promise<void> => {
    if (commands.length >= MAX_COMMANDS || depth > 3) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (commands.length >= MAX_COMMANDS) return
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(child, depth + 1)
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        const raw = await readTextFile(child, MAX_COMMAND_BODY_CHARS + 1_000)
        if (raw === null) continue
        const { body } = parseFrontmatter(raw)
        commands.push({
          name: entry.name.replace(/\.md$/i, ""),
          source,
          path: child,
          body: truncateBlock(body, MAX_COMMAND_BODY_CHARS),
        })
      }
    }
  }
  await walk(dir, 0)
  return commands
}

function readMcpServers(value: unknown, source: string): ClaudeMcpInfo[] {
  if (!isRecord(value)) return []
  const servers: ClaudeMcpInfo[] = []
  for (const [name, server] of Object.entries(value)) {
    if (!isRecord(server)) continue
    const kind =
      typeof server.type === "string"
        ? server.type
        : typeof server.url === "string"
          ? "http"
          : "stdio"
    const detail =
      kind === "stdio"
        ? [server.command, ...(Array.isArray(server.args) ? server.args : [])]
            .filter((item): item is string => typeof item === "string")
            .join(" ")
        : typeof server.url === "string"
          ? server.url
          : ""
    servers.push({
      name,
      source,
      kind,
      detail: truncate(detail, 200),
    })
  }
  return servers
}

function collectPluginNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string")
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => enabled === true || typeof enabled === "string")
      .map(([key]) => key)
  }
  return []
}

/**
 * 按选项收集可选配置。projectCwd 为会话所属项目目录（用于读取项目级配置），
 * 为空时只读取用户级配置。
 */
export async function readClaudeConfigs(
  include: AnalysisIncludeOptions,
  projectCwd: string | null
): Promise<ClaudeConfigSnapshot> {
  const claudeDir = resolveClaudeDir()
  const snapshot: ClaudeConfigSnapshot = {
    claudeDir,
    projectCwd,
    skills: [],
    hooks: [],
    commands: [],
    memory: [],
    mcp: [],
    plugins: [],
    warnings: [],
  }
  const pushWarning = (label: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    snapshot.warnings.push(`${label}：${message}`)
  }

  const userSkillTasks = include.skills
    ? readSkillsIn(path.join(claudeDir, "skills"), "user").catch((error) => {
        pushWarning("读取用户技能失败", error)
        return []
      })
    : Promise.resolve([])
  const projectSkillTasks =
    include.skills && projectCwd
      ? readSkillsIn(
          path.join(projectCwd, ".claude", "skills"),
          "project"
        ).catch((error) => {
          pushWarning("读取项目技能失败", error)
          return []
        })
      : Promise.resolve([])

  const hookTasks: Promise<ClaudeHookEvent[]>[] = []
  if (include.hooks) {
    const settingsPaths: { file: string; source: string }[] = [
      { file: path.join(claudeDir, "settings.json"), source: "user" },
    ]
    if (projectCwd) {
      settingsPaths.push(
        {
          file: path.join(projectCwd, ".claude", "settings.json"),
          source: "project",
        },
        {
          file: path.join(projectCwd, ".claude", "settings.local.json"),
          source: "project-local",
        }
      )
    }
    for (const { file, source } of settingsPaths) {
      hookTasks.push(
        readHookEvents(file, source).catch((error) => {
          pushWarning(`读取钩子配置失败（${source}）`, error)
          return []
        })
      )
    }
  }

  const commandTasks: Promise<ClaudeCommandInfo[]>[] = []
  if (include.commands) {
    commandTasks.push(
      readCommandsIn(path.join(claudeDir, "commands"), "user").catch(
        (error) => {
          pushWarning("读取用户命令失败", error)
          return []
        }
      )
    )
    if (projectCwd) {
      commandTasks.push(
        readCommandsIn(
          path.join(projectCwd, ".claude", "commands"),
          "project"
        ).catch((error) => {
          pushWarning("读取项目命令失败", error)
          return []
        })
      )
    }
  }

  const memoryTasks: Promise<
    { name: string; source: string; file: string }[]
  >[] = []
  if (include.memory) {
    const memoryFiles: { name: string; source: string; file: string }[] = [
      {
        name: "CLAUDE.md",
        source: "user",
        file: path.join(claudeDir, "CLAUDE.md"),
      },
    ]
    if (projectCwd) {
      memoryFiles.push(
        {
          name: "CLAUDE.md",
          source: "project",
          file: path.join(projectCwd, "CLAUDE.md"),
        },
        {
          name: "AGENTS.md",
          source: "project",
          file: path.join(projectCwd, "AGENTS.md"),
        },
        {
          name: "CLAUDE.md",
          source: "project",
          file: path.join(projectCwd, ".claude", "CLAUDE.md"),
        }
      )
    }
    memoryTasks.push(Promise.resolve(memoryFiles))
  }

  const mcpTasks: Promise<ClaudeMcpInfo[]>[] = []
  if (include.mcp) {
    mcpTasks.push(
      fs
        .readFile(path.join(claudeDir, ".claude.json"), "utf8")
        .then((raw) => readMcpServers(JSON.parse(raw)?.mcpServers, "user"))
        .catch(() => [])
    )
    if (projectCwd) {
      mcpTasks.push(
        fs
          .readFile(path.join(projectCwd, ".mcp.json"), "utf8")
          .then((raw) => readMcpServers(JSON.parse(raw)?.mcpServers, "project"))
          .catch(() => [])
      )
    }
  }

  const pluginTasks: Promise<ClaudePluginInfo[]>[] = []
  if (include.plugins) {
    pluginTasks.push(
      fs
        .readFile(path.join(claudeDir, "settings.json"), "utf8")
        .then((raw) => {
          const settings = JSON.parse(raw)
          const plugins = collectPluginNames(settings?.enabledPlugins)
          return plugins.length > 0 ? [{ source: "user", plugins }] : []
        })
        .catch(() => [])
    )
  }

  const [
    userSkills,
    projectSkills,
    hookResults,
    commandResults,
    memoryFiles,
    mcpResults,
    pluginResults,
  ] = await Promise.all([
    userSkillTasks,
    projectSkillTasks,
    Promise.all(hookTasks),
    Promise.all(commandTasks),
    Promise.all(memoryTasks),
    Promise.all(mcpTasks),
    Promise.all(pluginTasks),
  ])

  snapshot.skills = [...userSkills, ...projectSkills]
  snapshot.hooks = hookResults.flat()
  snapshot.commands = commandResults.flat()
  if (include.memory) {
    for (const { name, source, file } of memoryFiles.flat()) {
      const body = await readTextFile(file, MAX_MEMORY_BODY_CHARS)
      if (body !== null) {
        snapshot.memory.push({ name, source, path: file, body })
      }
    }
  }
  snapshot.mcp = mcpResults.flat()
  snapshot.plugins = pluginResults.flat()
  return snapshot
}

// ---------------------------------------------------------------------------
// 摘要文本渲染：把扫描结果压缩为可发给 LLM 的文本
// ---------------------------------------------------------------------------

export const DIGEST_SECTION_LIMITS = {
  maxUserIntents: 24,
  maxToolStats: 14,
  maxToolSamplesPerTool: 2,
  maxToolErrorSamples: 8,
  maxHookErrorSamples: 6,
  maxAssistantTextChars: 1_800,
}

export function renderDigestText(scan: SessionScan): string {
  const limits = DIGEST_SECTION_LIMITS
  const lines: string[] = []
  lines.push(`- 项目：${scan.cwd ?? scan.project}`)
  lines.push(`- 会话 ID：${scan.sessionId}`)
  if (scan.startedAt) lines.push(`- 开始时间：${scan.startedAt}`)
  if (scan.updatedAt) lines.push(`- 最后活动：${scan.updatedAt}`)
  if (scan.gitBranch) lines.push(`- Git 分支：${scan.gitBranch}`)
  if (scan.claudeVersion)
    lines.push(`- Claude Code 版本：${scan.claudeVersion}`)
  lines.push(`- 模型：${scan.models.join(", ") || "未知"}`)
  lines.push(
    `- 规模：用户消息 ${scan.userMessages} 条，助手消息 ${scan.assistantMessages} 条，工具调用 ${scan.toolCalls} 次${
      scan.sidechainMessages > 0
        ? `，子代理消息 ${scan.sidechainMessages} 条`
        : ""
    }`
  )
  const totalTokens = scan.inputTokens + scan.outputTokens
  if (totalTokens > 0) {
    lines.push(
      `- Token：输入 ${scan.inputTokens.toLocaleString()}（缓存读 ${scan.cacheReadTokens.toLocaleString()} / 缓存写 ${scan.cacheCreationTokens.toLocaleString()}），输出 ${scan.outputTokens.toLocaleString()}`
    )
  }
  if (scan.costUsd !== null) {
    lines.push(`- 会话成本：约 $${scan.costUsd.toFixed(4)}`)
  }
  lines.push("")

  lines.push("## 用户意图时间线（按顺序）")
  const intents = scan.userIntents.slice(0, limits.maxUserIntents)
  if (intents.length === 0) {
    lines.push("（无有效用户输入）")
  }
  for (const [index, intent] of intents.entries()) {
    const at = intent.at ? intent.at.slice(11, 19) : "--:--:--"
    lines.push(`${index + 1}. [${at}] ${intent.text}`)
  }
  if (scan.userIntents.length > intents.length) {
    lines.push(
      `（其余 ${scan.userIntents.length - intents.length} 条用户输入未展示）`
    )
  }
  lines.push("")

  lines.push("## 工具使用统计（按调用次数排序）")
  const tools = scan.toolStats.slice(0, limits.maxToolStats)
  if (tools.length === 0) {
    lines.push("（无工具调用）")
  }
  for (const tool of tools) {
    const samples = tool.sampleInputs
      .slice(0, limits.maxToolSamplesPerTool)
      .map((sample) => `示例: ${sample}`)
      .join("；")
    lines.push(
      `- ${tool.name}：${tool.count} 次${tool.errors > 0 ? `（错误 ${tool.errors} 次）` : ""}${
        samples ? `；${samples}` : ""
      }`
    )
  }
  lines.push("")

  if (scan.toolErrorSamples.length > 0) {
    lines.push("## 工具错误样本")
    for (const sample of scan.toolErrorSamples.slice(
      0,
      limits.maxToolErrorSamples
    )) {
      lines.push(`- [${sample.tool}] ${sample.detail}`)
    }
    lines.push("")
  }
  if (scan.hookErrorSamples.length > 0) {
    lines.push("## 钩子错误样本")
    for (const sample of scan.hookErrorSamples.slice(
      0,
      limits.maxHookErrorSamples
    )) {
      lines.push(`- [${sample.hookName} @ ${sample.event}] ${sample.detail}`)
    }
    lines.push("")
  }

  lines.push("## 助手输出摘录（第一条与最后几条）")
  if (scan.assistantTexts.length === 0) {
    lines.push("（无文本输出）")
  }
  for (const [index, item] of scan.assistantTexts.entries()) {
    const label =
      index === 0 && scan.assistantTexts.length > 1 ? "开头" : "结尾"
    lines.push(`### ${label}（${item.at ?? "未知时间"}）`)
    lines.push(item.text.slice(0, limits.maxAssistantTextChars))
  }
  if (scan.truncated) {
    lines.push("")
    lines.push("（注意：会话文件过大，以上内容为截断采样）")
  }
  return lines.join("\n")
}

export function renderConfigsText(snapshot: ClaudeConfigSnapshot): string {
  const lines: string[] = []
  lines.push(`- Claude 配置目录：${snapshot.claudeDir}`)
  if (snapshot.projectCwd) lines.push(`- 项目目录：${snapshot.projectCwd}`)

  if (snapshot.skills.length > 0) {
    lines.push("")
    lines.push(`## 技能（${snapshot.skills.length} 个）`)
    for (const skill of snapshot.skills) {
      lines.push(`### ${skill.name}（${skill.source}）`)
      if (skill.description) lines.push(`描述：${skill.description}`)
      if (skill.body) {
        lines.push("内容摘录：")
        lines.push(skill.body)
      }
    }
  }
  if (snapshot.commands.length > 0) {
    lines.push("")
    lines.push(`## 自定义命令（${snapshot.commands.length} 个）`)
    for (const command of snapshot.commands) {
      lines.push(`### /${command.name}（${command.source}）`)
      if (command.body) lines.push(command.body)
    }
  }
  if (snapshot.hooks.length > 0) {
    lines.push("")
    lines.push("## 钩子配置")
    for (const event of snapshot.hooks) {
      lines.push(`### ${event.event}（${event.source}）`)
      for (const entry of event.entries) {
        const timeout = entry.timeout !== null ? `，超时 ${entry.timeout}s` : ""
        lines.push(
          `- 匹配 ${entry.matchers}：${entry.type} ${entry.command}${timeout}`
        )
      }
    }
  }
  if (snapshot.memory.length > 0) {
    lines.push("")
    lines.push(`## 记忆文件（${snapshot.memory.length} 个）`)
    for (const memory of snapshot.memory) {
      lines.push(`### ${memory.name}（${memory.source}）`)
      lines.push(memory.body)
    }
  }
  if (snapshot.mcp.length > 0) {
    lines.push("")
    lines.push(`## MCP 服务器（${snapshot.mcp.length} 个）`)
    for (const server of snapshot.mcp) {
      lines.push(
        `- ${server.name}（${server.kind}，${server.source}）：${server.detail}`
      )
    }
  }
  if (snapshot.plugins.length > 0) {
    lines.push("")
    lines.push("## 已启用插件")
    for (const group of snapshot.plugins) {
      lines.push(`- ${group.source}：${group.plugins.join(", ")}`)
    }
  }
  if (snapshot.warnings.length > 0) {
    lines.push("")
    lines.push("## 读取警告")
    for (const warning of snapshot.warnings) {
      lines.push(`- ${warning}`)
    }
  }
  if (
    snapshot.skills.length === 0 &&
    snapshot.commands.length === 0 &&
    snapshot.hooks.length === 0 &&
    snapshot.memory.length === 0 &&
    snapshot.mcp.length === 0 &&
    snapshot.plugins.length === 0
  ) {
    lines.push("")
    lines.push("（未收集到任何可选配置，或未启用对应采集项）")
  }
  return lines.join("\n")
}

export function normalizeIncludeOptions(
  value: unknown
): AnalysisIncludeOptions {
  const source = isRecord(value) ? value : {}
  const pick = (key: keyof AnalysisIncludeOptions): boolean =>
    typeof source[key] === "boolean"
      ? source[key]
      : DEFAULT_INCLUDE_OPTIONS[key]
  return {
    skills: pick("skills"),
    hooks: pick("hooks"),
    commands: pick("commands"),
    memory: pick("memory"),
    mcp: pick("mcp"),
    plugins: pick("plugins"),
  }
}
