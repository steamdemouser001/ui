"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  HistoryIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  StepForwardIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/gepa/client"
import type { RunEvent, RunProgress, RunState } from "@/lib/gepa/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/registry/new-york-v4/ui/alert-dialog"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Card, CardContent } from "@/registry/new-york-v4/ui/card"
import { Input } from "@/registry/new-york-v4/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/registry/new-york-v4/ui/popover"
import { Progress } from "@/registry/new-york-v4/ui/progress"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/registry/new-york-v4/ui/tabs"

import { ApprovalBanner } from "./approval-banner"
import { DatasetTab } from "./dataset-tab"
import { errorText, formatDateTime, formatScore, percent } from "./format"
import { LiveProgress, pickFresherProgress } from "./live-progress"
import { OrchestratorTab } from "./orchestrator-tab"
import { LATEST_RUN_VALUE, RunHistory } from "./run-history"
import { RunTab } from "./run-tab"
import { SkillTab } from "./skill-tab"
import { StartOptionsDialog, type StartOptions } from "./start-options-dialog"
import { TaskStatusBadge } from "./status-badge"
import type { RunDetailResponse, TaskDetailData } from "./types"
import { WorkspaceTab } from "./workspace-tab"

type RunAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "step"
  | "approve"
  | "reject"

const ACTION_TOAST: Record<RunAction, string> = {
  start: "已开始运行",
  pause: "已请求暂停",
  resume: "已继续运行",
  stop: "已请求停止",
  step: "已执行单步迭代",
  approve: "已批准候选，运行继续",
  reject: "已否决候选，运行保持暂停",
}

// SSE 断线重连：2s/4s/8s/16s/32s，最多 5 次，之后降级轮询。
const SSE_RETRY_BASE_MS = 2000
const SSE_MAX_RETRIES = 5

function HeaderStat({
  label,
  value,
  hint,
  action,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <p className="text-sm font-medium tabular-nums">{value}</p>
        {action}
      </div>
      {hint && (
        <p className="truncate text-xs text-muted-foreground" title={hint}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** 运行中调整预算：预算格旁的小编辑按钮 + Popover 输入。 */
function BudgetEditor({
  taskId,
  budget,
  onAdjusted,
}: {
  taskId: string
  budget: number
  onAdjusted: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState(String(budget))
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    const parsed = Number(value.trim())
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("预算必须是正数")
      return
    }
    setBusy(true)
    try {
      const result = await apiPost<{ run: RunState | null }>(
        `/api/gepa/tasks/${taskId}/run`,
        { action: "setBudget", budget: parsed }
      )
      if (result.run) {
        toast.success(`预算已实时调整为 ${parsed}`)
      } else {
        toast.info(`预算默认值已调整为 ${parsed}（当前没有活动运行）`)
      }
      setOpen(false)
      onAdjusted()
    } catch (error) {
      toast.error(errorText(error, "调整预算失败"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // 每次打开都回到当前预算值。
        if (next) setValue(String(budget))
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label="调整预算"
        >
          <PencilIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-2" align="start">
        <p className="text-xs text-muted-foreground">
          运行中实时调整预算（当前 {budget}）
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={value}
            inputMode="numeric"
            aria-label="新预算"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit()
            }}
          />
          <Button size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : "确定"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const [detail, setDetail] = React.useState<TaskDetailData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<RunAction | "refresh" | null>(null)
  const [liveMode, setLiveMode] = React.useState<"sse" | "poll">("sse")
  const [startOpen, setStartOpen] = React.useState(false)
  const [stopOpen, setStopOpen] = React.useState(false)
  // 事件流带来的实时进度（run-event），无事件时回落到快照 run.progress。
  const [eventProgress, setEventProgress] = React.useState<RunProgress | null>(
    null
  )
  // 历史视图：选中的历史运行 id 与其完整状态。
  const [historicalId, setHistoricalId] = React.useState<string | null>(null)
  const [historicalRun, setHistoricalRun] = React.useState<RunState | null>(
    null
  )
  const [historicalLoading, setHistoricalLoading] = React.useState(false)
  const requestSeq = React.useRef(0)
  // SSE 事件处理器读取最新 busy，避免本页操作与 approval-resolved 事件重复 toast。
  const busyRef = React.useRef<RunAction | "refresh" | null>(null)

  const load = React.useCallback(
    async (silent = false) => {
      const requestId = ++requestSeq.current
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      try {
        const data = await apiGet<TaskDetailData>(`/api/gepa/tasks/${taskId}`)
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

  // 实时快照与运行事件：SSE 断开后按退避重连，重连耗尽才降级轮询。
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      setLiveMode("poll")
      return
    }

    let disposed = false
    let source: EventSource | null = null
    let retryTimer: number | null = null
    let retries = 0

    const connect = () => {
      if (disposed) return
      source = new EventSource(`/api/gepa/tasks/${taskId}/events`)

      const handleSnapshot = (event: Event) => {
        if (disposed) return
        try {
          const data = JSON.parse(
            (event as MessageEvent<string>).data
          ) as TaskDetailData
          // 收到快照即视为连接正常：恢复 live 模式并重置退避计数。
          retries = 0
          setLiveMode("sse")
          // 让仍在途中的手动请求失效，避免旧快照覆盖实时数据。
          requestSeq.current += 1
          setDetail(data)
          setError(null)
          setLoading(false)
        } catch {
          // 忽略无法解析的快照
        }
      }

      const handleRunEvent = (event: Event) => {
        if (disposed) return
        try {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data
          ) as RunEvent
          const data = payload.data ?? {}
          if (payload.type === "progress") {
            const progress = data.progress as RunProgress | undefined
            if (progress) setEventProgress(progress)
          } else if (payload.type === "tool-activity") {
            const name = data.name
            if (typeof name === "string" && name) {
              setEventProgress((prev) =>
                prev ? { ...prev, toolName: name } : prev
              )
            }
          } else if (payload.type === "approval-requested") {
            const iteration = data.iteration
            toast.info(
              typeof iteration === "number"
                ? `第 ${iteration} 轮候选等待审批`
                : "有候选等待审批"
            )
            void load(true)
          } else if (payload.type === "approval-resolved") {
            // 本页点击批准/否决时已由 handleAction 提示，跳过重复 toast。
            if (busyRef.current !== "approve" && busyRef.current !== "reject") {
              toast.info("审批已处理")
            }
            void load(true)
          }
        } catch {
          // 忽略无法解析的事件
        }
      }

      source.addEventListener("snapshot", handleSnapshot)
      source.addEventListener("run-event", handleRunEvent)
      source.addEventListener("error", () => {
        if (disposed) return
        source?.close()
        source = null
        if (retries >= SSE_MAX_RETRIES) {
          // 重连耗尽：降级轮询。
          setLiveMode("poll")
          return
        }
        const delay = SSE_RETRY_BASE_MS * 2 ** retries
        retries += 1
        retryTimer = window.setTimeout(connect, delay)
      })
    }

    connect()
    return () => {
      disposed = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [taskId, load])

  const runStatus = detail?.run?.status ?? null
  const taskStatus = detail?.task.status ?? null
  const shouldPoll = runStatus === "running" || taskStatus === "running"

  React.useEffect(() => {
    if (liveMode !== "poll" || !shouldPoll) return
    const timer = window.setInterval(() => {
      // 页面隐藏时跳过轮询。
      if (document.visibilityState === "hidden") return
      void load(true)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [liveMode, shouldPoll, load])

  // 切换到新运行时清空事件流进度，避免上一轮的进度残留。
  const liveRunId = detail?.run?.id ?? null
  const seenRunId = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (liveRunId && seenRunId.current !== liveRunId) {
      seenRunId.current = liveRunId
      setEventProgress(null)
    }
  }, [liveRunId])

  async function handleAction(
    action: RunAction,
    body?: Record<string, unknown>
  ) {
    setBusy(action)
    busyRef.current = action
    try {
      await apiPost<{ run: RunState | null }>(`/api/gepa/tasks/${taskId}/run`, {
        action,
        ...body,
      })
      toast.success(ACTION_TOAST[action])
      if (action === "start") setStartOpen(false)
      await load(true)
    } catch (actionError) {
      toast.error(errorText(actionError, "操作失败"))
    } finally {
      setBusy(null)
      busyRef.current = null
    }
  }

  async function selectRun(value: string) {
    if (value === LATEST_RUN_VALUE) {
      setHistoricalId(null)
      setHistoricalRun(null)
      return
    }
    setHistoricalId(value)
    setHistoricalRun(null)
    setHistoricalLoading(true)
    try {
      const data = await apiGet<RunDetailResponse>(
        `/api/gepa/tasks/${taskId}/runs/${value}`
      )
      setHistoricalRun(data.run)
    } catch (runError) {
      toast.error(errorText(runError, "加载历史运行失败"))
      setHistoricalId(null)
    } finally {
      setHistoricalLoading(false)
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
              <Button variant="outline" size="sm" onClick={() => void load()}>
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
  const isHistorical = historicalId != null
  // 历史视图下统计与 RunTab 展示历史运行；控制类状态始终以活动运行（run）为准。
  const viewRun = isHistorical ? historicalRun : run
  const budget = viewRun?.budget ?? task.iteration.budget
  const budgetUsed = viewRun?.budgetUsed ?? 0
  const bestCandidate = viewRun?.candidates.find(
    (candidate) => candidate.id === viewRun.bestCandidateId
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
  const controlsDisabled = actionBusy || isHistorical

  // 事件流进度优先，其次快照进度；仅在运行中/暂停中展示。
  const liveProgress = pickFresherProgress(eventProgress, run?.progress ?? null)
  const showLiveProgress =
    !isHistorical &&
    liveProgress != null &&
    (runStatus === "running" || runStatus === "paused")

  function handleStart(options: StartOptions) {
    return handleAction("start", { ...options })
  }

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
              {!isHistorical && run?.control.pauseRequested && (
                <Badge
                  variant="outline"
                  className="animate-pulse border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                >
                  暂停中…
                </Badge>
              )}
              {!isHistorical && run?.control.stopRequested && (
                <Badge
                  variant="outline"
                  className="animate-pulse border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
                >
                  停止中…
                </Badge>
              )}
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {task.description || "暂无描述"}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{task.id}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {liveMode === "sse" && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                实时
              </span>
            )}
            <RunHistory
              runs={detail.runs}
              value={historicalId ?? LATEST_RUN_VALUE}
              onChange={(value) => void selectRun(value)}
            />
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
                onClick={() => setStartOpen(true)}
                disabled={controlsDisabled}
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
                disabled={controlsDisabled}
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
                disabled={controlsDisabled}
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
              <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={controlsDisabled}
                  >
                    {busy === "stop" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <SquareIcon />
                    )}
                    停止
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认停止运行？</AlertDialogTitle>
                    <AlertDialogDescription>
                      停止会立即终止当前 Claude Code rollout
                      / LLM 调用并结束运行，不可恢复。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => void handleAction("stop")}
                    >
                      确认停止
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleAction("step")}
              disabled={controlsDisabled || !canStep}
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

        {showLiveProgress && liveProgress && (
          <LiveProgress progress={liveProgress} />
        )}

        {!isHistorical && run?.pendingApproval && (
          <ApprovalBanner
            approval={run.pendingApproval}
            busy={actionBusy}
            onResolve={(action) => void handleAction(action)}
          />
        )}

        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <HeaderStat
                label="迭代"
                value={`${viewRun?.iteration ?? 0} / ${task.iteration.maxIterations}`}
              />
              <HeaderStat
                label="预算"
                value={`${budgetUsed} / ${budget}`}
                action={
                  !isHistorical && runStatus === "running" ? (
                    <BudgetEditor
                      taskId={taskId}
                      budget={budget}
                      onAdjusted={() => void load(true)}
                    />
                  ) : undefined
                }
              />
              <HeaderStat
                label="最佳分"
                value={formatScore(bestCandidate?.averageScore)}
                hint={viewRun?.bestCandidateId ?? undefined}
              />
              <HeaderStat label="候选" value={viewRun?.candidates.length ?? 0} />
              <HeaderStat
                label="模块 / 数据集"
                value={`${task.modules.length} / ${task.dataset.length}`}
              />
              <HeaderStat
                label="更新时间"
                value={
                  <span className="text-xs">
                    {formatDateTime(viewRun?.updatedAt ?? task.updatedAt)}
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
            {viewRun?.error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {viewRun.error}
              </div>
            )}
          </CardContent>
        </Card>
      </header>

      {historicalId && (
        <Alert className="border-sky-500/40 bg-sky-500/5">
          <HistoryIcon className="size-4" />
          <AlertTitle>正在查看历史运行</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs">{historicalId}</span>
            {historicalLoading && (
              <span className="text-xs text-muted-foreground">加载中…</span>
            )}
            <span className="text-xs text-muted-foreground">
              运行控制已禁用，返回最新后可继续操作。
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void selectRun(LATEST_RUN_VALUE)}
            >
              <Undo2Icon />
              返回最新
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <StartOptionsDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        task={task}
        busy={busy === "start"}
        onStart={(options) => void handleStart(options)}
      />

      <Tabs defaultValue="run" className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="run">运行</TabsTrigger>
          <TabsTrigger value="skill">技能</TabsTrigger>
          <TabsTrigger value="dataset">数据集</TabsTrigger>
          <TabsTrigger value="workspace">工作空间</TabsTrigger>
          <TabsTrigger value="orchestrator">总控</TabsTrigger>
        </TabsList>

        <TabsContent value="run">
          {historicalId ? (
            historicalRun ? (
              <RunTab detail={{ ...detail, run: historicalRun }} historical />
            ) : (
              <Skeleton className="h-64 w-full" />
            )
          ) : (
            <RunTab detail={detail} />
          )}
        </TabsContent>
        <TabsContent value="skill">
          <SkillTab taskId={taskId} task={task} onRefresh={() => load(true)} />
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
