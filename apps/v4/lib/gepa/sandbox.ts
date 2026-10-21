import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"

import {
  evaluateBashCommand,
  MAX_COMMAND_LENGTH,
  tokenizeCommand,
} from "./constraints"
import {
  dataPath,
  ensureDir,
  getDataRoot,
  readSettings,
  workspacePath,
} from "./storage"

export interface SandboxResult {
  allowed: boolean
  reason: string
  command: string
  cwd: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  truncated: boolean
}

const TIMEOUT_MIN = 1000
const TIMEOUT_MAX = 600_000
const OUTPUT_MIN = 1024
const OUTPUT_MAX = 10 * 1024 * 1024

const ENV_ALLOWLIST = [
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
]

function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  )
}

function createSandboxEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV }
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key]
    if (typeof value === "string" && value) {
      env[key] = value
    }
  }
  return env
}

interface WorkingDirResult {
  cwd: string
  error?: string
}

function terminateChild(child: ChildProcess): void {
  const forceKill = () => {
    try {
      child.kill("SIGKILL")
    } catch {
      // 忽略终止失败，后续由兜底定时器收尾
    }
  }

  if (process.platform === "win32" && child.pid) {
    try {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
          env: createSandboxEnv(),
        }
      )
      killer.on("error", forceKill)
      killer.on("close", (code) => {
        if (code !== 0) forceKill()
      })
      killer.unref()
      return
    } catch {
      // 继续尝试直接终止
    }
  }

  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL")
      return
    } catch {
      // 进程组不存在时回退到单进程终止
    }
  }

  forceKill()
}

async function resolveWorkingDir(
  taskId?: string,
  requested?: string
): Promise<WorkingDirResult> {
  const root = getDataRoot()

  if (requested && requested.trim()) {
    const cwd = path.resolve(requested.trim())
    if (!isInside(root, cwd)) {
      return { cwd, error: `工作目录必须位于数据根目录内（${root}）。` }
    }
    try {
      const stat = await fs.stat(cwd)
      if (!stat.isDirectory()) {
        return { cwd, error: `工作目录不是目录：${cwd}` }
      }
    } catch {
      return { cwd, error: `工作目录不存在：${cwd}` }
    }
    return { cwd }
  }

  if (taskId) {
    try {
      const cwd = workspacePath(taskId)
      await ensureDir(cwd)
      return { cwd }
    } catch (error) {
      return {
        cwd: "",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const cwd = dataPath("sandbox")
  await ensureDir(cwd)
  return { cwd }
}

export async function runSandboxedCommand(options: {
  command: string
  taskId?: string
  cwd?: string
}): Promise<SandboxResult> {
  const startedAt = Date.now()
  const command = typeof options.command === "string" ? options.command : ""

  const base: SandboxResult = {
    allowed: false,
    reason: "",
    command,
    cwd: "",
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    truncated: false,
  }

  const finishEarly = (reason: string, cwd: string): SandboxResult => ({
    ...base,
    cwd,
    reason,
    durationMs: Date.now() - startedAt,
  })

  if (!command.trim()) {
    return finishEarly("命令为空，请输入要执行的命令。", "")
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return finishEarly(
      `命令过长（${command.length} 字符，上限 ${MAX_COMMAND_LENGTH} 字符）。`,
      ""
    )
  }

  const settings = await readSettings()
  const bash = settings.constraints.bash

  const workingDir = await resolveWorkingDir(options.taskId, options.cwd)
  if (workingDir.error) {
    return finishEarly(workingDir.error, workingDir.cwd)
  }

  const policy = evaluateBashCommand(command, settings.constraints, {
    taskId: options.taskId,
    workspaceDir: workingDir.cwd,
    cwd: workingDir.cwd,
  })
  if (!policy.allowed) {
    return finishEarly(policy.reason, workingDir.cwd)
  }

  const timeoutMs = clamp(bash.timeoutMs, TIMEOUT_MIN, TIMEOUT_MAX, 30_000)
  const maxOutputBytes = clamp(
    bash.maxOutputBytes,
    OUTPUT_MIN,
    OUTPUT_MAX,
    100_000
  )
  const useShell = bash.allowShellOperators
  const tokens = tokenizeCommand(command)
  if (!useShell && tokens.length === 0) {
    return finishEarly("无法解析命令，请检查命令与引号。", workingDir.cwd)
  }

  return await new Promise<SandboxResult>((resolve) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let totalBytes = 0
    let truncated = false
    let timedOut = false
    let settled = false
    let timeoutTimer: NodeJS.Timeout | null = null
    let fallbackTimer: NodeJS.Timeout | null = null

    const spawnOptions: SpawnOptions = {
      cwd: workingDir.cwd,
      windowsHide: true,
      env: createSandboxEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    }

    const child = useShell
      ? spawn(command, { ...spawnOptions, shell: true })
      : spawn(tokens[0], tokens.slice(1), {
          ...spawnOptions,
          shell: false,
        })

    const collect = (target: Buffer[], chunk: Buffer) => {
      if (truncated) return
      const remaining = maxOutputBytes - totalBytes
      if (remaining <= 0) {
        truncated = true
        return
      }
      if (chunk.length > remaining) {
        target.push(chunk.subarray(0, remaining))
        totalBytes = maxOutputBytes
        truncated = true
        return
      }
      target.push(chunk)
      totalBytes += chunk.length
    }

    const settle = (exitCode: number | null, overrideReason?: string) => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (fallbackTimer) clearTimeout(fallbackTimer)

      let reason = overrideReason ?? ""
      if (!reason) {
        if (timedOut) {
          reason = `命令执行超时（超过 ${timeoutMs}ms），已终止。`
        } else if (exitCode === 0) {
          reason = "命令执行成功。"
        } else if (exitCode === null) {
          reason = "命令执行结束，但未获取到退出码。"
        } else {
          reason = `命令执行结束，退出码 ${exitCode}。`
        }
      }
      if (truncated) {
        reason = `${reason} 输出已截断（上限 ${maxOutputBytes} 字节）。`
      }

      resolve({
        allowed: true,
        reason,
        command,
        cwd: workingDir.cwd,
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        durationMs: Date.now() - startedAt,
        truncated,
      })
    }

    child.stdout?.on("data", (chunk: Buffer) => collect(stdoutChunks, chunk))
    child.stderr?.on("data", (chunk: Buffer) => collect(stderrChunks, chunk))
    child.on("error", (error) => {
      settle(null, `命令启动失败：${error.message}`)
    })
    child.on("close", (code) => {
      settle(code)
    })

    timeoutTimer = setTimeout(() => {
      timedOut = true
      terminateChild(child)
      fallbackTimer = setTimeout(() => {
        settle(null, `命令执行超时（超过 ${timeoutMs}ms），已终止。`)
      }, 2000)
    }, timeoutMs)
  })
}
