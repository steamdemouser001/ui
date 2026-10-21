"use client"

import * as React from "react"
import {
  BotIcon,
  Loader2Icon,
  MessageSquareIcon,
  SendIcon,
  UserIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/gepa/client"
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

import { actionLabel, errorText, formatClock } from "./format"
import { messageActions, type OrchestratorResponse } from "./types"

const QUICK_ACTIONS = [
  { label: "开始", message: "开始运行" },
  { label: "暂停", message: "暂停运行" },
  { label: "继续", message: "继续运行" },
  { label: "停止", message: "停止运行" },
  { label: "单步", message: "单步执行一轮" },
  { label: "预算 100", message: "把预算改成 100" },
]

const MAX_MESSAGE_LENGTH = 4000

function MessageBubble({ message }: { message: OrchestratorMessage }) {
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
        <p className="break-words whitespace-pre-wrap">{message.content}</p>

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
    React.useState<OrchestratorMessage[]>(messages)
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setLocalMessages(messages)
  }, [messages])

  React.useEffect(() => {
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [localMessages, sending])

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

    const stamp = Date.now()
    setLocalMessages((current) => [
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
      const data = await apiPost<OrchestratorResponse>(
        `/api/gepa/tasks/${taskId}/orchestrator`,
        { message }
      )
      setLocalMessages((current) => [
        ...current,
        {
          id: `local-assistant-${stamp}`,
          role: "assistant",
          content: data.reply,
          at: new Date().toISOString(),
          actions: data.actions,
        },
      ])
      setInput("")
      if (data.actions.length > 0) {
        const failed = data.actions.filter((action) => action.ok === false)
        if (failed.length > 0) {
          toast.warning(
            `已执行 ${data.actions.length} 个操作，其中 ${failed.length} 个失败`
          )
        } else {
          toast.success(`已执行 ${data.actions.length} 个操作`)
        }
      }
      await onRefresh()
    } catch (error) {
      toast.error(errorText(error, "总控调用失败"))
      await onRefresh()
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareIcon className="size-4" />
          总控助手
        </CardTitle>
        <CardDescription>
          用自然语言控制运行、调整参数或修改模块提示词。助手会返回回复并执行白名单内的操作。
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
                  总控正在思考…
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
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                if (!sending) void send(input)
              }
            }}
            placeholder="输入消息，Ctrl/⌘ + Enter 发送"
            disabled={sending}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              操作按顺序执行，单个操作失败不会影响其他操作。
            </p>
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
      </CardContent>
    </Card>
  )
}
