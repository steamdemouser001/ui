"use client"

import * as React from "react"
import {
  DownloadIcon,
  Loader2Icon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet } from "@/lib/gepa/client"
import { createDefaultSettings } from "@/lib/gepa/defaults"
import type { AgentConfig, GlobalSettings, LlmProvider } from "@/lib/gepa/types"
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
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Separator } from "@/registry/new-york-v4/ui/separator"

import type { SettingsAction } from "./types"
import { errorText } from "./utils"
import { parseSettingsImport } from "./validation"

interface ConfigTransferProps {
  settings: GlobalSettings
  savingAction: SettingsAction | null
  onApply: (
    patch: Partial<GlobalSettings>,
    action: "import" | "reset"
  ) => Promise<boolean>
}

interface ProviderListResponse {
  providers: LlmProvider[]
  defaultProviderId: string | null
}

interface AgentListResponse {
  agents: AgentConfig[]
}

function buildFileName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
  return `gepa-config-${stamp}.json`
}

function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ConfigTransfer({
  settings,
  savingAction,
  onApply,
}: ConfigTransferProps) {
  const [exporting, setExporting] = React.useState(false)
  const [readingFile, setReadingFile] = React.useState(false)
  const [importError, setImportError] = React.useState<string | null>(null)
  const [resetOpen, setResetOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const busy = savingAction !== null
  const importing = readingFile || savingAction === "import"
  const resetting = savingAction === "reset"

  async function handleExport() {
    setExporting(true)
    try {
      const [settingsData, providersData, agentsData] = await Promise.all([
        apiGet<GlobalSettings>("/api/gepa/settings"),
        apiGet<ProviderListResponse>("/api/gepa/llm/providers"),
        apiGet<AgentListResponse>("/api/gepa/agents"),
      ])
      const payload = {
        app: "gepa-console",
        exportedAt: new Date().toISOString(),
        note: "API Key 已掩码，导出内容不包含真实密钥。",
        settings: settingsData,
        providers: providersData.providers,
        agents: agentsData.agents,
      }
      downloadJson(payload, buildFileName())
      toast.success("配置已导出（密钥为掩码值）")
    } catch (error) {
      toast.error(errorText(error, "导出配置失败"))
    } finally {
      setExporting(false)
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    setReadingFile(true)
    setImportError(null)
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new Error("文件不是合法的 JSON")
      }

      const result = parseSettingsImport(parsed)
      if (!result.ok) {
        setImportError(result.message)
        toast.error(result.message)
        return
      }

      const patch: Partial<GlobalSettings> = {}
      if (result.value.iteration) {
        patch.iteration = { ...settings.iteration, ...result.value.iteration }
      }
      if (result.value.monitor) {
        patch.monitor = { ...settings.monitor, ...result.value.monitor }
      }
      if (result.value.constraints) {
        patch.constraints = {
          tools: {
            ...settings.constraints.tools,
            ...(result.value.constraints.tools ?? {}),
          },
          bash: {
            ...settings.constraints.bash,
            ...(result.value.constraints.bash ?? {}),
          },
        }
      }

      await onApply(patch, "import")
    } catch (error) {
      const message = errorText(error, "导入配置失败")
      setImportError(message)
      toast.error(message)
    } finally {
      setReadingFile(false)
    }
  }

  async function handleReset() {
    const defaults = createDefaultSettings()
    const success = await onApply(
      {
        iteration: defaults.iteration,
        monitor: defaults.monitor,
        constraints: defaults.constraints,
      },
      "reset"
    )
    if (success) setResetOpen(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>配置导出与导入</CardTitle>
        <CardDescription>
          导出的 JSON 可用于备份或迁移；API Key 只导出掩码值，不会泄露真实密钥。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">导出配置</p>
            <p className="text-sm text-muted-foreground">
              合并设置、LLM 供应商与 Agent 配置为一个 JSON 文件下载。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void handleExport()}
            disabled={exporting || busy}
          >
            {exporting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <DownloadIcon />
            )}
            导出 JSON
          </Button>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">导入配置</p>
            <p className="text-sm text-muted-foreground">
              仅导入 settings 中的 iteration、monitor 与 constraints
              字段；不会覆盖供应商、Agent 与默认供应商配置。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleFileChange(event)}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing || busy}
            >
              {importing ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <UploadIcon />
              )}
              选择 JSON 文件
            </Button>
          </div>
        </div>
        {importError && (
          <p className="text-sm text-destructive">{importError}</p>
        )}

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">恢复默认</p>
            <p className="text-sm text-muted-foreground">
              重置迭代默认参数、监控与成本、全局约束；默认供应商保持不变。
            </p>
          </div>
          <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
            <Button
              variant="outline"
              onClick={() => setResetOpen(true)}
              disabled={busy}
            >
              {resetting ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RotateCcwIcon />
              )}
              恢复默认
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>恢复默认设置</AlertDialogTitle>
                <AlertDialogDescription>
                  将把迭代默认参数、监控与成本、全局约束恢复为内置默认值。
                  默认供应商、供应商与 Agent 配置不受影响。此操作不可撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={resetting}
                  onClick={(event) => {
                    event.preventDefault()
                    void handleReset()
                  }}
                >
                  {resetting && <Loader2Icon className="animate-spin" />}
                  确认恢复
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}
