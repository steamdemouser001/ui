"use client"

import * as React from "react"
import { cn } from "cn"

export interface PromptDiffRow {
  type: "same" | "add" | "remove"
  /** 旧文本行号（从 1 开始），新增行为 null。 */
  oldIndex: number | null
  /** 新文本行号（从 1 开始），删除行为 null。 */
  newIndex: number | null
  text: string
}

/** 行级 diff：LCS 回溯。行数乘积过大时退化为整块替换，避免内存膨胀。 */
export function computeLineDiff(
  oldPrompt: string,
  newPrompt: string
): PromptDiffRow[] {
  const oldLines = oldPrompt === "" ? [] : oldPrompt.split("\n")
  const newLines = newPrompt === "" ? [] : newPrompt.split("\n")
  const n = oldLines.length
  const m = newLines.length

  if (n === 0) {
    return newLines.map((text, index) => ({
      type: "add" as const,
      oldIndex: null,
      newIndex: index + 1,
      text,
    }))
  }
  if (m === 0) {
    return oldLines.map((text, index) => ({
      type: "remove" as const,
      oldIndex: index + 1,
      newIndex: null,
      text,
    }))
  }
  if (oldPrompt === newPrompt) {
    return oldLines.map((text, index) => ({
      type: "same" as const,
      oldIndex: index + 1,
      newIndex: index + 1,
      text,
    }))
  }

  if (n * m > 4_000_000) {
    return [
      ...oldLines.map<PromptDiffRow>((text, index) => ({
        type: "remove",
        oldIndex: index + 1,
        newIndex: null,
        text,
      })),
      ...newLines.map<PromptDiffRow>((text, index) => ({
        type: "add",
        oldIndex: null,
        newIndex: index + 1,
        text,
      })),
    ]
  }

  // dp[i * width + j]：oldLines[i..] 与 newLines[j..] 的 LCS 长度。
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        oldLines[i] === newLines[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)])
    }
  }

  const rows: PromptDiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({
        type: "same",
        oldIndex: i + 1,
        newIndex: j + 1,
        text: oldLines[i],
      })
      i += 1
      j += 1
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      rows.push({
        type: "remove",
        oldIndex: i + 1,
        newIndex: null,
        text: oldLines[i],
      })
      i += 1
    } else {
      rows.push({
        type: "add",
        oldIndex: null,
        newIndex: j + 1,
        text: newLines[j],
      })
      j += 1
    }
  }
  while (i < n) {
    rows.push({
      type: "remove",
      oldIndex: i + 1,
      newIndex: null,
      text: oldLines[i],
    })
    i += 1
  }
  while (j < m) {
    rows.push({
      type: "add",
      oldIndex: null,
      newIndex: j + 1,
      text: newLines[j],
    })
    j += 1
  }
  return rows
}

const ROW_CLASS: Record<PromptDiffRow["type"], string> = {
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  remove: "bg-destructive/10 text-destructive",
  same: "",
}

const ROW_MARKER: Record<PromptDiffRow["type"], string> = {
  add: "+",
  remove: "-",
  same: " ",
}

/** 提示词行级 diff 视图：新增行绿色背景、删除行红色背景，附双侧行号。 */
export function PromptDiff({
  oldPrompt,
  newPrompt,
}: {
  oldPrompt: string
  newPrompt: string
}) {
  const rows = React.useMemo(
    () => computeLineDiff(oldPrompt, newPrompt),
    [oldPrompt, newPrompt]
  )
  const added = rows.filter((row) => row.type === "add").length
  const removed = rows.filter((row) => row.type === "remove").length

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
          新增 {added} 行
        </span>
        <span className="tabular-nums text-destructive">删除 {removed} 行</span>
      </div>
      <div className="max-h-72 overflow-auto rounded-md border font-mono text-xs">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-center text-muted-foreground">
            （无内容）
          </p>
        ) : (
          rows.map((row, index) => (
            <div
              key={index}
              className={cn(
                "grid grid-cols-[2.25rem_2.25rem_1fr] items-start",
                ROW_CLASS[row.type]
              )}
            >
              <span className="select-none px-1 text-right text-[10px] leading-5 text-muted-foreground/70">
                {row.oldIndex ?? ""}
              </span>
              <span className="select-none border-r px-1 text-right text-[10px] leading-5 text-muted-foreground/70">
                {row.newIndex ?? ""}
              </span>
              <span className="px-2 leading-5 break-all whitespace-pre-wrap">
                <span aria-hidden className="mr-1 select-none">
                  {ROW_MARKER[row.type]}
                </span>
                {row.text === "" ? "\u00A0" : row.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
