"use client"

import * as React from "react"
import { ActivityIcon, WrenchIcon } from "lucide-react"

import type { RunPhase, RunProgress } from "@/lib/gepa/types"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Card, CardContent } from "@/registry/new-york-v4/ui/card"

import { formatElapsed } from "./format"

const PHASE_META: Record<RunPhase, { label: string; className: string }> = {
  seed: {
    label: "种子评估",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  "parent-rollout": {
    label: "父代执行",
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  evaluation: {
    label: "样本评估",
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  reflection: {
    label: "反思",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  "child-rollout": {
    label: "子代执行",
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  "pareto-eval": {
    label: "帕累托评估",
    className:
      "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  },
  idle: {
    label: "空闲",
    className: "border-border bg-muted text-muted-foreground",
  },
}

/** 相对 startedAt 的已用时，每秒自增一次。 */
function useElapsed(startedAt: string | undefined): string {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!startedAt) return "—"
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return "—"
  return formatElapsed(now - start)
}

/**
 * 事件流进度与快照进度取较新者：快照 startedAt 更新时采用快照，
 * 相同时优先事件进度（工具名等信息更新）。
 */
export function pickFresherProgress(
  eventProgress: RunProgress | null,
  snapshotProgress: RunProgress | null
): RunProgress | null {
  if (!eventProgress) return snapshotProgress
  if (!snapshotProgress) return eventProgress
  const eventAt = new Date(eventProgress.startedAt).getTime()
  const snapshotAt = new Date(snapshotProgress.startedAt).getTime()
  if (Number.isNaN(eventAt) || Number.isNaN(snapshotAt)) return eventProgress
  return snapshotAt > eventAt ? snapshotProgress : eventProgress
}

export function LiveProgress({ progress }: { progress: RunProgress }) {
  const meta = PHASE_META[progress.phase] ?? PHASE_META.idle
  const elapsed = useElapsed(progress.startedAt)
  const exampleProgress =
    typeof progress.exampleIndex === "number" &&
    typeof progress.exampleTotal === "number" &&
    progress.exampleTotal > 0
      ? `${progress.exampleIndex + 1} / ${progress.exampleTotal}`
      : null

  return (
    <Card className="border-emerald-500/30">
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
        <Badge variant="outline" className={`shrink-0 ${meta.className}`}>
          <ActivityIcon className="size-3" />
          {meta.label}
        </Badge>
        <span className="min-w-0 flex-1 text-base font-medium break-words">
          {progress.label}
        </span>
        {exampleProgress && (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            样本 {exampleProgress}
          </Badge>
        )}
        {progress.moduleName && (
          <Badge variant="outline" className="shrink-0">
            {progress.moduleName}
          </Badge>
        )}
        {progress.candidateId && (
          <span
            className="shrink-0 font-mono text-xs text-muted-foreground"
            title={progress.candidateId}
          >
            {progress.candidateId}
          </span>
        )}
        {progress.toolName && (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400"
          >
            <WrenchIcon className="size-3" />
            正在调用 {progress.toolName}
          </Badge>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          已用时 {elapsed}
        </span>
      </CardContent>
    </Card>
  )
}
