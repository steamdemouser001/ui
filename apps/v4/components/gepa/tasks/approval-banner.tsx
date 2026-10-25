"use client"

import * as React from "react"
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  Loader2Icon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react"

import type { PendingApproval } from "@/lib/gepa/types"
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
import { Alert, AlertDescription, AlertTitle } from "@/registry/new-york-v4/ui/alert"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"

import { formatScore } from "./format"

type DiffRowKind = "context" | "added" | "removed"

interface DiffRow {
  kind: DiffRowKind
  text: string
}

const DIFF_ROW_META: Record<DiffRowKind, { className: string; prefix: string }> =
  {
    context: { className: "text-muted-foreground", prefix: "  " },
    added: {
      className:
        "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      prefix: "+ ",
    },
    removed: {
      className: "bg-red-500/10 text-red-700 dark:text-red-400",
      prefix: "- ",
    },
  }

/** 行级 LCS diff：新增行绿色、删除行红色、上下文灰色。提示词行数有限，O(n·m) 足够。 */
function diffLines(oldText: string, newText: string): DiffRow[] {
  const oldLines = oldText.split(/\r?\n/)
  const newLines = newText.split(/\r?\n/)
  const rows = oldLines.length
  const cols = newLines.length
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0)
  )
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const result: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: "context", text: oldLines[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: "removed", text: oldLines[i] })
      i += 1
    } else {
      result.push({ kind: "added", text: newLines[j] })
      j += 1
    }
  }
  while (i < rows) {
    result.push({ kind: "removed", text: oldLines[i] })
    i += 1
  }
  while (j < cols) {
    result.push({ kind: "added", text: newLines[j] })
    j += 1
  }
  return result
}

function PromptDiff({ oldPrompt, newPrompt }: { oldPrompt: string; newPrompt: string }) {
  const rows = React.useMemo(() => diffLines(oldPrompt, newPrompt), [
    oldPrompt,
    newPrompt,
  ])

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>旧提示词</span>
        <ArrowRightIcon className="size-3" />
        <span>新提示词</span>
        <span className="ml-auto">
          绿色为新增行，红色为删除行
        </span>
      </div>
      <ScrollArea className="h-72 rounded-md border">
        <pre className="p-2 font-mono text-xs leading-5">
          {rows.map((row, index) => {
            const meta = DIFF_ROW_META[row.kind]
            return (
              <div key={index} className={`rounded px-1 break-words whitespace-pre-wrap ${meta.className}`}>
                {meta.prefix}
                {row.text || " "}
              </div>
            )
          })}
        </pre>
      </ScrollArea>
    </div>
  )
}

/** 反思摘要：超过 200 字折叠，可展开。 */
function Reflection({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false)
  const needFold = text.length > 200
  const shown = needFold && !expanded ? `${text.slice(0, 200)}…` : text

  return (
    <div className="text-sm break-words whitespace-pre-wrap">
      {shown}
      {needFold && (
        <Button
          variant="link"
          size="xs"
          className="h-auto px-1 py-0"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开全部"}
        </Button>
      )}
    </div>
  )
}

export function ApprovalBanner({
  approval,
  busy,
  onResolve,
}: {
  approval: PendingApproval
  busy: boolean
  onResolve: (action: "approve" | "reject") => void
}) {
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const improved = approval.afterScore > approval.beforeScore

  return (
    <Alert className="border-amber-500/50 bg-amber-500/5">
      <ClipboardCheckIcon className="size-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        等待人工审批：第 {approval.iteration} 轮候选
        <span className="font-mono text-xs font-normal">
          {approval.candidateId}
        </span>
        <Badge variant="outline">模块 {approval.moduleName}</Badge>
        {approval.parentCandidateId && (
          <span className="font-mono text-xs font-normal text-muted-foreground">
            父代 {approval.parentCandidateId}
          </span>
        )}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>改进前 {formatScore(approval.beforeScore)}</span>
          <ArrowRightIcon className="size-3.5" />
          <span
            className={
              improved
                ? "font-medium text-emerald-700 dark:text-emerald-400"
                : "font-medium text-red-700 dark:text-red-400"
            }
          >
            改进后 {formatScore(approval.afterScore)}
          </span>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">反思摘要</p>
          <Reflection text={approval.reflection || "（无反思内容）"} />
        </div>

        <PromptDiff oldPrompt={approval.oldPrompt} newPrompt={approval.newPrompt} />

        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => onResolve("approve")}
            disabled={busy}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
            批准并继续
          </Button>
          <Button
            variant="destructive"
            onClick={() => setRejectOpen(true)}
            disabled={busy}
          >
            <XIcon />
            否决候选
          </Button>
        </div>
      </AlertDescription>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认否决该候选？</AlertDialogTitle>
            <AlertDialogDescription>
              否决后候选 {approval.candidateId}
              将从池中移除，运行保持暂停。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onResolve("reject")}
            >
              确认否决
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Alert>
  )
}
