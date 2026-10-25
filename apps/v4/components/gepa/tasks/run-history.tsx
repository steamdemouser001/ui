"use client"

import { HistoryIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"

import { formatDateTime, RUN_STATUS_META } from "./format"
import type { RunSummary } from "./types"

/** 「最新运行」选项值：跟随任务当前活动/最近一次运行。 */
export const LATEST_RUN_VALUE = "latest"

/** 运行历史选择器：「最新运行」+ 历史运行列表（id 前 8 位、状态、轮次、开始时间）。 */
export function RunHistory({
  runs,
  value,
  onChange,
  disabled,
}: {
  runs: RunSummary[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          size="sm"
          className="w-60"
          aria-label="选择要查看的运行"
        >
          <SelectValue placeholder="选择运行" />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
          <SelectItem value={LATEST_RUN_VALUE}>最新运行</SelectItem>
          {runs.map((run) => {
            const status = RUN_STATUS_META[run.status]?.label ?? run.status
            const label = [
              run.id.slice(0, 8),
              status,
              `${run.iteration} 轮`,
              formatDateTime(run.startedAt),
              run.awaitingApproval ? "待审批" : null,
            ]
              .filter(Boolean)
              .join(" · ")
            return (
              <SelectItem key={run.id} value={run.id}>
                {label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
