import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"

import {
  appendJsonl,
  assertSafeId,
  dataPath,
  ensureDir,
  readJson,
  readJsonl,
  withLock,
  writeJson,
} from "./storage"
import type { ChatSessionMeta, OrchestratorMessage } from "./types"

const INDEX_FILE = "config/chat-sessions.json"
const SESSION_DIR = "config/chat-sessions"
const LEGACY_CHAT_FILE = "config/chat.jsonl"
const INDEX_LOCK = "chat-sessions-index"

const DEFAULT_TITLE = "新对话"
const MAX_TITLE_LENGTH = 60
const MAX_PREVIEW_LENGTH = 90
const AUTO_TITLE_LENGTH = 24

function nowIso(): string {
  return new Date().toISOString()
}

function sessionFile(id: string): string {
  return path.posix.join(SESSION_DIR, `${id}.jsonl`)
}

function normalizeTitle(value: unknown): string {
  const text =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
  if (!text) return DEFAULT_TITLE
  return text.length > MAX_TITLE_LENGTH
    ? `${text.slice(0, MAX_TITLE_LENGTH)}…`
    : text
}

function deriveTitle(content: string): string {
  const text = content.replace(/\s+/g, " ").trim()
  if (!text) return DEFAULT_TITLE
  return text.length > AUTO_TITLE_LENGTH
    ? `${text.slice(0, AUTO_TITLE_LENGTH)}…`
    : text
}

function previewOf(message: OrchestratorMessage): string {
  const text = message.content.replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > MAX_PREVIEW_LENGTH
    ? `${text.slice(0, MAX_PREVIEW_LENGTH)}…`
    : text
}

function isSessionMeta(value: unknown): value is ChatSessionMeta {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  )
}

function normalizeMeta(meta: ChatSessionMeta): ChatSessionMeta {
  return {
    id: meta.id,
    title: normalizeTitle(meta.title),
    titleAuto: meta.titleAuto !== false,
    preview: typeof meta.preview === "string" ? meta.preview : "",
    messageCount:
      typeof meta.messageCount === "number" &&
      Number.isFinite(meta.messageCount)
        ? Math.max(0, Math.trunc(meta.messageCount))
        : 0,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

function sortSessions(sessions: ChatSessionMeta[]): ChatSessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function metaFromMessages(
  id: string,
  messages: OrchestratorMessage[]
): ChatSessionMeta {
  const firstUser = messages.find((message) => message.role === "user")
  const last = messages[messages.length - 1]
  const createdAt = messages[0]?.at ?? nowIso()
  return {
    id,
    title: firstUser ? deriveTitle(firstUser.content) : DEFAULT_TITLE,
    titleAuto: true,
    preview: last ? previewOf(last) : "",
    messageCount: messages.length,
    createdAt,
    updatedAt: last?.at ?? createdAt,
  }
}

async function readIndex(): Promise<ChatSessionMeta[]> {
  const stored = await readJson<unknown>(INDEX_FILE, [])
  if (!Array.isArray(stored)) return []
  return stored.filter(isSessionMeta).map(normalizeMeta)
}

async function writeIndex(sessions: ChatSessionMeta[]): Promise<void> {
  await writeJson(INDEX_FILE, sortSessions(sessions))
}

async function listSessionIds(): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dataPath(SESSION_DIR), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name.slice(0, -".jsonl".length))
    .filter((id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
}

async function indexExists(): Promise<boolean> {
  try {
    await fs.access(dataPath(INDEX_FILE))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

/**
 * 读取会话索引，并修复两类历史数据：索引缺失的会话文件、旧版单一对话文件。
 * 迁移只发生一次，写入索引后不再重复。
 */
export async function ensureChatSessions(): Promise<ChatSessionMeta[]> {
  return withLock(INDEX_LOCK, async () => {
    const hasIndex = await indexExists()
    const sessions = await readIndex()
    const known = new Set(sessions.map((session) => session.id))
    let changed = false

    for (const id of await listSessionIds()) {
      if (known.has(id)) continue
      const messages = await readJsonl<OrchestratorMessage>(
        sessionFile(id)
      ).catch(() => [] as OrchestratorMessage[])
      sessions.push(metaFromMessages(id, messages))
      known.add(id)
      changed = true
    }

    // 只在索引从未建立时迁移旧版单一对话；用户删空会话后不再复活历史。
    if (!hasIndex && sessions.length === 0) {
      const legacy = await readJsonl<OrchestratorMessage>(
        LEGACY_CHAT_FILE
      ).catch(() => [] as OrchestratorMessage[])
      if (legacy.length > 0) {
        const id = randomUUID()
        for (const message of legacy) {
          await appendJsonl(sessionFile(id), message)
        }
        sessions.push(metaFromMessages(id, legacy))
        changed = true
      }
    }

    if (changed || !hasIndex) await writeIndex(sessions)
    return sortSessions(sessions)
  })
}

export async function listChatSessions(): Promise<ChatSessionMeta[]> {
  return ensureChatSessions()
}

export async function readChatSession(
  id: string
): Promise<ChatSessionMeta | null> {
  const safeId = assertSafeId(id, "sessionId")
  const sessions = await ensureChatSessions()
  return sessions.find((session) => session.id === safeId) ?? null
}

export async function readChatSessionMessages(
  id: string,
  limit?: number
): Promise<OrchestratorMessage[]> {
  const safeId = assertSafeId(id, "sessionId")
  return readJsonl<OrchestratorMessage>(sessionFile(safeId), limit)
}

export async function createChatSession(
  title?: string
): Promise<ChatSessionMeta> {
  await ensureChatSessions()
  const id = randomUUID()
  const createdAt = nowIso()
  const hasTitle = typeof title === "string" && title.trim().length > 0
  const meta: ChatSessionMeta = {
    id,
    title: hasTitle ? normalizeTitle(title) : DEFAULT_TITLE,
    titleAuto: !hasTitle,
    preview: "",
    messageCount: 0,
    createdAt,
    updatedAt: createdAt,
  }

  await withLock(INDEX_LOCK, async () => {
    const sessions = await readIndex()
    sessions.push(meta)
    await writeIndex(sessions)
  })

  const file = dataPath(sessionFile(id))
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, "", "utf8")
  return meta
}

export async function appendChatSessionMessage(
  id: string,
  message: OrchestratorMessage
): Promise<ChatSessionMeta> {
  const safeId = assertSafeId(id, "sessionId")
  await ensureChatSessions()

  return withLock(INDEX_LOCK, async () => {
    const sessions = await readIndex()
    const index = sessions.findIndex((session) => session.id === safeId)
    if (index === -1) {
      throw new Error("会话不存在或已被删除")
    }

    await appendJsonl(sessionFile(safeId), message)

    const current = sessions[index]
    const next: ChatSessionMeta = {
      ...current,
      messageCount: current.messageCount + 1,
      preview: previewOf(message),
      updatedAt: message.at || nowIso(),
    }
    if (
      current.titleAuto &&
      message.role === "user" &&
      (!current.title || current.title === DEFAULT_TITLE)
    ) {
      next.title = deriveTitle(message.content)
    }

    sessions[index] = next
    await writeIndex(sessions)
    return next
  })
}

export async function renameChatSession(
  id: string,
  title: string
): Promise<ChatSessionMeta> {
  const safeId = assertSafeId(id, "sessionId")
  await ensureChatSessions()

  return withLock(INDEX_LOCK, async () => {
    const sessions = await readIndex()
    const index = sessions.findIndex((session) => session.id === safeId)
    if (index === -1) {
      throw new Error("会话不存在或已被删除")
    }
    const next: ChatSessionMeta = {
      ...sessions[index],
      title: normalizeTitle(title),
      titleAuto: false,
    }
    sessions[index] = next
    await writeIndex(sessions)
    return next
  })
}

export async function clearChatSession(id: string): Promise<ChatSessionMeta> {
  const safeId = assertSafeId(id, "sessionId")
  await ensureChatSessions()

  return withLock(INDEX_LOCK, async () => {
    const sessions = await readIndex()
    const index = sessions.findIndex((session) => session.id === safeId)
    if (index === -1) {
      throw new Error("会话不存在或已被删除")
    }

    const file = dataPath(sessionFile(safeId))
    await ensureDir(path.dirname(file))
    await fs.writeFile(file, "", "utf8")

    const current = sessions[index]
    const next: ChatSessionMeta = {
      ...current,
      title: current.titleAuto ? DEFAULT_TITLE : current.title,
      preview: "",
      messageCount: 0,
    }
    sessions[index] = next
    await writeIndex(sessions)
    return next
  })
}

export async function deleteChatSession(id: string): Promise<void> {
  const safeId = assertSafeId(id, "sessionId")
  await ensureChatSessions()

  await withLock(INDEX_LOCK, async () => {
    const sessions = await readIndex()
    await writeIndex(sessions.filter((session) => session.id !== safeId))
  })

  await fs.rm(dataPath(sessionFile(safeId)), { force: true })
}

export async function ensureDefaultChatSession(): Promise<ChatSessionMeta> {
  const sessions = await ensureChatSessions()
  if (sessions.length > 0) return sessions[0]
  return createChatSession()
}
