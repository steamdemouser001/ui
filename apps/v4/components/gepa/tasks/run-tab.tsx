"use client"

import * as React from "react"
import {
  ActivityIcon,
  ChevronRightIcon,
  FileTextIcon,
  ListChecksIcon,
  ScrollTextIcon,
  TrophyIcon,
} from "lucide-react"

import type { Candidate, IterationRecord } from "@/lib/gepa/types"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"
import { Progress } from "@/registry/new-york-v4/ui/progress"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/registry/new-york-v4/ui/table"

import {
  formatClock,
  formatDateTime,
  formatScore,
  LOG_LEVEL_META,
  percent,
} from "./format"
import { RunStatusBadge } from "./status-badge"
import type { TaskDetailData } from "./types"

function StatCell({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium tabular-nums">{value}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function LogList({ detail }: { detail: TaskDetailData }) {
  const run = detail.run
  if (!run) return null
  const logs = run.logs.slice(-100).reverse()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollTextIcon className="size-4" />
          运行日志
        </CardTitle>
        <CardDescription>
          最近 {logs.length} 条日志（最多显示 100 条），最新在前。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无日志
          </p>
        ) : (
          <ScrollArea className="h-80 rounded-md border">
            <ul className="divide-y text-sm">
              {logs.map((log) => {
                const meta = LOG_LEVEL_META[log.level] ?? LOG_LEVEL_META.info
                return (
                  <li
                    key={log.id}
                    className="flex flex-wrap items-start gap-2 px-3 py-2"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatClock(log.at)}
                    </span>
                    <span className={`text-xs font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                    {log.iteration !== undefined && (
                      <Badge variant="outline" className="text-[10px]">
                        第 {log.iteration} 轮
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                      {log.message}
                    </span>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

function IterationTable({
  iterations,
  moduleNames,
}: {
  iterations: IterationRecord[]
  moduleNames: Map<string, string>
}) {
  const rows = [...iterations].reverse()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecksIcon className="size-4" />
          迭代记录
        </CardTitle>
        <CardDescription>
          共 {iterations.length}{" "}
          轮迭代，最新在前。改进后为空表示该轮未完成子代评估。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无迭代记录
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">轮次</TableHead>
                <TableHead>模块</TableHead>
                <TableHead className="w-20">改进前</TableHead>
                <TableHead className="w-20">改进后</TableHead>
                <TableHead className="w-20">结果</TableHead>
                <TableHead>反思</TableHead>
                <TableHead className="w-32">完成时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((record) => (
                <TableRow key={`${record.index}-${record.candidateId}`}>
                  <TableCell className="tabular-nums">
                    第 {record.index} 轮
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {moduleNames.get(record.moduleId) ?? record.moduleId}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatScore(record.beforeScore)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatScore(record.afterScore)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={record.accepted ? "secondary" : "outline"}
                      className={
                        record.accepted
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : ""
                      }
                    >
                      {record.accepted ? "接受" : "拒绝"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <p
                      className="line-clamp-2 text-xs text-muted-foreground"
                      title={record.reflection}
                    >
                      {record.reflection || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(record.finishedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function CandidateDialog({
  candidate,
  isBest,
  inFrontier,
  onOpenChange,
}: {
  candidate: Candidate | null
  isBest: boolean
  inFrontier: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={candidate !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
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
                <FileTextIcon className="size-4" />
                模块提示词
              </h4>
              <div className="space-y-3">
                {candidate.modules.map((module) => (
                  <div key={module.id} className="rounded-md border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{module.name}</span>
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
  )
}

export function RunTab({ detail }: { detail: TaskDetailData }) {
  const { run, task } = detail
  const [selected, setSelected] = React.useState<Candidate | null>(null)

  if (!run) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <ActivityIcon className="size-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">还没有运行记录</p>
            <p className="text-sm text-muted-foreground">
              在页面顶部点击「开始」启动第一轮 GEPA 迭代，或让总控助手帮你开始。
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const budgetPercent = percent(run.budgetUsed, run.budget)
  const iterationPercent = percent(run.iteration, task.iteration.maxIterations)
  const best = run.candidates.find(
    (candidate) => candidate.id === run.bestCandidateId
  )
  const moduleNames = new Map(
    task.modules.map((module) => [module.id, module.name])
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <ActivityIcon className="size-4" />
            运行状态
            <RunStatusBadge status={run.status} />
          </CardTitle>
          <CardDescription className="font-mono">{run.id}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCell
              label="迭代"
              value={`${run.iteration} / ${task.iteration.maxIterations}`}
            />
            <StatCell
              label="预算"
              value={`${run.budgetUsed} / ${run.budget}`}
            />
            <StatCell label="候选" value={run.candidates.length} />
            <StatCell
              label="最佳分"
              value={formatScore(best?.averageScore)}
              hint={run.bestCandidateId ?? undefined}
            />
            <StatCell label="帕累托前沿" value={run.paretoFrontier.length} />
            <StatCell
              label="开始时间"
              value={
                <span className="text-xs">{formatDateTime(run.startedAt)}</span>
              }
            />
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>预算使用</span>
                <span className="tabular-nums">{budgetPercent}%</span>
              </div>
              <Progress value={budgetPercent} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>迭代进度</span>
                <span className="tabular-nums">{iterationPercent}%</span>
              </div>
              <Progress value={iterationPercent} />
            </div>
          </div>

          {run.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {run.error}
            </div>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>更新时间：{formatDateTime(run.updatedAt)}</span>
            {run.finishedAt && (
              <span>结束时间：{formatDateTime(run.finishedAt)}</span>
            )}
            <span>
              反馈样本 {run.feedbackSplit.length} 个 · 帕累托样本{" "}
              {run.paretoSplit.length} 个
            </span>
          </div>
        </CardContent>
      </Card>

      <LogList detail={detail} />

      <IterationTable iterations={run.iterations} moduleNames={moduleNames} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrophyIcon className="size-4" />
            候选列表
          </CardTitle>
          <CardDescription>
            共 {run.candidates.length} 个候选。点击查看模块提示词与反思记录。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {run.candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无候选，首轮迭代会创建种子候选。
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {run.candidates.map((candidate) => {
                const isBest = candidate.id === run.bestCandidateId
                const inFrontier = run.paretoFrontier.includes(candidate.id)
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelected(candidate)}
                    className="rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">
                        {candidate.id}
                      </span>
                      {isBest && <Badge>最佳</Badge>}
                      {inFrontier && <Badge variant="secondary">帕累托</Badge>}
                      <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <span>第 {candidate.iteration} 轮</span>
                      <span className="tabular-nums">
                        平均分 {formatScore(candidate.averageScore)}
                      </span>
                      <span className="tabular-nums">
                        样本 {Object.keys(candidate.scores).length}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      父代 {candidate.parentId ?? "无"} · 反思{" "}
                      {candidate.reflections.length} 条
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CandidateDialog
        candidate={selected}
        isBest={selected?.id === run.bestCandidateId}
        inFrontier={
          selected !== null && run.paretoFrontier.includes(selected.id)
        }
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </div>
  )
}
