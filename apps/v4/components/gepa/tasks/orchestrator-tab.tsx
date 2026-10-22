"use client"

import * as React from "react"
import {
  BotIcon,
  Loader2Icon,
  MessageSquareIcon,
  SendIcon,
  SquareIcon,
  UserIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiStream, type SseEvent } from "@/lib/gepa/client"
import type { OrchestratorMessage } from "@/lib/gepa/types"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

import { ReasoningBlock } from "../chat/chat-message"
import { actionLabel, errorText, formatClock } from "./format"
import {
  messageActions,
  type ActionResult,
  type OrchestratorResponse,
} from "./types"

const QUICK_ACTIONS = [
  { label: "开始", message: "开始运行" },
  { label: "暂停", message: "暂停运行" },
  { label: "继续", message: "继续运行" },
  { label: "停止", message: "停止运行" },
  { label: "单步", message: "单步执行一轮" },
  { label: "预算 100", message: "把预算改成 100" },
]

const MAX_MESSAGE_LENGTH = 4000

interface LocalMessage extends OrchestratorMessage {
  reasoning?: string
  streaming?: boolean
}

function MessageBubble({ message }: { message: LocalMessage }) {
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
  const actions = messageActions(message)

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
        {!isUser && (
          <ReasoningBlock
            text={message.reasoning ?? ""}
            streaming={message.streaming}
          />
        )}

        {message.content ? (
          <p className="break-words whitespace-pre-wrap">
            {message.content}
            {message.streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />
            )}
          </p>
        ) : message.streaming ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            正在生成…
          </p>
        ) : null}

        {actions.length > 0 && (
          <div className="space-y-1 border-t border-current/10 pt-2">
            <div className="flex flex-wrap gap-1.5">
              {actions.map((action, index) => (
                <Badge
                  key={`${action.type}-${index}`}
                  variant={action.ok === false ? "destructive" : "secondary"}
                  title={action.message}
                >
                  {actionLabel(action.type)}
                  {action.ok === false ? "失败" : "完成"}
                </Badge>
              ))}
            </div>
            <ul className="space-y-0.5 text-xs opacity-80">
              {actions
                .filter((action) => action.message)
                .map((action, index) => (
                  <li
                    key={`${action.type}-msg-${index}`}
                    className="break-words"
                  >
                    {actionLabel(action.type)}：{action.message}
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

interface OrchestratorTabProps {
  taskId: string
  messages: OrchestratorMessage[]
  onRefresh: () => void | Promise<void>
}

export function OrchestratorTab({
  taskId,
  messages,
  onRefresh,
}: OrchestratorTabProps) {
  const [localMessages, setLocalMessages] =
    React.useState<LocalMessage[]>(messages)
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    if (sending) return
    // 服务端快照可能短暂落后于本地流式消息，较短的列表不覆盖本地。
    setLocalMessages((current) =>
      messages.length >= current.length ? messages : current
    )
  }, [messages, sending])

  React.useEffect(() => {
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [localMessages, sending, status])

  async function send(raw: string) {
    const message = raw.trim()
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
    const assistantId = `local-assistant-${stamp}`
    const now = new Date().toISOString()

    setLocalMessages((current) => [
      ...current,
      {
        id: `local-user-${stamp}`,
        role: "user",
        content: message,
        at: now,
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        at: now,
        streaming: true,
      },
    ])
    setInput("")
    setSending(true)
    setStatus("正在思考…")

    const controller = new AbortController()
    abortRef.current = controller

    let content = ""
    let reasoning = ""
    let actions: ActionResult[] = []
    let streamError: string | null = null

    const updateAssistant = (
      updater: (message: LocalMessage) => LocalMessage
    ) => {
      setLocalMessages((current) =>
        current.map((item) => (item.id === assistantId ? updater(item) : item))
      )
    }

    const handleEvent = (event: SseEvent) => {
      if (event.event === "reasoning") {
        const data = event.data as { delta?: string }
        if (data.delta) {
          reasoning += data.delta
          updateAssistant((item) => ({ ...item, reasoning }))
        }
        return
      }
      if (event.event === "delta") {
        const data = event.data as { delta?: string }
        if (data.delta) {
          content += data.delta
          updateAssistant((item) => ({ ...item, content }))
        }
        return
      }
      if (event.event === "status") {
        const data = event.data as { status?: string }
        setStatus(data.status ?? null)
        return
      }
      if (event.event === "action") {
        const data = event.data as { action?: ActionResult }
        if (data.action) {
          actions = [...actions, data.action]
          updateAssistant((item) => ({ ...item, actions }))
        }
        return
      }
      if (event.event === "done") {
        const data = event.data as OrchestratorResponse
        if (typeof data.reply === "string" && data.reply) {
          content = data.reply
        }
        if (Array.isArray(data.actions)) actions = data.actions
        updateAssistant((item) => ({
          ...item,
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
        `/api/gepa/tasks/${taskId}/orchestrator/stream`,
        { message },
        handleEvent,
        controller.signal
      )
      if (streamError) throw new Error(streamError)

      updateAssistant((item) => ({
        ...item,
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
      await onRefresh()
    } catch (error) {
      if (controller.signal.aborted) {
        updateAssistant((item) => ({
          ...item,
          streaming: false,
          content: content || "（已停止生成）",
        }))
        toast.info("已停止生成")
      } else {
        const text = errorText(error, "总控调用失败")
        updateAssistant((item) => ({
          ...item,
          streaming: false,
          content: content || `请求失败：${text}`,
        }))
        toast.error(text)
      }
      await onRefresh()
    } finally {
      abortRef.current = null
      setSending(false)
      setStatus(null)
    }
  }

  function stopGeneration() {
    abortRef.current?.abort()
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareIcon className="size-4" />
          总控助手
        </CardTitle>
        <CardDescription>
          用自然语言控制运行、调整参数或修改模块提示词。回复会流式输出，操作按顺序执行。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              size="xs"
              onClick={() => void send(action.message)}
              disabled={sending}
            >
              {action.label}
            </Button>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="h-[26rem] overflow-y-auto rounded-lg border bg-background p-3"
        >
          {localMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <BotIcon className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">开始与总控对话</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                例如：「开始运行」「把预算改成
                100」「暂停」「把主技能的提示词改得更简洁」。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {localMessages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {status ?? "总控正在思考…"}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Textarea
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                if (!sending) void send(input)
              }
            }}
            placeholder="输入消息，Enter 发送，Shift + Enter 换行"
            disabled={sending}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              操作按顺序执行，单个操作失败不会影响其他操作。
            </p>
            <div className="flex items-center gap-2">
              {sending && (
                <Button variant="outline" onClick={stopGeneration}>
                  <SquareIcon />
                  停止
                </Button>
              )}
              <Button
                onClick={() => void send(input)}
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
        </div>
      </CardContent>
    </Card>
  )
}
