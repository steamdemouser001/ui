"use client"

import * as React from "react"
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react"

import { apiGet } from "@/lib/gepa/client"
import type { MonitorSnapshot } from "@/lib/gepa/monitor"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Card, CardContent, CardHeader } from "@/registry/new-york-v4/ui/card"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import { Switch } from "@/registry/new-york-v4/ui/switch"

import { AgentDistribution } from "./agent-distribution"
import { formatClock } from "./format"
import { MetricCards } from "./metric-cards"
import { RecentCalls } from "./recent-calls"
import { TaskProgressTable } from "./task-progress-table"
import { UsageTrendChart } from "./usage-trend-chart"

const REFRESH_INTERVAL_MS = 5000

// SSE 断连后的退避重连间隔；耗尽后降级为轮询。
const SSE_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000]

type LoadMode = "initial" | "silent"

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function MonitorSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 7 }).map((_, index) => (
          <Card key={index} className="gap-3 py-5">
            <CardHeader className="px-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
            </CardHeader>
            <CardContent className="px-5">
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-[340px] w-full rounded-xl" />
      <Skeleton className="h-[220px] w-full rounded-xl" />
      <Skeleton className="h-[260px] w-full rounded-xl" />
    </div>
  )
}

interface ErrorStateProps {
  error: string | null
  retrying: boolean
  onRetry: () => void
}

function ErrorState({ error, retrying, onRetry }: ErrorStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircleIcon className="size-6 text-destructive" />
        <div className="space-y-1">
          <div className="font-medium">加载监控数据失败</div>
          <div className="max-w-lg text-sm text-muted-foreground">
            {error ?? "未知错误"}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying && <RefreshCwIcon className="animate-spin" />}
          重试
        </Button>
      </CardContent>
    </Card>
  )
}

export function MonitorDashboard() {
  const [snapshot, setSnapshot] = React.useState<MonitorSnapshot | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = React.useState(true)
  const [liveMode, setLiveMode] = React.useState<"sse" | "poll">("sse")
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<string | null>(null)
  const inFlightRef = React.useRef(false)

  const load = React.useCallback(async (mode: LoadMode) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (mode === "initial") {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const data = await apiGet<MonitorSnapshot>("/api/gepa/monitor")
      setSnapshot(data)
      setLastUpdatedAt(new Date().toISOString())
      setError(null)
    } catch (loadError) {
      // 保留旧快照，仅提示本次刷新失败，避免页面闪烁。
      setError(errorText(loadError, "加载监控数据失败"))
    } finally {
      inFlightRef.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void load("initial")
  }, [load])

  // 自动刷新优先使用 SSE 实时推送；断连后按指数退避重连，耗尽后才降级为轮询。
  React.useEffect(() => {
    if (!autoRefresh) return
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      setLiveMode("poll")
      return
    }

    let disposed = false
    let retryCount = 0
    let retryTimer: number | null = null
    let source: EventSource | null = null

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const connect = () => {
      if (disposed) return
      source = new EventSource("/api/gepa/monitor/events")

      const handleSnapshot = (event: Event) => {
        if (disposed) return
        try {
          const data = JSON.parse(
            (event as MessageEvent<string>).data
          ) as MonitorSnapshot
          // 成功收到快照说明连接已恢复，重置退避计数。
          retryCount = 0
          setSnapshot(data)
          setLastUpdatedAt(new Date().toISOString())
          setError(null)
          setLoading(false)
          setLiveMode("sse")
        } catch {
          // 忽略无法解析的快照
        }
      }
      const handleError = () => {
        if (disposed) return
        // EventSource 自带重连不可控，先关闭再按退避间隔自行重连。
        source?.close()
        source = null
        if (retryCount >= SSE_RETRY_DELAYS_MS.length) {
          setLiveMode("poll")
          return
        }
        const delay = SSE_RETRY_DELAYS_MS[retryCount]
        retryCount += 1
        clearRetry()
        retryTimer = window.setTimeout(connect, delay)
      }

      source.addEventListener("snapshot", handleSnapshot)
      source.addEventListener("error", handleError)
    }

    connect()

    return () => {
      disposed = true
      clearRetry()
      source?.close()
      source = null
    }
  }, [autoRefresh])

  React.useEffect(() => {
    if (!autoRefresh || liveMode !== "poll") return
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      void load("silent")
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [autoRefresh, liveMode, load])

  const handleAutoRefreshChange = (checked: boolean) => {
    setAutoRefresh(checked)
    if (checked) {
      setLiveMode("sse")
      void load("silent")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="monitor-auto-refresh"
            checked={autoRefresh}
            onCheckedChange={handleAutoRefreshChange}
          />
          <Label
            htmlFor="monitor-auto-refresh"
            className="text-sm font-normal text-muted-foreground"
          >
            自动刷新（实时）
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {lastUpdatedAt
              ? `更新于 ${formatClock(lastUpdatedAt)}`
              : "尚未加载"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load("silent")}
            disabled={refreshing || loading}
          >
            <RefreshCwIcon
              className={refreshing ? "animate-spin" : undefined}
            />
            刷新
          </Button>
        </div>
      </div>

      {error && snapshot && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>刷新失败，正在展示上次数据</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !snapshot ? (
        <MonitorSkeleton />
      ) : !snapshot ? (
        <ErrorState
          error={error}
          retrying={loading || refreshing}
          onRetry={() => void load("initial")}
        />
      ) : (
        <>
          <MetricCards snapshot={snapshot} />
          <UsageTrendChart snapshot={snapshot} />
          <AgentDistribution snapshot={snapshot} />
          <TaskProgressTable tasks={snapshot.tasks} />
          <RecentCalls calls={snapshot.recentCalls} />
        </>
      )}
    </div>
  )
}
