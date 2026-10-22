"use client"

import * as React from "react"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/gepa/client"
import type {
  GlobalConstraints,
  GlobalSettings,
  HarnessConfig,
  IterationDefaults,
  MonitorConfig,
} from "@/lib/gepa/types"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Card, CardContent, CardHeader } from "@/registry/new-york-v4/ui/card"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"

import { ConfigTransfer } from "./config-transfer"
import { DataCard } from "./data-card"
import { SettingsForm } from "./settings-form"
import type { SettingsAction } from "./types"
import { errorText } from "./utils"

interface ConstraintsResponse {
  constraints: GlobalConstraints
  dataRoot: string
}

interface DataRootResponse {
  dataRoot: string
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function GepaSettings() {
  const [settings, setSettings] = React.useState<GlobalSettings | null>(null)
  const [dataRoot, setDataRoot] = React.useState<string | null>(null)
  const [dataRootError, setDataRootError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [savingAction, setSavingAction] = React.useState<SettingsAction | null>(
    null
  )
  const [formRevision, setFormRevision] = React.useState(0)

  const loadDataRoot = React.useCallback(async () => {
    setDataRootError(null)
    try {
      const data = await apiGet<DataRootResponse>("/api/gepa/constraints")
      setDataRoot(data.dataRoot)
    } catch (rootError) {
      setDataRootError(errorText(rootError, "读取数据目录失败"))
    }
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    setDataRootError(null)
    try {
      const [settingsResult, constraintsResult] = await Promise.allSettled([
        apiGet<GlobalSettings>("/api/gepa/settings"),
        apiGet<ConstraintsResponse>("/api/gepa/constraints"),
      ])

      if (settingsResult.status === "rejected") {
        throw settingsResult.reason
      }
      setSettings(settingsResult.value)

      if (constraintsResult.status === "fulfilled") {
        setDataRoot(constraintsResult.value.dataRoot)
      } else {
        setDataRootError(
          errorText(constraintsResult.reason, "读取数据目录失败")
        )
      }
    } catch (loadError) {
      setError(errorText(loadError, "加载设置失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function persist(
    patch: Partial<GlobalSettings>,
    action: SettingsAction,
    successMessage: string
  ): Promise<GlobalSettings | null> {
    setSavingAction(action)
    try {
      const updated = await apiPatch<GlobalSettings>(
        "/api/gepa/settings",
        patch
      )
      setSettings(updated)
      if (action === "import" || action === "reset") {
        setFormRevision((value) => value + 1)
      }
      toast.success(successMessage)
      return updated
    } catch (saveError) {
      toast.error(errorText(saveError, "保存设置失败"))
      return null
    } finally {
      setSavingAction(null)
    }
  }

  function handleSaveIteration(
    value: IterationDefaults
  ): Promise<GlobalSettings | null> {
    return persist({ iteration: value }, "iteration", "迭代默认参数已保存")
  }

  function handleSaveMonitor(
    value: MonitorConfig
  ): Promise<GlobalSettings | null> {
    return persist({ monitor: value }, "monitor", "监控与成本设置已保存")
  }

  function handleSaveHarness(
    value: HarnessConfig
  ): Promise<GlobalSettings | null> {
    return persist({ harness: value }, "harness", "执行 Harness 设置已保存")
  }

  async function handleApply(
    patch: Partial<GlobalSettings>,
    action: "import" | "reset"
  ): Promise<boolean> {
    const updated = await persist(
      patch,
      action,
      action === "import" ? "配置已导入" : "已恢复默认设置"
    )
    return updated !== null
  }

  if (loading) {
    return <SettingsSkeleton />
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>加载设置失败</AlertTitle>
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
    )
  }

  if (!settings) {
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>暂无设置</AlertTitle>
        <AlertDescription>
          <p>未获取到设置数据，请重试。</p>
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
    )
  }

  return (
    <div className="space-y-4">
      <SettingsForm
        key={formRevision}
        settings={settings}
        savingAction={savingAction}
        onSaveIteration={handleSaveIteration}
        onSaveMonitor={handleSaveMonitor}
        onSaveHarness={handleSaveHarness}
      />
      <DataCard
        dataRoot={dataRoot}
        error={dataRootError}
        onRetry={() => void loadDataRoot()}
      />
      <ConfigTransfer
        settings={settings}
        savingAction={savingAction}
        onApply={handleApply}
      />
    </div>
  )
}
