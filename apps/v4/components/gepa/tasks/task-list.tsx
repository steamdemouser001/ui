"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowRightIcon,
  ListTodoIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiDelete, apiGet } from "@/lib/gepa/client"
import type { TaskRecord } from "@/lib/gepa/types"
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
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"

import {
  errorText,
  formatDateTime,
  formatScore,
  percent,
} from "./format"
import { TaskStatusBadge } from "./status-badge"
import { TaskCreateDialog } from "./task-create-dialog"
import type { TaskSummary } from "./types"

interface TasksResponse {
  tasks: TaskSummary[]
}

function TaskCard({
  task,
  onDelete,
}: {
  task: TaskSummary
  onDelete: (task: TaskSummary) => void
}) {
  const run = task.run
  const budget = run?.budget ?? task.iteration.budget
  const budgetUsed = run?.budgetUsed ?? 0
  const progress = percent(budgetUsed, budget)
  const href = `/gepa/tasks/${task.id}`

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Link href={href} className="truncate hover:underline">
                {task.name}
              </Link>
              <TaskStatusBadge status={task.status} />
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {task.description || "暂无描述"}
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={href}>
              打开
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">模块</p>
            <p className="font-medium tabular-nums">{task.modules}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">数据集</p>
            <p className="font-medium tabular-nums">{task.dataset} 条</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">迭代 / 预算</p>
            <p className="font-medium tabular-nums">
              {run ? `${run.iteration} 轮` : "未运行"} · {budgetUsed}/{budget}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">最佳分</p>
            <p className="font-medium tabular-nums">
              {formatScore(run?.bestScore)}
            </p>
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          更新于 {formatDateTime(task.updatedAt)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(task)}
        >
          <Trash2Icon />
          删除
        </Button>
      </CardFooter>
    </Card>
  )
}

export function TaskList() {
  const [tasks, setTasks] = React.useState<TaskSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<TaskSummary | null>(
    null
  )
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<TasksResponse>("/api/gepa/tasks")
      setTasks(data.tasks)
    } catch (loadError) {
      setError(errorText(loadError, "加载任务列表失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function handleCreated(_task: TaskRecord) {
    void load()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete<{ id: string }>(`/api/gepa/tasks/${deleteTarget.id}`)
      toast.success(`已删除任务「${deleteTarget.name}」`)
      setDeleteTarget(null)
      await load()
    } catch (deleteError) {
      toast.error(errorText(deleteError, "删除任务失败"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">任务列表</h2>
          <p className="text-sm text-muted-foreground">
            共 {tasks.length} 个任务
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            刷新
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon />
            新建任务
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((index) => (
            <Card key={index} className="gap-4">
              <CardHeader>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-2 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="mt-2"
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : tasks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ListTodoIcon className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">还没有任务</p>
              <p className="text-sm text-muted-foreground">
                创建第一个任务，配置技能模块与数据集后即可启动 GEPA 迭代。
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <PlusIcon />
              新建任务
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onDelete={setDeleteTarget} />
          ))}
        </div>
      )}

      <TaskCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.name}」吗？任务的工作空间、运行记录与对话历史都会被删除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {deleting && <Loader2Icon className="animate-spin" />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
