"use client"

import * as React from "react"
import {
  ActivityIcon,
  ChevronRightIcon,
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

import { CandidateDialog } from "./candidate-dialog"
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatScore,
  LOG_LEVEL_META,
  percent,
} from "./format"
import { RunStatusBadge } from "./status-badge"
import { TraceDialog, formatUsd } from "./trace-dialog"
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

/** 本轮耗时：finishedAt - startedAt，缺失或非法时返回 null。 */
function iterationDurationMs(record: IterationRecord): number | null {
  if (!record.finishedAt) return null
  const start = new Date(record.startedAt).getTime()
  const end = new Date(record.finishedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null
  }
  return end - start
}

function IterationTable({
  iterations,
  moduleNames,
  taskId,
  runId,
}: {
  iterations: IterationRecord[]
  moduleNames: Map<string, string>
  taskId: string
  runId: string
}) {
  const rows = [...iterations].reverse()
  const [selected, setSelected] = React.useState<IterationRecord | null>(null)

  const selectedModuleName = selected
    ? (moduleNames.get(selected.moduleId) ?? selected.moduleId)
    : null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecksIcon className="size-4" />
            迭代记录
          </CardTitle>
          <CardDescription>
            共 {iterations.length}{" "}
            轮迭代，最新在前。改进后为空表示该轮未完成子代评估。点击任意行查看该轮轨迹。
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
                  <TableHead>结果</TableHead>
                  <TableHead>反思</TableHead>
                  <TableHead className="w-20">本轮耗时</TableHead>
                  <TableHead className="w-32">完成时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((record) => (
                  <TableRow
                    key={`${record.index}-${record.candidateId}`}
                    tabIndex={0}
                    onClick={() => setSelected(record)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setSelected(record)
                      }
                    }}
                    className="cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    title={`查看第 ${record.index} 轮轨迹`}
                  >
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
                      <div className="flex flex-wrap items-center gap-1">
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
                        {record.humanDecision === "approved" && (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          >
                            人工已批准
                          </Badge>
                        )}
                        {record.humanDecision === "rejected" && (
                          <Badge
                            variant="outline"
                            className="border-destructive/30 bg-destructive/10 text-destructive"
                          >
                            人工已否决
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <p
                        className="line-clamp-2 text-xs text-muted-foreground"
                        title={record.reflection}
                      >
                        {record.reflection || "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {formatDuration(iterationDurationMs(record))}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {formatDateTime(record.finishedAt)}
                        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60" />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TraceDialog
        record={selected}
        moduleName={selectedModuleName}
        taskId={taskId}
        runId={runId}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </>
  )
}

export function RunTab({
  detail,
  historical = false,
}: {
  detail: TaskDetailData
  /** 是否查看历史运行快照（来自运行历史入口）。 */
  historical?: boolean
}) {
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
      {historical && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">历史运行</Badge>
          <span className="text-xs text-muted-foreground">
            正在查看一次历史运行快照，仅供回溯
          </span>
        </div>
      )}

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
            {run.harness && (
              <span>
                Harness: {run.harness.kind} · 模型 {run.harness.model}
                {run.harness.claudeVersion
                  ? ` · 版本 ${run.harness.claudeVersion}`
                  : ""}
              </span>
            )}
            {typeof run.totalCostUsd === "number" && (
              <span className="tabular-nums">
                累计费用 {formatUsd(run.totalCostUsd)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <LogList detail={detail} />

      <IterationTable
        iterations={run.iterations}
        moduleNames={moduleNames}
        taskId={task.id}
        runId={run.id}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrophyIcon className="size-4" />
            候选列表
          </CardTitle>
          <CardDescription>
            共 {run.candidates.length} 个候选。点击查看样本得分、模块提示词与父代差异。
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
        taskId={task.id}
        candidate={selected}
        candidates={run.candidates}
        isBest={selected?.id === run.bestCandidateId}
        inFrontier={
          selected !== null && run.paretoFrontier.includes(selected.id)
        }
        historical={historical}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </div>
  )
}
