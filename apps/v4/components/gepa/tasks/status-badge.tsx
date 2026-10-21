import type { RunStatus, TaskStatus } from "@/lib/gepa/types"
import { Badge } from "@/registry/new-york-v4/ui/badge"

import { RUN_STATUS_META, TASK_STATUS_META } from "./format"

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS_META[status] ?? TASK_STATUS_META.draft
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.dot && (
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
      )}
      {meta.label}
    </Badge>
  )
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status] ?? RUN_STATUS_META.idle
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.dot && (
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
      )}
      {meta.label}
    </Badge>
  )
}
