"use client"

import Link from "next/link"
import { cn } from "cn"
import { ArrowRightIcon, ListTodoIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Progress } from "@/registry/new-york-v4/ui/progress"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"

import { formatDateTime, formatScore, percent } from "../tasks/format"
import { RunStatusBadge, TaskStatusBadge } from "../tasks/status-badge"
import type { ChatTask } from "./types"

function TaskContextItem({ task }: { task: ChatTask }) {
  const run = task.run
  const progress = run ? percent(run.budgetUsed, run.budget) : 0
  const href = `/gepa/tasks/${task.id}`

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={href}
          className="min-w-0 truncate text-sm font-medium hover:underline"
        >
          {task.name}
        </Link>
        <TaskStatusBadge status={task.status} />
      </div>

      {task.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {task.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{task.modules} 个模块</span>
        <span>{task.dataset} 条数据</span>
      </div>

      {run ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RunStatusBadge status={run.status} />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {run.iteration} 轮 · {run.budgetUsed}/{run.budget}
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>最佳分 {formatScore(run.bestScore)}</span>
            <span>{run.candidates} 个候选</span>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          尚未运行 · 默认预算 {task.iteration.budget}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>更新于 {formatDateTime(task.updatedAt)}</span>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline"
        >
          打开
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>
    </div>
  )
}

export function ChatTaskContext({
  tasks,
  className,
}: {
  tasks: ChatTask[]
  className?: string
}) {
  return (
    <Card
      className={cn(
        "flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0",
        className
      )}
    >
      <CardHeader className="border-b px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ListTodoIcon className="size-4" />
          任务上下文
          <span className="ml-auto flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            实时
          </span>
        </CardTitle>
        <CardDescription className="text-xs">
          调度器会读取以下任务，状态每 5 秒自动更新。
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        {tasks.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <ListTodoIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              暂无任务，可在对话中让调度器创建
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              {tasks.map((task) => (
                <TaskContextItem key={task.id} task={task} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
