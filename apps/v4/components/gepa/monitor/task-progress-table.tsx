import Link from "next/link"
import { ArrowRightIcon, ListTodoIcon } from "lucide-react"

import type { TaskProgress } from "@/lib/gepa/monitor"
import type { TaskStatus } from "@/lib/gepa/types"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/registry/new-york-v4/ui/empty"
import { Progress } from "@/registry/new-york-v4/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/registry/new-york-v4/ui/table"

import { formatDateTime, formatNumber } from "./format"

const STATUS_META: Record<
  TaskStatus,
  { label: string; className: string; dot: boolean }
> = {
  draft: {
    label: "草稿",
    className: "border-border bg-muted text-muted-foreground",
    dot: false,
  },
  ready: {
    label: "就绪",
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    dot: false,
  },
  running: {
    label: "运行中",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: true,
  },
  paused: {
    label: "已暂停",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: false,
  },
  completed: {
    label: "已完成",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: false,
  },
  failed: {
    label: "失败",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    dot: false,
  },
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.dot && (
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
      )}
      {meta.label}
    </Badge>
  )
}

function TaskRow({ task }: { task: TaskProgress }) {
  const budgetPercent =
    task.budget > 0
      ? Math.min(100, Math.round((task.budgetUsed / task.budget) * 100))
      : 0

  return (
    <TableRow>
      <TableCell className="min-w-40">
        <div className="font-medium">{task.name}</div>
        <div className="font-mono text-xs text-muted-foreground">{task.id}</div>
      </TableCell>
      <TableCell>
        <StatusBadge status={task.status} />
      </TableCell>
      <TableCell className="min-w-36">
        <div className="space-y-1">
          <div className="text-sm tabular-nums">
            第 {formatNumber(task.iteration)} 轮
          </div>
          <Progress value={budgetPercent} className="h-1.5 w-24" />
          <div className="text-xs text-muted-foreground tabular-nums">
            {task.budget > 0
              ? `预算 ${formatNumber(task.budgetUsed)} / ${formatNumber(task.budget)}`
              : "未设置预算"}
          </div>
        </div>
      </TableCell>
      <TableCell className="tabular-nums">
        {task.bestScore === null ? "—" : task.bestScore.toFixed(3)}
      </TableCell>
      <TableCell className="tabular-nums">
        {formatNumber(task.candidates)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDateTime(task.updatedAt)}
      </TableCell>
      <TableCell className="text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href={task.href}>
            查看
            <ArrowRightIcon />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

interface TaskProgressTableProps {
  tasks: TaskProgress[]
}

export function TaskProgressTable({ tasks }: TaskProgressTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>任务进度</CardTitle>
        <CardDescription>
          每个任务最新一次运行的迭代轮次、预算消耗、最佳得分与候选数量。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <Empty className="py-8 md:py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListTodoIcon />
              </EmptyMedia>
              <EmptyTitle>暂无任务</EmptyTitle>
              <EmptyDescription>
                创建任务并启动运行后，这里会显示每个任务的迭代进度。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/gepa/tasks">前往任务页</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>迭代 / 预算</TableHead>
                <TableHead>最佳分</TableHead>
                <TableHead>候选数</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
