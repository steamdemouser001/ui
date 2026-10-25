import Link from "next/link"
import { ArrowRightIcon, ListTodoIcon } from "lucide-react"

import type { TaskProgress } from "@/lib/gepa/monitor"
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

import { TaskStatusBadge } from "../tasks/status-badge"
import { formatDateTime, formatNumber } from "./format"

const PAUSING_BADGE_CLASS =
  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"

function StatusCell({ task }: { task: TaskProgress }) {
  return (
    <TableCell>
      <div className="space-y-1.5">
        <TaskStatusBadge status={task.status} />
        {task.status === "running" && task.liveLabel && (
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={task.liveLabel}
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
            <span className="truncate">{task.liveLabel}</span>
          </div>
        )}
        {task.pausing && (
          <Badge variant="outline" className={PAUSING_BADGE_CLASS}>
            暂停中/停止中…
          </Badge>
        )}
        {task.awaitingApproval && (
          <Badge
            variant="outline"
            className={PAUSING_BADGE_CLASS}
            title="存在等待人工审批的候选，请在任务详情处理"
          >
            待审批
          </Badge>
        )}
      </div>
    </TableCell>
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
      <StatusCell task={task} />
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
