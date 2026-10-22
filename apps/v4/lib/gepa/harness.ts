import { spawn, type ChildProcess } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import readline from "node:readline"

import { logLlmCall } from "./metrics"
import { terminateChild } from "./sandbox"
import type { HarnessConfig, LlmCallLog, ToolCallTrace } from "./types"

const MAX_CAPTURE_BYTES = 20_000
const CLAUDE_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "COMSPEC",
  "WINDIR",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "LANG",
  "LC_ALL",
  "TERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
]

export class HarnessAbortError extends Error {
  constructor() {
    super("Claude Code 执行已取消")
    this.name = "AbortError"
  }
}

export interface ClaudeCodeRunInput {
  config: HarnessConfig
  cwd: string
  skill: string
  input: string
  previous: string
  constraints: string
  taskId: string
  runId: string
  signal?: AbortSignal
}

export interface ClaudeCodeRunResult {
  output: string
  toolCalls: ToolCallTrace[]
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  costUsd: number
  durationMs: number
  exitCode: number | null
  stdout: string
  stderr: string
  model: string
  sessionId?: string
}

export interface ClaudeCodeStatus {
  available: boolean
  version: string
  loggedIn: boolean
  authMethod?: string
  apiProvider?: string
  error?: string
}

function createClaudeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV }
  for (const key of CLAUDE_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (typeof value === "string" && value) env[key] = value
  }
  return env
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 解析 Claude Code 可执行文件；兼容 Windows 上无扩展名的原生二进制。 */
export async function resolveClaudePath(configured: string): Promise<string> {
  const value =
    (typeof configured === "string" && configured.trim()) ||
    process.env.CLAUDE_CODE_PATH ||
    "claude"

  if (path.isAbsolute(value)) {
    if (await isExecutable(value)) return value
    throw new Error(`找不到 Claude Code 可执行文件：${value}`)
  }

  if (value.includes("/") || value.includes("\\")) {
    const resolved = path.resolve(value)
    if (await isExecutable(resolved)) return resolved
    throw new Error(`找不到 Claude Code 可执行文件：${resolved}`)
  }

  const directories = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
  for (const directory of directories) {
    for (const name of [value, `${value}.exe`, `${value}.cmd`, `${value}.bat`]) {
      const candidate = path.join(directory, name)
      if (await isExecutable(candidate)) return candidate
    }
  }

  if (process.platform === "win32" && process.env.USERPROFILE) {
    const candidate = path.join(
      process.env.USERPROFILE,
      ".local",
      "bin",
      value
    )
    if (await isExecutable(candidate)) return candidate
  }

  throw new Error(
    `找不到 Claude Code 可执行文件「${value}」，请在设置中配置 claudePath`
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function truncate(text: string, max = MAX_CAPTURE_BYTES): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function appendCapped(current: string, chunk: string): string {
  return current.length >= MAX_CAPTURE_BYTES ? current : current + chunk
}

function toolResultText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry
        if (isRecord(entry) && typeof entry.text === "string") return entry.text
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  if (value === null || value === undefined) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildSystemPrompt(skill: string): string {
  return [
    "你正在 GEPA 优化的执行阶段运行。当前工作目录是本次 rollout 的隔离副本。",
    "你可以使用工具读取/修改文件、运行命令；严格遵守下面的模块指令。",
    "完成后，在最后一条消息中给出任务结果本身，不要输出与任务无关的说明。",
    "",
    "<当前模块指令>",
    skill,
    "</当前模块指令>",
  ].join("\n")
}

function buildUserPrompt(
  input: string,
  previous: string,
  constraints: string
): string {
  const parts = [`<任务输入>\n${input}\n</任务输入>`]
  if (previous.trim()) {
    parts.push(`<前序输出>\n${previous}\n</前序输出>`)
  }
  if (constraints.trim()) {
    parts.push(`<额外约束>\n${constraints}\n</额外约束>`)
  }
  parts.push("请开始执行。")
  return parts.join("\n\n")
}

function buildArgs(
  config: HarnessConfig,
  systemPrompt: string
): string[] {
  const tools =
    config.allowedTools.length > 0 ? config.allowedTools : ["Read"]
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--safe-mode",
    "--strict-mcp-config",
    "--disable-slash-commands",
    // 注意：不要加 --restricted，它会让 Claude Code 忽略用户级认证配置，
    // 导致 OAuth 登录态失效（实测 2.1.294）。文件边界由 cwd + dontAsk 控制。
    "--tools",
    tools.join(","),
    "--allowedTools",
    tools.join(","),
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--append-system-prompt",
    systemPrompt,
  ]
  if (config.model.trim()) {
    args.push("--model", config.model.trim())
  }
  if (config.maxUsdPerRollout > 0) {
    args.push("--max-budget-usd", String(config.maxUsdPerRollout))
  }
  return args
}

interface StreamContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface StreamEvent {
  type?: string
  subtype?: string
  message?: { content?: StreamContentBlock[]; model?: string }
  result?: string
  total_cost_usd?: number
  usage?: Record<string, unknown>
  duration_ms?: number
  session_id?: string
  model?: string
  is_error?: boolean
  error?: string
}

interface ParsedUsage {
  inputTokens: number
  outputTokens: number
  cacheTokens: number
}

function parseUsage(
  usage: unknown,
  systemPrompt: string,
  userPrompt: string,
  output: string
): ParsedUsage {
  const record = isRecord(usage) ? usage : {}
  const input = toNumber(record.input_tokens)
  const outputTokens = toNumber(record.output_tokens)
  const cacheRead = toNumber(record.cache_read_input_tokens)
  const cacheCreation = toNumber(record.cache_creation_input_tokens)
  if (input === 0 && outputTokens === 0 && cacheRead === 0 && cacheCreation === 0) {
    return {
      inputTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
      outputTokens: Math.ceil(output.length / 4),
      cacheTokens: 0,
    }
  }
  return {
    inputTokens: input + cacheRead + cacheCreation,
    outputTokens,
    cacheTokens: cacheRead + cacheCreation,
  }
}

async function safeLog(log: Omit<LlmCallLog, "id" | "at">): Promise<void> {
  try {
    await logLlmCall(log)
  } catch {
    // 指标写入失败不影响执行
  }
}

let activeRuns = 0
const waiters: Array<() => void> = []

async function acquireSlot(maxConcurrent: number): Promise<void> {
  const limit = Math.max(1, Math.trunc(maxConcurrent))
  if (activeRuns < limit) {
    activeRuns += 1
    return
  }
  await new Promise<void>((resolve) => {
    waiters.push(resolve)
  })
  activeRuns += 1
}

function releaseSlot(): void {
  activeRuns = Math.max(0, activeRuns - 1)
  const next = waiters.shift()
  if (next) next()
}

async function execCapture(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    let timer: NodeJS.Timeout | null = null

    const finish = (code: number | null, reason?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code,
        stdout: truncate(stdout),
        stderr: truncate(reason ? `${stderr}\n${reason}`.trim() : stderr),
      })
    }

    let child: ChildProcess
    try {
      child = spawn(file, args, {
        windowsHide: true,
        env: createClaudeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      finish(null, error instanceof Error ? error.message : String(error))
      return
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", (error) => finish(null, error.message))
    child.on("close", (code) => finish(code))

    timer = setTimeout(() => {
      terminateChild(child)
      finish(null, `命令超时（超过 ${timeoutMs}ms）`)
    }, timeoutMs)
  })
}

/** 读取 Claude Code 版本与登录状态，不发起模型调用。 */
export async function checkClaudeCode(
  config: HarnessConfig
): Promise<ClaudeCodeStatus> {
  let claudePath: string
  try {
    claudePath = await resolveClaudePath(config.claudePath)
  } catch (error) {
    return {
      available: false,
      version: "",
      loggedIn: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const versionResult = await execCapture(claudePath, ["--version"], 15_000)
  const version =
    versionResult.stdout.trim() || versionResult.stderr.trim() || ""
  if (versionResult.code !== 0) {
    return {
      available: false,
      version,
      loggedIn: false,
      error:
        versionResult.stderr.trim() ||
        `claude --version 退出码 ${versionResult.code}`,
    }
  }

  const authResult = await execCapture(
    claudePath,
    ["auth", "status"],
    15_000
  )
  let auth: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(authResult.stdout)
    if (isRecord(parsed)) auth = parsed
  } catch {
    // 登录状态解析失败时保留 available，由 error 说明
  }

  return {
    available: true,
    version,
    loggedIn: auth.loggedIn === true,
    authMethod:
      typeof auth.authMethod === "string" ? auth.authMethod : undefined,
    apiProvider:
      typeof auth.apiProvider === "string" ? auth.apiProvider : undefined,
    error:
      authResult.code === 0
        ? undefined
        : authResult.stderr.trim() || "无法读取 Claude Code 登录状态",
  }
}

/** 在隔离工作目录中运行一次 Claude Code rollout。 */
export async function runClaudeCode(
  input: ClaudeCodeRunInput
): Promise<ClaudeCodeRunResult> {
  const claudePath = await resolveClaudePath(input.config.claudePath)
  const systemPrompt = buildSystemPrompt(input.skill)
  const userPrompt = buildUserPrompt(
    input.input,
    input.previous,
    input.constraints
  )
  const args = buildArgs(input.config, systemPrompt)
  const startedAt = Date.now()

  await acquireSlot(input.config.maxConcurrent)
  try {
    const result = await new Promise<ClaudeCodeRunResult>((resolve, reject) => {
      const texts: string[] = []
      const toolCalls: ToolCallTrace[] = []
      const pending = new Map<string, ToolCallTrace>()
      let stdout = ""
      let stderr = ""
      let resultText = ""
      let costUsd = 0
      let usage: ParsedUsage | null = null
      let sessionId: string | undefined
      let model = input.config.model.trim() || "default"
      let resultIsError = false
      let resultError = ""
      let exitCode: number | null = null
      let timedOut = false
      let aborted = false
      let settled = false
      let timer: NodeJS.Timeout | null = null

      let child: ChildProcess
      try {
        child = spawn(claudePath, args, {
          cwd: input.cwd,
          windowsHide: true,
          env: createClaudeEnv(),
          stdio: ["pipe", "pipe", "pipe"],
        })
      } catch (error) {
        reject(
          new Error(
            `无法启动 Claude Code：${
              error instanceof Error ? error.message : String(error)
            }`
          )
        )
        return
      }

      const finish = (reason?: string) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        input.signal?.removeEventListener("abort", onAbort)

        const output = (resultText || texts.join("\n")).trim()
        const parsedUsage = parseUsage(
          usage,
          systemPrompt,
          userPrompt,
          output
        )

        if (aborted) {
          reject(new HarnessAbortError())
          return
        }
        if (timedOut) {
          reject(
            new Error(
              `Claude Code 执行超时（超过 ${input.config.timeoutMs}ms），已终止`
            )
          )
          return
        }
        if (reason) {
          reject(new Error(reason))
          return
        }
        if (exitCode !== 0 || resultIsError) {
          const detail =
            resultError.trim() ||
            stderr.trim().slice(-2000) ||
            `退出码 ${exitCode}`
          reject(new Error(`Claude Code 执行失败：${detail}`))
          return
        }

        resolve({
          output,
          toolCalls,
          inputTokens: parsedUsage.inputTokens,
          outputTokens: parsedUsage.outputTokens,
          cacheTokens: parsedUsage.cacheTokens,
          costUsd,
          durationMs: Date.now() - startedAt,
          exitCode,
          stdout: truncate(stdout, 8_000),
          stderr: truncate(stderr, 8_000),
          model,
          sessionId,
        })
      }

      const onAbort = () => {
        aborted = true
        terminateChild(child)
      }
      input.signal?.addEventListener("abort", onAbort, { once: true })
      if (input.signal?.aborted) onAbort()

      child.stdin?.on("error", () => undefined)
      child.stdin?.end(userPrompt, "utf8")

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk.toString("utf8"))
      })

      if (child.stdout) {
        const lines = readline.createInterface({ input: child.stdout })
        lines.on("line", (line) => {
          stdout = appendCapped(stdout, `${line}\n`)
          if (!line.trim()) return
          let event: StreamEvent
          try {
            event = JSON.parse(line) as StreamEvent
          } catch {
            return
          }

          if (event.type === "system" && event.subtype === "init") {
            if (typeof event.model === "string") model = event.model
            if (typeof event.session_id === "string") {
              sessionId = event.session_id
            }
            return
          }

          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && typeof block.text === "string") {
                texts.push(block.text)
              } else if (block.type === "tool_use" && toolCalls.length < 500) {
                const call: ToolCallTrace = {
                  name: block.name ?? "tool",
                  input:
                    typeof block.input === "string"
                      ? block.input
                      : JSON.stringify(block.input ?? null),
                }
                toolCalls.push(call)
                if (block.id) pending.set(block.id, call)
              }
            }
            return
          }

          if (event.type === "user" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type !== "tool_result") continue
              const target = block.tool_use_id
                ? pending.get(block.tool_use_id)
                : undefined
              if (target) {
                target.output = truncate(toolResultText(block.content), 20_000)
                target.isError = block.is_error === true
                if (block.tool_use_id) pending.delete(block.tool_use_id)
              }
            }
            return
          }

          if (event.type === "result") {
            if (typeof event.result === "string") resultText = event.result
            costUsd = toNumber(event.total_cost_usd)
            usage = parseUsage(
              event.usage,
              systemPrompt,
              userPrompt,
              resultText
            )
            if (typeof event.session_id === "string") {
              sessionId = event.session_id
            }
            if (typeof event.model === "string") model = event.model
            if (event.is_error === true) {
              resultIsError = true
              resultError =
                typeof event.error === "string" && event.error
                  ? event.error
                  : resultText
            }
          }
        })
      }

      child.on("error", (error) => {
        finish(`无法启动 Claude Code：${error.message}`)
      })
      child.on("close", (code) => {
        exitCode = code
        finish()
      })

      timer = setTimeout(() => {
        timedOut = true
        terminateChild(child)
      }, input.config.timeoutMs)
    })

    await safeLog({
      providerId: "claude-code",
      providerName: "Claude Code",
      model: result.model,
      agentId: "executor",
      taskId: input.taskId,
      runId: input.runId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheTokens: result.cacheTokens,
      durationMs: result.durationMs,
      success: true,
      harness: "claude-code",
      costUsd: result.costUsd,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await safeLog({
      providerId: "claude-code",
      providerName: "Claude Code",
      model: input.config.model.trim() || "default",
      agentId: "executor",
      taskId: input.taskId,
      runId: input.runId,
      inputTokens: Math.ceil(
        (systemPrompt.length + userPrompt.length) / 4
      ),
      outputTokens: 0,
      cacheTokens: 0,
      durationMs: Date.now() - startedAt,
      success: false,
      error: message,
      harness: "claude-code",
      costUsd: 0,
    })
    throw error
  } finally {
    releaseSlot()
  }
}
