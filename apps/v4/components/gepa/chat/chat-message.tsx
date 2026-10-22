"use client"

import * as React from "react"
import { cn } from "cn"
import { BotIcon, BrainIcon, ChevronDownIcon, UserIcon } from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"

import { actionLabel, formatClock } from "../tasks/format"
import type { ChatAction, ChatMessage } from "./types"

function actionTitle(action: ChatAction): string | undefined {
  const title = [action.message, action.taskId ? `任务 ${action.taskId}` : null]
    .filter(Boolean)
    .join(" · ")
  return title || undefined
}

export function ReasoningBlock({
  text,
  streaming,
}: {
  text: string
  streaming?: boolean
}) {
  const [open, setOpen] = React.useState(Boolean(streaming))

  React.useEffect(() => {
    if (streaming) setOpen(true)
  }, [streaming])

  if (!text) return null

  return (
    <div className="rounded-md border border-dashed bg-background/40 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <BrainIcon className="size-3.5" />
        <span>
          {streaming ? "思考过程（生成中）" : `思考过程（${text.length} 字）`}
        </span>
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3.5 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <p className="max-h-56 overflow-y-auto border-t px-2 py-1.5 break-words whitespace-pre-wrap text-muted-foreground">
          {text}
        </p>
      )}
    </div>
  )
}

function ActionList({ actions }: { actions: ChatAction[] }) {
  if (actions.length === 0) return null

  return (
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
          <li key={`${action.type}-detail-${index}`} className="break-words">
            {actionLabel(action.type)}
            {action.message ? `：${action.message}` : ""}
            {action.taskId && (
              <span className="ml-1 opacity-70">（任务 {action.taskId}）</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
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

        <ActionList actions={actions} />

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
