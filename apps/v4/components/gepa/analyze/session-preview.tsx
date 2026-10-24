"use client"

import * as React from "react"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"

import type { TranscriptEntry } from "@/lib/gepa/claude-inspect"
import { apiGet } from "@/lib/gepa/client"
import { cn } from "@/lib/utils"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"

interface SessionTranscriptResponse {
  entries: TranscriptEntry[]
  truncated: boolean
}

const TOOL_COLORS: Record<string, string> = {
  Bash: "text-emerald-400",
  Read: "text-sky-400",
  Edit: "text-amber-400",
  Write: "text-amber-400",
  Grep: "text-violet-400",
  Glob: "text-violet-400",
  Task: "text-fuchsia-400",
  Agent: "text-fuchsia-400",
  WebFetch: "text-cyan-400",
  WebSearch: "text-cyan-400",
}

function toolColor(name: string): string {
  if (name.startsWith("mcp__")) return "text-orange-400"
  return TOOL_COLORS[name] ?? "text-zinc-300"
}

function formatClock(at: string | null): string {
  if (!at) return ""
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function ToolLine({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className={cn("space-y-0.5", entry.sidechain && "ml-5")}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={cn("shrink-0", toolColor(entry.tool ?? ""))}>⏺</span>
        <span className={cn("font-medium", toolColor(entry.tool ?? ""))}>
          {entry.tool}
        </span>
        {entry.detail && (
          <span className="text-zinc-400">({entry.detail})</span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
          {formatClock(entry.at)}
        </span>
      </div>
      {entry.output && (
        <div
          className={cn(
            "pl-4 break-words whitespace-pre-wrap",
            entry.isError ? "text-red-400" : "text-zinc-500"
          )}
        >
          <span className="mr-1 text-zinc-600">⎿</span>
          {entry.isError && <span className="mr-1">Error:</span>}
          {entry.output}
        </div>
      )}
    </div>
  )
}

function EntryLine({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === "tool") {
    return <ToolLine entry={entry} />
  }
  if (entry.kind === "hook") {
    return (
      <div className="space-y-0.5">
        <div className="flex items-baseline gap-1.5 text-red-400">
          <span className="shrink-0">⚠</span>
          <span>钩子错误：{entry.text}</span>
        </div>
        {entry.output && (
          <div className="pl-4 break-words whitespace-pre-wrap text-red-400/80">
            {entry.output}
          </div>
        )}
      </div>
    )
  }
  if (entry.kind === "thinking") {
    return (
      <div
        className={cn("pl-4 text-zinc-500 italic", entry.sidechain && "ml-5")}
      >
        ✻ {entry.text}
      </div>
    )
  }
  if (entry.kind === "user") {
    return (
      <div className="flex items-baseline gap-2 pt-1">
        <span className="shrink-0 text-sky-400">❯</span>
        <p className="min-w-0 flex-1 break-words whitespace-pre-wrap text-zinc-100">
          {entry.text}
        </p>
        <span className="shrink-0 text-[10px] text-zinc-600">
          {formatClock(entry.at)}
        </span>
      </div>
    )
  }
  return (
    <div
      className={cn("flex items-baseline gap-1.5", entry.sidechain && "ml-5")}
    >
      <span className="shrink-0 text-zinc-100">⏺</span>
      <p className="min-w-0 flex-1 break-words whitespace-pre-wrap text-zinc-200">
        {entry.text}
      </p>
    </div>
  )
}

export function SessionPreview({
  project,
  sessionId,
  className,
}: {
  project: string
  sessionId: string
  className?: string
}) {
  const [data, setData] = React.useState<SessionTranscriptResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    const query = new URLSearchParams({ project, sessionId })
    apiGet<SessionTranscriptResponse>(
      `/api/gepa/analyze/transcript?${query.toString()}`
    )
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error && loadError.message
              ? loadError.message
              : "加载会话预览失败"
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project, sessionId])

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-64 items-center justify-center rounded-lg border bg-zinc-950 font-mono text-xs text-zinc-500",
          className
        )}
      >
        <Loader2Icon className="mr-2 size-4 animate-spin" />
        正在读取会话转录…
      </div>
    )
  }
  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircleIcon />
        <AlertTitle>会话预览加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!data || data.entries.length === 0) {
    return (
      <div
        className={cn(
          "flex h-32 items-center justify-center rounded-lg border bg-zinc-950 font-mono text-xs text-zinc-500",
          className
        )}
      >
        （没有可展示的对话内容）
      </div>
    )
  }

  return (
    <div
      className={cn("overflow-hidden rounded-lg border bg-zinc-950", className)}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 font-mono text-[11px] text-zinc-500">
        <span className="truncate">{sessionId}.jsonl</span>
        <span className="shrink-0">
          {data.entries.length} 条{data.truncated && "（已截断）"}
        </span>
      </div>
      <ScrollArea className="h-[520px]">
        <div className="space-y-2.5 px-3 py-3 font-mono text-xs leading-relaxed">
          {data.entries.map((entry, index) => (
            <EntryLine key={index} entry={entry} />
          ))}
          {data.truncated && (
            <p className="pt-1 text-[11px] text-zinc-600">
              — 内容过长，仅展示前 {data.entries.length} 条，完整过程请运行分析
              —
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function SessionPreviewBadge({ count }: { count: number }) {
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600"
    >
      已分析 {count}
    </Badge>
  )
}
