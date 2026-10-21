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

type LoadMode = "initial" | "silent"

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function MonitorSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
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

  React.useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      void load("silent")
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [autoRefresh, load])

  const handleAutoRefreshChange = (checked: boolean) => {
    setAutoRefresh(checked)
    if (checked) void load("silent")
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
            自动刷新（5 秒）
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
