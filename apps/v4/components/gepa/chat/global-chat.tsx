"use client"

import * as React from "react"
import { cn } from "cn"
import {
  AlertCircleIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiStream,
  type SseEvent,
} from "@/lib/gepa/client"
import type { ChatSessionMeta } from "@/lib/gepa/types"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Card } from "@/registry/new-york-v4/ui/card"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

import { errorText } from "../tasks/format"
import { ChatHistory } from "./chat-history"
import { ChatMessageBubble } from "./chat-message"
import { ChatTaskContext } from "./chat-task-context"
import {
  emptyRuntime,
  type ChatAction,
  type ChatDonePayload,
  type ChatMessage,
  type ChatTask,
  type SessionDetailResponse,
  type SessionRuntime,
  type SessionsResponse,
} from "./types"

const MAX_MESSAGE_LENGTH = 4000
const TABS_STORAGE_KEY = "gepa-chat-tabs-v1"
const TASK_REFRESH_MS = 5000
const SESSION_REFRESH_MS = 15000

const QUICK_PROMPTS = [
  "列出所有任务",
  "创建一个任务：",
  "启动任务 ",
  "暂停任务 ",
  "停止任务 ",
]

interface StoredTabs {
  open: string[]
  active: string | null
}

function readStoredTabs(): StoredTabs {
  if (typeof window === "undefined") return { open: [], active: null }
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY)
    if (!raw) return { open: [], active: null }
    const parsed = JSON.parse(raw) as Partial<StoredTabs>
    return {
      open: Array.isArray(parsed.open)
        ? parsed.open.filter((id): id is string => typeof id === "string")
        : [],
      active: typeof parsed.active === "string" ? parsed.active : null,
    }
  } catch {
    return { open: [], active: null }
  }
}

function writeStoredTabs(state: StoredTabs): void {
  try {
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式或存储已满时忽略
  }
}

function patchRuntime(
  states: Record<string, SessionRuntime>,
  id: string,
  patch: Partial<SessionRuntime>
): Record<string, SessionRuntime> {
  const current = states[id] ?? emptyRuntime()
  return { ...states, [id]: { ...current, ...patch } }
}

function ChatTabs({
  sessions,
  activeId,
  streamingIds,
  creating,
  onSelect,
  onClose,
  onNew,
}: {
  sessions: ChatSessionMeta[]
  activeId: string | null
  streamingIds: Set<string>
  creating: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}) {
  if (sessions.length === 0) return null

  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1">
      {sessions.map((session) => {
        const active = session.id === activeId
        return (
          <div
            key={session.id}
            className={cn(
              "group flex h-8 max-w-56 min-w-0 shrink-0 items-center gap-1 rounded-md px-2 text-sm transition-colors",
              active
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:bg-background/60"
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
              onClick={() => onSelect(session.id)}
              title={session.title}
            >
              {streamingIds.has(session.id) ? (
                <Loader2Icon className="size-3 shrink-0 animate-spin text-primary" />
              ) : (
                <MessageSquareIcon className="size-3 shrink-0 opacity-60" />
              )}
              <span className="truncate">{session.title}</span>
            </button>
            <button
              type="button"
              className="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-100 transition-opacity hover:bg-muted sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
              onClick={() => onClose(session.id)}
              aria-label={`关闭 ${session.title}`}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )
      })}
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0"
        onClick={onNew}
        disabled={creating}
        aria-label="新建对话"
      >
        {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
      </Button>
    </div>
  )
}

function ChatEmptyState({
  hasSessions,
  creating,
  onNew,
}: {
  hasSessions: boolean
  creating: boolean
  onNew: () => void
}) {
  return (
    <div className="flex min-h-[26rem] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <SparklesIcon className="size-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">
        {hasSessions ? "从历史记录打开一个会话" : "还没有任何对话"}
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        {hasSessions
          ? "在左侧历史记录中选择会话，或新建一个会话。已打开的会话会保留在标签页中。"
          : "新建会话后即可与全局调度器交流。支持同时打开多个会话，在标签页之间切换不会丢失生成进度。"}
      </p>
      <Button onClick={onNew} disabled={creating}>
        {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
        新建对话
      </Button>
    </div>
  )
}

export function GlobalChat() {
  const [sessions, setSessions] = React.useState<ChatSessionMeta[]>([])
  const [sessionsLoading, setSessionsLoading] = React.useState(true)
  const [sessionsError, setSessionsError] = React.useState<string | null>(null)
  const [tasks, setTasks] = React.useState<ChatTask[]>([])
  const [openIds, setOpenIds] = React.useState<string[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [runtimes, setRuntimes] = React.useState<
    Record<string, SessionRuntime>
  >({})
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [creating, setCreating] = React.useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = React.useState(false)
  const [bootstrapDone, setBootstrapDone] = React.useState(false)

  const abortRef = React.useRef(new Map<string, AbortController>())
  const loadingRef = React.useRef(new Set<string>())
  const runtimesRef = React.useRef(runtimes)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  React.useEffect(() => {
    runtimesRef.current = runtimes
  }, [runtimes])

  const activeSession =
    sessions.find((session) => session.id === activeId) ?? null
  const activeRuntime = activeId ? runtimes[activeId] : undefined
  const openSessions = openIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is ChatSessionMeta => Boolean(session))
  const streamingIds = new Set(
    openSessions
      .filter((session) => runtimes[session.id]?.streaming)
      .map((session) => session.id)
  )
  const draft = activeId ? (drafts[activeId] ?? "") : ""
  const overLimit = draft.length > MAX_MESSAGE_LENGTH

  const loadSession = React.useCallback(async (id: string) => {
    if (loadingRef.current.has(id)) return
    loadingRef.current.add(id)
    setRuntimes((prev) =>
      patchRuntime(prev, id, { loading: true, error: null })
    )

    try {
      const data = await apiGet<SessionDetailResponse>(
        `/api/gepa/chat/sessions/${id}`
      )
      setRuntimes((prev) => {
        const current = prev[id] ?? emptyRuntime()
        if (current.streaming) {
          return patchRuntime(prev, id, {
            loaded: true,
            loading: false,
            error: null,
          })
        }
        return patchRuntime(prev, id, {
          loaded: true,
          loading: false,
          error: null,
          messages: data.messages ?? [],
        })
      })
      setTasks(data.tasks ?? [])
      setSessions((prev) =>
        prev.map((session) => (session.id === id ? data.session : session))
      )
    } catch (error) {
      setRuntimes((prev) =>
        patchRuntime(prev, id, {
          loading: false,
          error: errorText(error, "加载会话失败"),
        })
      )
    } finally {
      loadingRef.current.delete(id)
    }
  }, [])

  const bootstrap = React.useCallback(async () => {
    setSessionsLoading(true)
    setSessionsError(null)
    try {
      const data = await apiGet<SessionsResponse>("/api/gepa/chat/sessions")
      const loadedSessions = data.sessions ?? []
      setSessions(loadedSessions)
      setTasks(data.tasks ?? [])

      const stored = readStoredTabs()
      const existing = new Set(loadedSessions.map((session) => session.id))
      let open = stored.open.filter((id) => existing.has(id))
      let active =
        stored.active && open.includes(stored.active)
          ? stored.active
          : (open[0] ?? null)
      if (!active && loadedSessions[0]) {
        open = [loadedSessions[0].id]
        active = loadedSessions[0].id
      }

      setOpenIds(open)
      setActiveId(active)
      setBootstrapDone(true)
      if (active) void loadSession(active)
    } catch (error) {
      setSessionsError(errorText(error, "加载会话列表失败"))
    } finally {
      setSessionsLoading(false)
    }
  }, [loadSession])

  React.useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  React.useEffect(() => {
    if (!bootstrapDone) return
    writeStoredTabs({ open: openIds, active: activeId })
  }, [bootstrapDone, openIds, activeId])

  // 其他标签页删除会话后，关闭本地已失效的标签并切换到可用会话。
  React.useEffect(() => {
    if (!bootstrapDone) return
    const existing = new Set(sessions.map((session) => session.id))
    const validOpen = openIds.filter((id) => existing.has(id))
    if (validOpen.length === openIds.length) return
    setOpenIds(validOpen)
    if (activeId && !existing.has(activeId)) {
      setActiveId(validOpen[0] ?? null)
    }
  }, [bootstrapDone, sessions, openIds, activeId])

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      void apiGet<{ tasks: ChatTask[] }>("/api/gepa/tasks")
        .then((data) => setTasks(data.tasks ?? []))
        .catch(() => undefined)
    }, TASK_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      void apiGet<SessionsResponse>("/api/gepa/chat/sessions")
        .then((data) => setSessions(data.sessions ?? []))
        .catch(() => undefined)
    }, SESSION_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [activeId, activeRuntime?.messages, activeRuntime?.streaming])

  const openSession = React.useCallback(
    (id: string) => {
      setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      setActiveId(id)
      setMobileHistoryOpen(false)
      const runtime = runtimesRef.current[id]
      if (!runtime?.loaded && !loadingRef.current.has(id)) {
        void loadSession(id)
      }
    },
    [loadSession]
  )

  const createSession =
    React.useCallback(async (): Promise<ChatSessionMeta | null> => {
      setCreating(true)
      try {
        const data = await apiPost<{ session: ChatSessionMeta }>(
          "/api/gepa/chat/sessions",
          {}
        )
        const session = data.session
        setSessions((prev) => [
          session,
          ...prev.filter((item) => item.id !== session.id),
        ])
        setOpenIds((prev) =>
          prev.includes(session.id) ? prev : [...prev, session.id]
        )
        setActiveId(session.id)
        setRuntimes((prev) => ({ ...prev, [session.id]: emptyRuntime(true) }))
        setMobileHistoryOpen(false)
        return session
      } catch (error) {
        toast.error(errorText(error, "新建会话失败"))
        return null
      } finally {
        setCreating(false)
      }
    }, [])

  function closeTab(id: string) {
    const index = openIds.indexOf(id)
    const next = openIds.filter((item) => item !== id)
    setOpenIds(next)
    if (activeId === id) {
      setActiveId(next[Math.min(index, next.length - 1)] ?? null)
    }
  }

  async function renameSession(id: string, title: string): Promise<boolean> {
    try {
      const data = await apiPatch<{ session: ChatSessionMeta }>(
        `/api/gepa/chat/sessions/${id}`,
        { title }
      )
      setSessions((prev) =>
        prev.map((session) => (session.id === id ? data.session : session))
      )
      toast.success("已重命名会话")
      return true
    } catch (error) {
      toast.error(errorText(error, "重命名失败"))
      return false
    }
  }

  async function clearSession(id: string): Promise<boolean> {
    try {
      const data = await apiPost<{ session: ChatSessionMeta }>(
        `/api/gepa/chat/sessions/${id}/clear`
      )
      setSessions((prev) =>
        prev.map((session) => (session.id === id ? data.session : session))
      )
      setRuntimes((prev) =>
        patchRuntime(prev, id, { messages: [], loaded: true, error: null })
      )
      toast.success("已清空会话消息")
      return true
    } catch (error) {
      toast.error(errorText(error, "清空失败"))
      return false
    }
  }

  async function deleteSession(id: string): Promise<boolean> {
    try {
      await apiDelete<{ deleted: boolean }>(`/api/gepa/chat/sessions/${id}`)
      setSessions((prev) => prev.filter((session) => session.id !== id))

      const index = openIds.indexOf(id)
      const next = openIds.filter((item) => item !== id)
      setOpenIds(next)
      if (activeId === id) {
        setActiveId(next[Math.min(index, next.length - 1)] ?? null)
      }
      setRuntimes((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      setDrafts((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      toast.success("已删除会话")
      return true
    } catch (error) {
      toast.error(errorText(error, "删除失败"))
      return false
    }
  }

  const refreshSessions = React.useCallback(async () => {
    try {
      const data = await apiGet<SessionsResponse>("/api/gepa/chat/sessions")
      setSessions(data.sessions ?? [])
    } catch {
      // 静默刷新失败不影响当前对话
    }
  }, [])

  const send = React.useCallback(
    async (raw?: string) => {
      const text = (raw ?? (activeId ? (drafts[activeId] ?? "") : "")).trim()
      if (!text) {
        toast.error("请输入消息")
        return
      }
      if (text.length > MAX_MESSAGE_LENGTH) {
        toast.error(`消息过长（上限 ${MAX_MESSAGE_LENGTH} 字符）`)
        return
      }

      let targetId = activeId
      if (!targetId) {
        const created = await createSession()
        if (!created) return
        targetId = created.id
      }
      if (runtimesRef.current[targetId]?.streaming) {
        toast.info("当前会话正在生成，请稍候或先停止")
        return
      }

      const sessionId = targetId
      const stamp = Date.now()
      const assistantId = `local-assistant-${stamp}`
      const now = new Date().toISOString()
      const userMessage: ChatMessage = {
        id: `local-user-${stamp}`,
        role: "user",
        content: text,
        at: now,
      }
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        at: now,
        streaming: true,
      }

      setRuntimes((prev) => {
        const current = prev[sessionId] ?? emptyRuntime(true)
        return {
          ...prev,
          [sessionId]: {
            ...current,
            loaded: true,
            messages: [...current.messages, userMessage, assistantMessage],
            streaming: true,
            status: "正在思考…",
            streamError: null,
          },
        }
      })
      setDrafts((prev) => ({ ...prev, [sessionId]: "" }))

      const controller = new AbortController()
      abortRef.current.set(sessionId, controller)

      let content = ""
      let reasoning = ""
      let actions: ChatAction[] = []
      let streamError: string | null = null

      const updateAssistant = (
        updater: (message: ChatMessage) => ChatMessage
      ) => {
        setRuntimes((prev) => {
          const current = prev[sessionId]
          if (!current) return prev
          return {
            ...prev,
            [sessionId]: {
              ...current,
              messages: current.messages.map((message) =>
                message.id === assistantId ? updater(message) : message
              ),
            },
          }
        })
      }

      const handleEvent = (event: SseEvent) => {
        if (event.event === "reasoning") {
          const data = event.data as { delta?: string }
          if (data.delta) {
            reasoning += data.delta
            updateAssistant((message) => ({ ...message, reasoning }))
          }
          return
        }
        if (event.event === "delta") {
          const data = event.data as { delta?: string }
          if (data.delta) {
            content += data.delta
            updateAssistant((message) => ({ ...message, content }))
          }
          return
        }
        if (event.event === "status") {
          const data = event.data as { status?: string }
          setRuntimes((prev) =>
            patchRuntime(prev, sessionId, { status: data.status ?? null })
          )
          return
        }
        if (event.event === "action") {
          const data = event.data as { action?: ChatAction }
          if (data.action) {
            actions = [...actions, data.action]
            updateAssistant((message) => ({ ...message, actions }))
          }
          return
        }
        if (event.event === "done") {
          const data = event.data as ChatDonePayload
          if (typeof data.reply === "string" && data.reply) {
            content = data.reply
          }
          if (Array.isArray(data.actions)) actions = data.actions
          if (Array.isArray(data.tasks)) setTasks(data.tasks)
          updateAssistant((message) => ({
            ...message,
            content,
            actions,
            streaming: false,
          }))
          return
        }
        if (event.event === "error") {
          const data = event.data as { message?: string }
          streamError = data.message ?? "流式请求失败"
        }
      }

      try {
        await apiStream(
          `/api/gepa/chat/sessions/${sessionId}/stream`,
          { message: text },
          handleEvent,
          controller.signal
        )
        if (streamError) throw new Error(streamError)
        updateAssistant((message) => ({
          ...message,
          content,
          actions,
          streaming: false,
        }))
        if (actions.length > 0) {
          const failed = actions.filter((action) => action.ok === false)
          if (failed.length > 0) {
            toast.warning(
              `已执行 ${actions.length} 个操作，其中 ${failed.length} 个失败`
            )
          } else {
            toast.success(`已执行 ${actions.length} 个操作`)
          }
        }
        void refreshSessions()
      } catch (error) {
        if (controller.signal.aborted) {
          updateAssistant((message) => ({
            ...message,
            streaming: false,
            content: content || "（已停止生成）",
          }))
          toast.info("已停止生成")
        } else {
          const message = errorText(error, "发送消息失败")
          updateAssistant((item) => ({
            ...item,
            streaming: false,
            content: content || `请求失败：${message}`,
          }))
          toast.error(message)
        }
      } finally {
        abortRef.current.delete(sessionId)
        setRuntimes((prev) =>
          patchRuntime(prev, sessionId, { streaming: false, status: null })
        )
      }
    },
    [activeId, createSession, drafts, refreshSessions]
  )

  function stopGeneration() {
    if (!activeId) return
    abortRef.current.get(activeId)?.abort()
  }

  function applyQuickPrompt(prompt: string) {
    if (!activeId) {
      void createSession().then((session) => {
        if (session) {
          setDrafts((prev) => ({ ...prev, [session.id]: prompt }))
        }
        textareaRef.current?.focus()
      })
      return
    }
    setDrafts((prev) => ({ ...prev, [activeId]: prompt }))
    textareaRef.current?.focus()
  }

  if (sessionsLoading && sessions.length === 0) {
    return (
      <div className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        <Skeleton className="hidden h-full min-h-80 rounded-xl lg:block" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-[30rem] w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="hidden h-full min-h-80 rounded-xl xl:block" />
      </div>
    )
  }

  if (sessionsError && sessions.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>加载会话失败</AlertTitle>
        <AlertDescription>
          <p>{sessionsError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void bootstrap()}
          >
            <RefreshCwIcon />
            重试
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const historyProps = {
    sessions,
    activeId,
    openIds,
    loading: sessionsLoading,
    error: sessionsError,
    onOpen: openSession,
    onNew: () => void createSession(),
    onRename: renameSession,
    onClear: clearSession,
    onDelete: deleteSession,
    onRetry: () => void bootstrap(),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMobileHistoryOpen((value) => !value)}
        >
          <HistoryIcon />
          历史记录
        </Button>
        <Button
          size="sm"
          onClick={() => void createSession()}
          disabled={creating}
        >
          {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          新对话
        </Button>
      </div>

      {mobileHistoryOpen && (
        <ChatHistory className="h-72 shrink-0 lg:hidden" {...historyProps} />
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <ChatHistory
          className="hidden w-64 shrink-0 lg:flex"
          {...historyProps}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <ChatTabs
            sessions={openSessions}
            activeId={activeId}
            streamingIds={streamingIds}
            creating={creating}
            onSelect={openSession}
            onClose={closeTab}
            onNew={() => void createSession()}
          />

          <Card className="min-h-0 flex-1 gap-0 overflow-hidden py-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">
                    {activeSession?.title ?? "全局对话"}
                  </p>
                  {activeRuntime?.streaming && (
                    <Badge
                      variant="secondary"
                      className="gap-1 text-[10px] font-normal"
                    >
                      <Loader2Icon className="size-3 animate-spin" />
                      流式生成中
                    </Badge>
                  )}
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  {activeRuntime?.status ??
                    (activeSession
                      ? `${activeSession.messageCount} 条消息`
                      : "新建会话后开始对话")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {activeRuntime?.streaming ? (
                  <Button variant="outline" size="sm" onClick={stopGeneration}>
                    <SquareIcon />
                    停止
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => activeId && void loadSession(activeId)}
                    disabled={!activeId || activeRuntime?.loading}
                  >
                    <RefreshCwIcon
                      className={
                        activeRuntime?.loading ? "animate-spin" : undefined
                      }
                    />
                    刷新
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b px-4 py-2">
              {QUICK_PROMPTS.map((prompt) => (
                <Button
                  key={prompt}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => applyQuickPrompt(prompt)}
                  disabled={Boolean(activeRuntime?.streaming) || creating}
                >
                  {prompt.trim()}
                </Button>
              ))}
            </div>

            <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
              <div className="p-4">
                {!activeId ? (
                  <ChatEmptyState
                    hasSessions={sessions.length > 0}
                    creating={creating}
                    onNew={() => void createSession()}
                  />
                ) : activeRuntime?.loading && !activeRuntime.loaded ? (
                  <div className="space-y-4">
                    <Skeleton className="ml-auto h-16 w-2/3" />
                    <Skeleton className="h-24 w-3/4" />
                    <Skeleton className="ml-auto h-12 w-1/2" />
                  </div>
                ) : activeRuntime?.error ? (
                  <div className="flex flex-col items-center gap-2 py-16 text-center">
                    <AlertCircleIcon className="size-6 text-destructive" />
                    <p className="text-sm text-muted-foreground">
                      {activeRuntime.error}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => activeId && void loadSession(activeId)}
                    >
                      <RefreshCwIcon />
                      重试
                    </Button>
                  </div>
                ) : (activeRuntime?.messages.length ?? 0) === 0 ? (
                  <div className="flex min-h-[24rem] flex-col items-center justify-center gap-2 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                      <SparklesIcon className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">开始与全局调度器对话</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      例如：「列出所有任务」「创建一个任务：每日摘要」「启动任务
                      任务名」「暂停任务 任务名」。回复会流式输出并实时显示。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeRuntime?.messages.map((message) => (
                      <ChatMessageBubble key={message.id} message={message} />
                    ))}
                    {activeRuntime?.streaming && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        {activeRuntime.status ?? "调度器正在思考…"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="border-t p-3">
              <Textarea
                ref={textareaRef}
                rows={3}
                value={draft}
                onChange={(event) => {
                  if (!activeId) return
                  const value = event.target.value
                  setDrafts((prev) => ({ ...prev, [activeId]: value }))
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    if (!activeRuntime?.streaming) void send()
                  }
                }}
                placeholder={
                  activeId
                    ? "输入消息，Enter 发送，Shift + Enter 换行"
                    : "先新建或打开一个会话"
                }
                disabled={!activeId || Boolean(activeRuntime?.streaming)}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p
                  className={cn(
                    "text-xs",
                    overLimit ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {draft.length} / {MAX_MESSAGE_LENGTH} 字符 ·
                  流式输出，实时显示
                </p>
                <Button
                  onClick={() => void send()}
                  disabled={
                    !activeId ||
                    Boolean(activeRuntime?.streaming) ||
                    !draft.trim() ||
                    overLimit
                  }
                >
                  {activeRuntime?.streaming ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <SendIcon />
                  )}
                  发送
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <ChatTaskContext
          tasks={tasks}
          className="hidden w-72 shrink-0 xl:flex"
        />
      </div>
    </div>
  )
}
