"use client"

import * as React from "react"
import { cn } from "cn"
import {
  ActivityIcon,
  CrownIcon,
  FileTextIcon,
  GitCompareIcon,
  Loader2Icon,
  TargetIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/gepa/client"
import type { Candidate, RunState } from "@/lib/gepa/types"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"

import { errorText, formatDateTime, formatScore } from "./format"
import { PromptDiff } from "./prompt-diff"

/** 样本得分徽章配色：≥0.8 绿、≥0.5 黄、其余红。 */
function scoreBadgeClass(score: number): string {
  if (score >= 0.8) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  }
  if (score >= 0.5) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
  }
  return "border-destructive/30 bg-destructive/10 text-destructive"
}

function ScoreList({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores)
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无评分</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([exampleId, score]) => (
        <Badge
          key={exampleId}
          variant="outline"
          className={cn(
            "gap-1 font-mono text-[10px] tabular-nums",
            scoreBadgeClass(score)
          )}
        >
          {exampleId}
          <span className="font-medium">{formatScore(score)}</span>
        </Badge>
      ))}
    </div>
  )
}

/** 与父代逐模块比较提示词，仅展示有差异的模块。 */
function ParentPromptDiff({
  candidate,
  candidates,
}: {
  candidate: Candidate
  candidates: Candidate[]
}) {
  if (!candidate.parentId) {
    return (
      <p className="text-sm text-muted-foreground">种子候选，无父代可比较</p>
    )
  }
  const parent = candidates.find((item) => item.id === candidate.parentId)
  if (!parent) {
    return (
      <p className="text-sm text-muted-foreground">
        父代 {candidate.parentId} 不在当前候选列表中，无法比较
      </p>
    )
  }

  const changed = candidate.modules.filter((module) => {
    const parentModule = parent.modules.find((item) => item.id === module.id)
    return !parentModule || parentModule.prompt !== module.prompt
  })

  if (changed.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        与父代各模块提示词完全一致
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {changed.map((module) => {
        const parentModule = parent.modules.find(
          (item) => item.id === module.id
        )
        return (
          <div key={module.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{module.name}</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {module.id}
              </Badge>
              {!parentModule && (
                <Badge variant="secondary" className="text-[10px]">
                  新增模块
                </Badge>
              )}
            </div>
            <PromptDiff
              oldPrompt={parentModule?.prompt ?? ""}
              newPrompt={module.prompt}
            />
          </div>
        )
      })}
    </div>
  )
}

export function CandidateDialog({
  taskId,
  candidate,
  candidates,
  isBest,
  inFrontier,
  historical,
  onOpenChange,
  onPromoted,
}: {
  taskId: string
  candidate: Candidate | null
  /** 全部候选，用于查找父代做提示词差异比较。 */
  candidates: Candidate[]
  isBest: boolean
  inFrontier: boolean
  /** 历史运行快照：不提供「设为最佳」，避免影响当前运行。 */
  historical?: boolean
  onOpenChange: (open: boolean) => void
  onPromoted?: () => void
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [promoting, setPromoting] = React.useState(false)
  const showPromote = candidate !== null && !isBest && !historical

  // 对话框关闭时复位确认状态，避免残留到下一个候选。
  React.useEffect(() => {
    if (candidate === null) {
      setConfirmOpen(false)
      setPromoting(false)
    }
  }, [candidate])

  async function handlePromote() {
    if (!candidate || promoting) return
    setPromoting(true)
    try {
      await apiPost<{ run: RunState }>(`/api/gepa/tasks/${taskId}/run`, {
        action: "promote",
        candidateId: candidate.id,
      })
      toast.success(`已将 ${candidate.id} 设为最佳候选，等待快照刷新`)
      setConfirmOpen(false)
      onPromoted?.()
    } catch (promoteError) {
      toast.error(errorText(promoteError, "提升候选失败"))
    } finally {
      setPromoting(false)
    }
  }

  return (
    <>
      <Dialog open={candidate !== null} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1.5">
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {candidate?.id}
                  {isBest && <Badge>最佳</Badge>}
                  {inFrontier && <Badge variant="secondary">帕累托前沿</Badge>}
                </DialogTitle>
                <DialogDescription>
                  {candidate
                    ? `第 ${candidate.iteration} 轮生成，父代 ${
                        candidate.parentId ?? "无（种子候选）"
                      }，平均分 ${formatScore(candidate.averageScore)}`
                    : ""}
                </DialogDescription>
              </div>
              {showPromote && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={promoting}
                  onClick={() => setConfirmOpen(true)}
                >
                  {promoting ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <CrownIcon />
                  )}
                  设为最佳
                </Button>
              )}
            </div>
          </DialogHeader>

          {candidate && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  已评估样本 {Object.keys(candidate.scores).length}
                </Badge>
                <Badge variant="outline">
                  反思 {candidate.reflections.length} 条
                </Badge>
                <Badge variant="outline">
                  创建于 {formatDateTime(candidate.createdAt)}
                </Badge>
              </div>

              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <TargetIcon className="size-4" />
                  样本得分
                </h4>
                <ScoreList scores={candidate.scores} />
              </div>

              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <FileTextIcon className="size-4" />
                  模块提示词
                </h4>
                <div className="space-y-3">
                  {candidate.modules.map((module) => (
                    <div key={module.id} className="rounded-md border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {module.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {module.id}
                        </Badge>
                      </div>
                      <pre className="max-h-56 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
                        {module.prompt}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <GitCompareIcon className="size-4" />
                  与父代的提示词差异
                </h4>
                <ParentPromptDiff
                  candidate={candidate}
                  candidates={candidates}
                />
              </div>

              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <ActivityIcon className="size-4" />
                  反思记录
                </h4>
                {candidate.reflections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无反思记录</p>
                ) : (
                  <ol className="list-decimal space-y-2 pl-5 text-sm">
                    {candidate.reflections.map((reflection, index) => (
                      <li key={index} className="break-words whitespace-pre-wrap">
                        {reflection}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!promoting) setConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>设为最佳候选</AlertDialogTitle>
            <AlertDialogDescription>
              确定将 {candidate?.id} 设为最佳候选？下一次迭代将以帕累托策略继续探索。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={promoting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={promoting}
              onClick={(event) => {
                event.preventDefault()
                void handlePromote()
              }}
            >
              {promoting ? <Loader2Icon className="animate-spin" /> : null}
              确认提升
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
