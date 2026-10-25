"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react"

import type {
  ExampleTrace,
  IterationRecord,
  TraceStep,
} from "@/lib/gepa/types"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"

import { formatDuration, formatScore } from "./format"
import { RolloutFiles } from "./rollout-files"

/** 金额格式：固定 4 位小数，例如 $0.0654。 */
export function formatUsd(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(4)}`
    : "—"
}

function TraceField({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm break-words whitespace-pre-wrap">{value}</div>
    </div>
  )
}

/** 轨迹步骤的可折叠文本区块（模块提示词 / 输入 / 输出），默认收起。 */
function TraceCollapsibleBlock({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="px-1.5 font-medium text-muted-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        {label}
      </Button>
      {open && (
        <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs break-words whitespace-pre-wrap">
          {value || "（空）"}
        </pre>
      )}
    </div>
  )
}

function TraceStepItem({
  step,
  index,
}: {
  step: TraceStep
  index: number
}) {
  return (
    <li className="space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Badge variant="outline" className="tabular-nums">
          步骤 {index + 1}
        </Badge>
        <span className="text-sm font-medium">{step.moduleName}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {step.moduleId}
        </span>
        <span className="tabular-nums text-muted-foreground">
          耗时 {formatDuration(step.durationMs)}
        </span>
        {typeof step.exitCode === "number" && (
          <Badge
            variant={step.exitCode === 0 ? "secondary" : "destructive"}
            className="tabular-nums"
          >
            退出码 {step.exitCode}
          </Badge>
        )}
        {typeof step.costUsd === "number" && (
          <span className="tabular-nums text-muted-foreground">
            成本 {formatUsd(step.costUsd)}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <TraceCollapsibleBlock label="模块提示词" value={step.prompt} />
        <TraceCollapsibleBlock label="模块输入" value={step.input} />
        <TraceCollapsibleBlock label="模块输出" value={step.output} />
      </div>

      {step.toolCalls && step.toolCalls.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            工具调用 {step.toolCalls.length} 次
          </p>
          <ul className="space-y-1.5">
            {step.toolCalls.map((call, callIndex) => (
              <li
                key={`${call.name}-${callIndex}`}
                className="rounded border bg-background/60 p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">
                    {call.name}
                  </span>
                  {call.isError && (
                    <Badge variant="destructive" className="text-[10px]">
                      失败
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 space-y-1">
                  <p className="text-[11px] text-muted-foreground">input</p>
                  <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-1.5 font-mono text-xs break-words whitespace-pre-wrap">
                    {call.input}
                  </pre>
                  {call.output && (
                    <>
                      <p className="text-[11px] text-muted-foreground">
                        output
                      </p>
                      <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-1.5 font-mono text-xs break-words whitespace-pre-wrap">
                        {call.output}
                      </pre>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.stdout && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">stdout</p>
          <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs break-words whitespace-pre-wrap">
            {step.stdout}
          </pre>
        </div>
      )}

      {step.stderr && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">stderr</p>
          <pre className="max-h-40 overflow-auto rounded border border-destructive/30 bg-destructive/5 p-2 font-mono text-xs text-destructive break-words whitespace-pre-wrap">
            {step.stderr}
          </pre>
        </div>
      )}
    </li>
  )
}

function ExampleTraceCard({
  trace,
  index,
  taskId,
  runId,
  candidateId,
}: {
  trace: ExampleTrace
  index: number
  taskId: string
  runId: string
  /** 本轮轨迹对应的子代候选，rollout 产物按它定位。 */
  candidateId: string
}) {
  const steps = trace.steps ?? []

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{trace.exampleId}</span>
        <Badge variant="secondary" className="tabular-nums">
          分数 {formatScore(trace.score)}
        </Badge>
        {trace.error && <Badge variant="destructive">执行失败</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          样本 {index + 1}
        </span>
      </div>

      {trace.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive break-words whitespace-pre-wrap">
          {trace.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <TraceField label="输入" value={trace.input || "—"} />
        {trace.expected && (
          <TraceField label="期望输出" value={trace.expected} />
        )}
        <TraceField label="最终输出" value={trace.output || "—"} />
        <TraceField label="反馈" value={trace.feedback || "—"} />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          执行步骤 {steps.length} 个
        </p>
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">该样本没有执行步骤</p>
        ) : (
          <ol className="space-y-2">
            {steps.map((step, stepIndex) => (
              <TraceStepItem
                key={`${step.moduleId}-${stepIndex}`}
                step={step}
                index={stepIndex}
              />
            ))}
          </ol>
        )}
      </div>

      {trace.rolloutDir && (
        <RolloutFiles
          taskId={taskId}
          runId={runId}
          candidateId={candidateId}
          exampleId={trace.exampleId}
          dir={trace.rolloutDir}
        />
      )}
    </div>
  )
}

export function TraceDialog({
  record,
  moduleName,
  taskId,
  runId,
  onOpenChange,
}: {
  record: IterationRecord | null
  moduleName: string | null
  taskId: string
  runId: string
  onOpenChange: (open: boolean) => void
}) {
  const traces = record?.traces ?? []
  const candidateId = record?.candidateId ?? ""

  return (
    <Dialog open={record !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {record ? `第 ${record.index} 轮轨迹` : "迭代轨迹"}
          </DialogTitle>
          <DialogDescription>
            {record
              ? `改进前 ${formatScore(record.beforeScore)} → 改进后 ${formatScore(
                  record.afterScore
                )}，${
                  record.accepted ? "该轮改进被接受" : "该轮改进未被接受"
                }${moduleName ? ` · 模块 ${moduleName}` : ""}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {record &&
          (traces.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              该轮没有轨迹
            </p>
          ) : (
            <ScrollArea className="max-h-[70vh] pr-3">
              <div className="space-y-3">
                {traces.map((trace, index) => (
                  <ExampleTraceCard
                    key={`${trace.exampleId}-${index}`}
                    trace={trace}
                    index={index}
                    taskId={taskId}
                    runId={runId}
                    candidateId={candidateId}
                  />
                ))}
              </div>
            </ScrollArea>
          ))}
      </DialogContent>
    </Dialog>
  )
}
