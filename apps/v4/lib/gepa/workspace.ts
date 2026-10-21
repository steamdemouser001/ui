import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

import { evaluateToolCall } from "./constraints"
import { runSandboxedCommand, type SandboxResult } from "./sandbox"
import { ensureDir, readSettings, workspacePath } from "./storage"

export { workspacePath }

/** 单个文本文件允许读取的最大字节数。 */
export const MAX_WORKSPACE_FILE_BYTES = 512 * 1024
/** 文件树最多返回的条目数。 */
export const MAX_WORKSPACE_ENTRIES = 500
/** 文件树最大递归深度。 */
export const MAX_WORKSPACE_DEPTH = 5

const SKIP_DIRECTORIES = new Set(["node_modules"])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export interface WorkspaceEntry {
  /** 相对工作空间的 POSIX 路径。 */
  path: string
  size: number
  isDirectory: boolean
  updatedAt: string
}

export interface WorkspaceSummary {
  files: number
  directories: number
  totalBytes: number
  updatedAt: string | null
}

/** 路径不合法（为空、绝对路径、包含 .. 或盘符等）。 */
export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkspacePathError"
  }
}

/** 写入被全局约束拒绝。 */
export class WorkspacePolicyError extends Error {
  reason: string

  constructor(reason: string) {
    super(reason)
    this.name = "WorkspacePolicyError"
    this.reason = reason
  }
}

/**
 * 将工作空间内的相对路径解析为绝对路径。
 * 拒绝绝对路径、盘符、UNC、~、空路径、`..` 与冒号（Windows 数据流）。
 */
export function resolveWorkspaceFile(
  taskId: string,
  relativePath: string
): string {
  if (typeof relativePath !== "string") {
    throw new WorkspacePathError("文件路径必须是字符串")
  }
  const raw = relativePath.trim()
  if (!raw) {
    throw new WorkspacePathError("文件路径不能为空")
  }
  if (raw.includes("\0")) {
    throw new WorkspacePathError("文件路径包含非法字符")
  }
  if (/^[a-zA-Z]:/.test(raw)) {
    throw new WorkspacePathError("文件路径不能包含盘符，请使用工作空间内的相对路径")
  }
  if (raw.startsWith("~")) {
    throw new WorkspacePathError("文件路径不能以 ~ 开头")
  }
  if (/^[\\/]/.test(raw)) {
    throw new WorkspacePathError("文件路径必须是工作空间内的相对路径，不能是绝对路径")
  }

  const segments = raw
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== ".")
  if (segments.length === 0) {
    throw new WorkspacePathError("文件路径不能为空")
  }
  if (segments.some((segment) => segment === "..")) {
    throw new WorkspacePathError("文件路径不能包含 ..")
  }
  if (segments.some((segment) => segment.includes(":"))) {
    throw new WorkspacePathError("文件路径包含非法字符「:」")
  }
  if (segments.some((segment) => WINDOWS_RESERVED.test(segment))) {
    throw new WorkspacePathError("文件路径包含 Windows 保留名称")
  }

  const base = workspacePath(taskId)
  const target = path.resolve(base, ...segments)
  const relative = path.relative(base, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WorkspacePathError("文件路径必须位于任务工作空间内")
  }
  return target
}

/**
 * 校验真实路径（解析符号链接后）仍位于工作空间内。
 * 目标尚不存在时向上寻找最近的已存在祖先。
 */
async function assertRealPathInside(
  base: string,
  target: string
): Promise<void> {
  let realBase: string
  try {
    realBase = await fs.realpath(base)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }

  let probe = target
  for (let depth = 0; depth < 64; depth += 1) {
    let real: string
    try {
      real = await fs.realpath(probe)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      const parent = path.dirname(probe)
      if (parent === probe) return
      probe = parent
      continue
    }
    const relative = path.relative(realBase, real)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new WorkspacePathError("文件路径必须位于任务工作空间内")
    }
    return
  }
}

/**
 * 递归列出工作空间文件。跳过 node_modules 与符号链接，
 * 最多 500 条、深度 5 层，按路径字典序返回。
 */
export async function listWorkspaceFiles(
  taskId: string
): Promise<WorkspaceEntry[]> {
  const base = workspacePath(taskId)
  const entries: WorkspaceEntry[] = []

  const walk = async (
    dir: string,
    relativeDir: string,
    depth: number
  ): Promise<void> => {
    if (entries.length >= MAX_WORKSPACE_ENTRIES) return
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name))

    for (const dirent of dirents) {
      if (entries.length >= MAX_WORKSPACE_ENTRIES) return
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory() && SKIP_DIRECTORIES.has(dirent.name)) continue

      const relative = relativeDir
        ? `${relativeDir}/${dirent.name}`
        : dirent.name
      const absolute = path.join(dir, dirent.name)
      let stat
      try {
        stat = await fs.lstat(absolute)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        entries.push({
          path: relative,
          size: 0,
          isDirectory: true,
          updatedAt: stat.mtime.toISOString(),
        })
        if (depth + 1 < MAX_WORKSPACE_DEPTH) {
          await walk(absolute, relative, depth + 1)
        }
      } else if (stat.isFile()) {
        entries.push({
          path: relative,
          size: stat.size,
          isDirectory: false,
          updatedAt: stat.mtime.toISOString(),
        })
      }
    }
  }

  await walk(base, "", 0)
  return entries
}

/** 读取工作空间内的文本文件（≤512KB）。 */
export async function readWorkspaceFile(
  taskId: string,
  relativePath: string
): Promise<string> {
  const base = workspacePath(taskId)
  const target = resolveWorkspaceFile(taskId, relativePath)
  await assertRealPathInside(base, target)

  let stat
  try {
    stat = await fs.stat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorkspacePathError(`文件不存在：${relativePath}`)
    }
    throw error
  }
  if (stat.isDirectory()) {
    throw new WorkspacePathError(`目标是目录，无法作为文件读取：${relativePath}`)
  }
  if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
    throw new WorkspacePathError(
      `文件过大（${stat.size} 字节），仅支持读取 ${MAX_WORKSPACE_FILE_BYTES} 字节以内的文本文件`
    )
  }
  return fs.readFile(target, "utf8")
}

/**
 * 写入工作空间内的文本文件。先经过全局工具约束校验，
 * 通过后使用「临时文件 + rename」原子写入。
 */
export async function writeWorkspaceFile(
  taskId: string,
  relativePath: string,
  content: string
): Promise<void> {
  if (typeof content !== "string") {
    throw new Error("文件内容必须是字符串")
  }

  const settings = await readSettings()
  const policy = evaluateToolCall("write_file", settings.constraints, {
    taskId,
    path: relativePath,
    destructive: true,
  })
  if (!policy.allowed) {
    throw new WorkspacePolicyError(policy.reason)
  }

  const base = workspacePath(taskId)
  const target = resolveWorkspaceFile(taskId, relativePath)
  await ensureDir(base)
  await assertRealPathInside(base, target)
  await ensureDir(path.dirname(target))

  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, content, "utf8")
    await fs.rename(temp, target)
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined)
    throw error
  }
}

/** 在任务工作空间内执行受约束的沙箱命令。 */
export async function runWorkspaceCommand(
  taskId: string,
  command: string
): Promise<SandboxResult> {
  return runSandboxedCommand({ command, taskId })
}

/** 统计工作空间文件数、总大小与最近修改时间。 */
export async function workspaceSummary(
  taskId: string
): Promise<WorkspaceSummary> {
  const entries = await listWorkspaceFiles(taskId)
  let files = 0
  let directories = 0
  let totalBytes = 0
  let updatedAt: string | null = null

  for (const entry of entries) {
    if (entry.isDirectory) {
      directories += 1
    } else {
      files += 1
      totalBytes += entry.size
    }
    if (!updatedAt || entry.updatedAt > updatedAt) {
      updatedAt = entry.updatedAt
    }
  }

  return { files, directories, totalBytes, updatedAt }
}
