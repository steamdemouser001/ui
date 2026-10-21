"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  StepForwardIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/gepa/client"
import type { RunState } from "@/lib/gepa/types"
import { Alert, AlertDescription, AlertTitle } from "@/registry/new-york-v4/ui/alert"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/registry/new-york-v4/ui/card"
import { Progress } from "@/registry/new-york-v4/ui/progress"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/registry/new-york-v4/ui/tabs"

import { DatasetTab } from "./dataset-tab"
import { errorText, formatDateTime, formatScore, percent } from "./format"
import { OrchestratorTab } from "./orchestrator-tab"
import { RunTab } from "./run-tab"
import { SkillTab } from "./skill-tab"
import { TaskStatusBadge } from "./status-badge"
import type { TaskDetailData } from "./types"
import { WorkspaceTab } from "./workspace-tab"

type RunAction = "start" | "pause" | "resume" | "stop" | "step"

const ACTION_TOAST: Record<RunAction, string> = {
  start: "已开始运行",
  pause: "已请求暂停",
  resume: "已继续运行",
  stop: "已请求停止",
  step: "已执行单步迭代",
}

function HeaderStat({
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
      <p className="text-sm font-medium tabular-nums">{value}</p>
      {hint && (
        <p className="truncate text-xs text-muted-foreground" title={hint}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const [detail, setDetail] = React.useState<TaskDetailData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<RunAction | "refresh" | null>(null)
  const requestSeq = React.useRef(0)

  const load = React.useCallback(
    async (silent = false) => {
      const requestId = ++requestSeq.current
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      try {
        const data = await apiGet<TaskDetailData>(
          `/api/gepa/tasks/${taskId}`
        )
        // 只应用最新一次请求，避免轮询与手动刷新互相覆盖。
        if (requestId !== requestSeq.current) return
        setDetail(data)
        setError(null)
      } catch (loadError) {
        if (requestId === requestSeq.current && !silent) {
          setError(errorText(loadError, "加载任务详情失败"))
        }
      } finally {
        // 静默轮询只有在仍是最新请求时才收尾，避免覆盖更新的加载状态。
        if (!silent || requestId === requestSeq.current) {
          setLoading(false)
        }
      }
    },
    [taskId]
  )

  React.useEffect(() => {
    void load()
  }, [load])

  const runStatus = detail?.run?.status ?? null
  const taskStatus = detail?.task.status ?? null
  const shouldPoll = runStatus === "running" || taskStatus === "running"

  React.useEffect(() => {
    if (!shouldPoll) return
    const timer = window.setInterval(() => {
      void load(true)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [shouldPoll, load])

  async function handleAction(action: RunAction) {
    setBusy(action)
    try {
      await apiPost<{ run: RunState }>(`/api/gepa/tasks/${taskId}/run`, {
        action,
      })
      toast.success(ACTION_TOAST[action])
      await load(true)
    } catch (actionError) {
      toast.error(errorText(actionError, "操作失败"))
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 py-6 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/gepa/tasks">
            <ArrowLeftIcon />
            返回任务列表
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>
            <p>{error ?? "任务不存在或已被删除"}</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
              >
                重试
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/gepa/tasks">返回任务列表</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const { task, run } = detail
  const budget = run?.budget ?? task.iteration.budget
  const budgetUsed = run?.budgetUsed ?? 0
  const bestCandidate = run?.candidates.find(
    (candidate) => candidate.id === run.bestCandidateId
  )
  const canStart =
    !runStatus ||
    runStatus === "completed" ||
    runStatus === "stopped" ||
    runStatus === "failed" ||
    runStatus === "idle"
  const canPause = runStatus === "running"
  const canResume = runStatus === "paused"
  const canStop = runStatus === "running" || runStatus === "paused"
  const canStep = runStatus !== "running"
  const actionBusy = busy !== null

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href="/gepa/tasks">
                <ArrowLeftIcon />
                任务列表
              </Link>
            </Button>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="break-words">{task.name}</span>
              <TaskStatusBadge status={task.status} />
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {task.description || "暂无描述"}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{task.id}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={actionBusy}
            >
              <RefreshCwIcon />
              刷新
            </Button>
            {canStart && (
              <Button
                size="sm"
                onClick={() => void handleAction("start")}
                disabled={actionBusy}
              >
                {busy === "start" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <PlayIcon />
                )}
                开始
              </Button>
            )}
            {canPause && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAction("pause")}
                disabled={actionBusy}
              >
                {busy === "pause" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <PauseIcon />
                )}
                暂停
              </Button>
            )}
            {canResume && (
              <Button
                size="sm"
                onClick={() => void handleAction("resume")}
                disabled={actionBusy}
              >
                {busy === "resume" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <RotateCcwIcon />
                )}
                继续
              </Button>
            )}
            {canStop && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAction("stop")}
                disabled={actionBusy}
              >
                {busy === "stop" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SquareIcon />
                )}
                停止
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleAction("step")}
              disabled={actionBusy || !canStep}
            >
              {busy === "step" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <StepForwardIcon />
              )}
              单步
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <HeaderStat
                label="迭代"
                value={`${run?.iteration ?? 0} / ${task.iteration.maxIterations}`}
              />
              <HeaderStat
                label="预算"
                value={`${budgetUsed} / ${budget}`}
              />
              <HeaderStat
                label="最佳分"
                value={formatScore(bestCandidate?.averageScore)}
                hint={run?.bestCandidateId ?? undefined}
              />
              <HeaderStat label="候选" value={run?.candidates.length ?? 0} />
              <HeaderStat
                label="模块 / 数据集"
                value={`${task.modules.length} / ${task.dataset.length}`}
              />
              <HeaderStat
                label="更新时间"
                value={
                  <span className="text-xs">
                    {formatDateTime(run?.updatedAt ?? task.updatedAt)}
                  </span>
                }
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>预算使用</span>
                <span className="tabular-nums">
                  {percent(budgetUsed, budget)}%
                </span>
              </div>
              <Progress value={percent(budgetUsed, budget)} />
            </div>
            {run?.error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {run.error}
              </div>
            )}
          </CardContent>
        </Card>
      </header>

      <Tabs defaultValue="run" className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="run">运行</TabsTrigger>
          <TabsTrigger value="skill">技能</TabsTrigger>
          <TabsTrigger value="dataset">数据集</TabsTrigger>
          <TabsTrigger value="workspace">工作空间</TabsTrigger>
          <TabsTrigger value="orchestrator">总控</TabsTrigger>
        </TabsList>

        <TabsContent value="run">
          <RunTab detail={detail} />
        </TabsContent>
        <TabsContent value="skill">
          <SkillTab
            taskId={taskId}
            task={task}
            onRefresh={() => load(true)}
          />
        </TabsContent>
        <TabsContent value="dataset">
          <DatasetTab
            taskId={taskId}
            task={task}
            onRefresh={() => load(true)}
          />
        </TabsContent>
        <TabsContent value="workspace">
          <WorkspaceTab taskId={taskId} />
        </TabsContent>
        <TabsContent value="orchestrator">
          <OrchestratorTab
            taskId={taskId}
            messages={detail.messages}
            onRefresh={() => load(true)}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
