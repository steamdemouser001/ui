"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BotIcon,
  ListTodoIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiDelete, apiGet, apiPost } from "@/lib/gepa/client"
import type { IterationDefaults, RunStatus, TaskStatus } from "@/lib/gepa/types"
import {
  actionLabel,
  errorText,
  formatClock,
  formatDateTime,
  formatScore,
  percent,
} from "@/components/gepa/tasks/format"
import {
  RunStatusBadge,
  TaskStatusBadge,
} from "@/components/gepa/tasks/status-badge"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/registry/new-york-v4/ui/alert-dialog"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Progress } from "@/registry/new-york-v4/ui/progress"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

const MAX_MESSAGE_LENGTH = 4000

const QUICK_PROMPTS = [
  "列出所有任务",
  "创建一个任务：",
  "启动任务 ",
  "暂停任务 ",
  "停止任务 ",
]

interface ChatAction {
  type: string
  ok?: boolean
  message?: string
  taskId?: string
  name?: string
  description?: string
  datasetText?: string
}

interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  at: string
  actions?: ChatAction[]
}

interface ChatRun {
  id: string
  status: RunStatus
  iteration: number
  budget: number
  budgetUsed: number
  bestScore: number | null
  candidates: number
}

/** 与后端 TaskSummary 对齐；本地定义以避免客户端引入服务端模块。 */
interface ChatTask {
  id: string
  name: string
  description: string
  status: TaskStatus
  modules: number
  dataset: number
  iteration: IterationDefaults
  run: ChatRun | null
  createdAt: string
  updatedAt: string
}

interface ChatLoadResponse {
  messages: ChatMessage[]
  tasks: ChatTask[]
}

interface ChatSendResponse {
  reply: string
  actions: ChatAction[]
  tasks: ChatTask[]
}

function actionTitle(action: ChatAction): string | undefined {
  const title = [action.message, action.taskId ? `任务 ${action.taskId}` : null]
    .filter(Boolean)
    .join(" · ")
  return title || undefined
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <p className="max-w-[90%] rounded-md bg-muted/60 px-3 py-1.5 text-center text-xs text-muted-foreground">
          {message.content}
        </p>
      </div>
    )
  }

  const isUser = message.role === "user"
  const actions = message.actions ?? []

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <BotIcon className="size-4 text-muted-foreground" />
        </div>
      )}
      <div
        className={`max-w-[85%] space-y-2 rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "border bg-muted/40"
        }`}
      >
        <p className="break-words whitespace-pre-wrap">{message.content}</p>

        {actions.length > 0 && (
          <div className="space-y-1 border-t border-current/10 pt-2">
            <div className="flex flex-wrap gap-1.5">
              {actions.map((action, index) => (
                <Badge
                  key={`${action.type}-${index}`}
                  variant={action.ok === false ? "destructive" : "secondary"}
                  title={actionTitle(action)}
                >
                  {actionLabel(action.type)}
                  {action.ok === false ? "失败" : "完成"}
                </Badge>
              ))}
            </div>
            <ul className="space-y-0.5 text-xs opacity-80">
              {actions.map((action, index) => (
                <li
                  key={`${action.type}-detail-${index}`}
                  className="break-words"
                >
                  {actionLabel(action.type)}
                  {action.message ? `：${action.message}` : ""}
                  {action.taskId && (
                    <span className="ml-1 opacity-70">
                      （任务 {action.taskId}）
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p
          className={`text-right text-[10px] ${
            isUser ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}
        >
          {formatClock(message.at)}
        </p>
      </div>
      {isUser && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <UserIcon className="size-4" />
        </div>
      )}
    </div>
  )
}

function TaskContextItem({ task }: { task: ChatTask }) {
  const run = task.run
  const progress = run ? percent(run.budgetUsed, run.budget) : 0
  const href = `/gepa/tasks/${task.id}`

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={href}
          className="min-w-0 truncate text-sm font-medium hover:underline"
        >
          {task.name}
        </Link>
        <TaskStatusBadge status={task.status} />
      </div>

      {task.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {task.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{task.modules} 个模块</span>
        <span>{task.dataset} 条数据</span>
      </div>

      {run ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RunStatusBadge status={run.status} />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {run.iteration} 轮 · {run.budgetUsed}/{run.budget}
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>最佳分 {formatScore(run.bestScore)}</span>
            <span>{run.candidates} 个候选</span>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          尚未运行 · 默认预算 {task.iteration.budget}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>更新于 {formatDateTime(task.updatedAt)}</span>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline"
        >
          打开
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>
    </div>
  )
}

export function GlobalChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [tasks, setTasks] = React.useState<ChatTask[]>([])
  const [input, setInput] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [clearing, setClearing] = React.useState(false)
  const [clearOpen, setClearOpen] = React.useState(false)

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<ChatLoadResponse>("/api/gepa/chat")
      setMessages(data.messages ?? [])
      setTasks(data.tasks ?? [])
    } catch (loadError) {
      setError(errorText(loadError, "加载对话失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [messages, sending])

  const send = React.useCallback(async () => {
    const message = input.trim()
    if (!message) {
      toast.error("请输入消息")
      return
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      toast.error(`消息过长（上限 ${MAX_MESSAGE_LENGTH} 字符）`)
      return
    }
    if (sending) return

    const stamp = Date.now()
    setMessages((current) => [
      ...current,
      {
        id: `local-user-${stamp}`,
        role: "user",
        content: message,
        at: new Date().toISOString(),
      },
    ])
    setSending(true)
    try {
      const data = await apiPost<ChatSendResponse>("/api/gepa/chat", {
        message,
      })
      const actions = data.actions ?? []
      setMessages((current) => [
        ...current,
        {
          id: `local-assistant-${stamp}`,
          role: "assistant",
          content: data.reply,
          at: new Date().toISOString(),
          actions,
        },
      ])
      setTasks(data.tasks ?? [])
      setInput("")
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
    } catch (sendError) {
      toast.error(errorText(sendError, "发送消息失败"))
    } finally {
      setSending(false)
    }
  }, [input, sending])

  async function clearConversation() {
    setClearing(true)
    try {
      await apiDelete<{ cleared: true }>("/api/gepa/chat")
      setMessages([])
      setClearOpen(false)
      toast.success("已清空对话")
    } catch (clearError) {
      toast.error(errorText(clearError, "清空对话失败"))
    } finally {
      setClearing(false)
    }
  }

  function applyQuickPrompt(prompt: string) {
    setInput(prompt)
    textareaRef.current?.focus()
  }

  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="gap-4">
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
        <Card className="gap-4">
          <CardHeader>
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>加载对话失败</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void load()}
          >
            <RefreshCwIcon />
            重试
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-w-0 gap-4">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <MessageSquareIcon className="size-4" />
                全局对话
              </CardTitle>
              <CardDescription>
                调度器拥有全局控制权限，可创建、启动、暂停或删除任意 GEPA 任务。
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearOpen(true)}
              disabled={clearing || sending || messages.length === 0}
            >
              {clearing ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Trash2Icon />
              )}
              清空对话
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => applyQuickPrompt(prompt)}
                disabled={sending}
              >
                {prompt.trim()}
              </Button>
            ))}
          </div>

          <ScrollArea
            ref={scrollRef}
            className="h-[30rem] rounded-lg border bg-background lg:h-[calc(100vh-26rem)] lg:min-h-[24rem]"
          >
            <div className="p-3">
              {messages.length === 0 ? (
                <div className="flex min-h-[24rem] flex-col items-center justify-center gap-2 text-center lg:min-h-[28rem]">
                  <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                    <SparklesIcon className="size-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">开始与全局调度器对话</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    例如：「列出所有任务」「创建一个任务：每日摘要」「启动任务
                    任务名」「暂停任务 任务名」。
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  {sending && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      调度器正在思考…
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="space-y-2">
            <Textarea
              ref={textareaRef}
              rows={3}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  if (!sending) void send()
                }
              }}
              placeholder="输入消息，Ctrl/⌘ + Enter 发送"
              disabled={sending}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className={`text-xs ${
                  input.length > MAX_MESSAGE_LENGTH
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {input.length} / {MAX_MESSAGE_LENGTH} 字符 · 操作按顺序执行
              </p>
              <Button
                onClick={() => void send()}
                disabled={sending || !input.trim()}
              >
                {sending ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SendIcon />
                )}
                发送
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodoIcon className="size-4" />
            任务上下文
          </CardTitle>
          <CardDescription>调度器会读取以下任务。</CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
              <ListTodoIcon className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                暂无任务，可在对话中让调度器创建
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[32rem] lg:max-h-[calc(100vh-20rem)]">
              <div className="space-y-3 pr-2">
                {tasks.map((task) => (
                  <TaskContextItem key={task.id} task={task} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={clearOpen}
        onOpenChange={(open) => {
          if (!clearing) setClearOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空对话</AlertDialogTitle>
            <AlertDialogDescription>
              确定要清空当前对话吗？调度器的对话历史会被删除，已创建的任务与运行记录不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={clearing}
              onClick={(event) => {
                event.preventDefault()
                void clearConversation()
              }}
            >
              {clearing && <Loader2Icon className="animate-spin" />}
              清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
