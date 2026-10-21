"use client"

import * as React from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import type {
  GlobalSettings,
  IterationDefaults,
  MonitorConfig,
} from "@/lib/gepa/types"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"
import { Switch } from "@/registry/new-york-v4/ui/switch"

import type {
  IterationDraft,
  MonitorDraft,
  SettingsAction,
  SettingsDraft,
} from "./types"
import { omitKey } from "./utils"
import { parseIterationDraft, parseMonitorDraft } from "./validation"

interface SettingsFormProps {
  settings: GlobalSettings
  savingAction: SettingsAction | null
  onSaveIteration: (
    value: IterationDefaults
  ) => Promise<GlobalSettings | null>
  onSaveMonitor: (value: MonitorConfig) => Promise<GlobalSettings | null>
}

function iterationToDraft(iteration: IterationDefaults): IterationDraft {
  return {
    budget: String(iteration.budget),
    minibatchSize: String(iteration.minibatchSize),
    paretoSize: String(iteration.paretoSize),
    maxIterations: String(iteration.maxIterations),
    moduleSelection: iteration.moduleSelection,
    mergeEnabled: iteration.mergeEnabled,
  }
}

function monitorToDraft(monitor: MonitorConfig): MonitorDraft {
  return {
    inputCostPerMillion: String(monitor.inputCostPerMillion),
    outputCostPerMillion: String(monitor.outputCostPerMillion),
    retentionDays: String(monitor.retentionDays),
  }
}

function toDraft(settings: GlobalSettings): SettingsDraft {
  return {
    ...iterationToDraft(settings.iteration),
    ...monitorToDraft(settings.monitor),
  }
}

interface NumberFieldProps {
  id: string
  label: string
  hint: string
  value: string
  error?: string
  disabled?: boolean
  onChange: (value: string) => void
}

function NumberField({
  id,
  label,
  hint,
  value,
  error,
  disabled,
  onChange,
}: NumberFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

export function SettingsForm({
  settings,
  savingAction,
  onSaveIteration,
  onSaveMonitor,
}: SettingsFormProps) {
  const [draft, setDraft] = React.useState<SettingsDraft>(() =>
    toDraft(settings)
  )
  const [iterationErrors, setIterationErrors] = React.useState<
    Record<string, string>
  >({})
  const [monitorErrors, setMonitorErrors] = React.useState<
    Record<string, string>
  >({})

  const busy = savingAction !== null
  const savingIteration = savingAction === "iteration"
  const savingMonitor = savingAction === "monitor"

  function updateField<K extends keyof SettingsDraft>(
    key: K,
    value: SettingsDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
    setIterationErrors((current) => omitKey(current, key))
    setMonitorErrors((current) => omitKey(current, key))
  }

  async function handleSaveIteration() {
    const result = parseIterationDraft(draft)
    if (!result.ok) {
      setIterationErrors(result.errors)
      toast.error(result.message)
      return
    }
    setIterationErrors({})
    const updated = await onSaveIteration(result.value)
    if (updated) {
      setDraft((current) => ({
        ...current,
        ...iterationToDraft(updated.iteration),
      }))
    }
  }

  async function handleSaveMonitor() {
    const result = parseMonitorDraft(draft)
    if (!result.ok) {
      setMonitorErrors(result.errors)
      toast.error(result.message)
      return
    }
    setMonitorErrors({})
    const updated = await onSaveMonitor(result.value)
    if (updated) {
      setDraft((current) => ({
        ...current,
        ...monitorToDraft(updated.monitor),
      }))
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>迭代默认参数</CardTitle>
          <CardDescription>
            新建任务时使用的默认迭代配置；创建任务后仍可在任务内单独调整。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="settings-budget"
              label="预算 budget"
              hint="单次运行允许消耗的评估次数上限，1-100000。"
              value={draft.budget}
              error={iterationErrors.budget}
              disabled={busy}
              onChange={(value) => updateField("budget", value)}
            />
            <NumberField
              id="settings-minibatch"
              label="Minibatch 大小"
              hint="每轮参与评估的样本数量，1-50。"
              value={draft.minibatchSize}
              error={iterationErrors.minibatchSize}
              disabled={busy}
              onChange={(value) => updateField("minibatchSize", value)}
            />
            <NumberField
              id="settings-pareto"
              label="帕累托验证样本数 paretoSize"
              hint="从数据集中划分用于候选选择的验证样本数量，1-500。"
              value={draft.paretoSize}
              error={iterationErrors.paretoSize}
              disabled={busy}
              onChange={(value) => updateField("paretoSize", value)}
            />
            <NumberField
              id="settings-max-iterations"
              label="最大迭代轮数 maxIterations"
              hint="单次运行的最大迭代轮数，1-1000。"
              value={draft.maxIterations}
              error={iterationErrors.maxIterations}
              disabled={busy}
              onChange={(value) => updateField("maxIterations", value)}
            />
            <div className="space-y-2">
              <Label htmlFor="settings-module-selection">模块选择策略</Label>
              <Select
                value={draft.moduleSelection}
                disabled={busy}
                onValueChange={(value) =>
                  updateField(
                    "moduleSelection",
                    value as SettingsDraft["moduleSelection"]
                  )
                }
              >
                <SelectTrigger
                  id="settings-module-selection"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round-robin">
                    round-robin（轮流选择）
                  </SelectItem>
                  <SelectItem value="random">random（随机选择）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                round-robin 会依次轮换技能模块，random 每轮随机抽取。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-merge">Merge 合并（预留）</Label>
              <div className="flex h-9 items-center justify-between gap-3 rounded-md border px-3">
                <span className="text-sm text-muted-foreground">
                  {draft.mergeEnabled ? "已开启" : "已关闭"}
                </span>
                <Switch
                  id="settings-merge"
                  checked={draft.mergeEnabled}
                  disabled
                  onCheckedChange={(checked) =>
                    updateField("mergeEnabled", checked)
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                当前版本尚未实现 Merge，开启后不会生效，仅为后续升级预留。
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={() => void handleSaveIteration()} disabled={busy}>
            {savingIteration && <Loader2Icon className="animate-spin" />}
            保存迭代参数
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>监控与成本</CardTitle>
          <CardDescription>
            用于估算 LLM 调用成本，并控制指标日志的保留时长。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              id="settings-input-cost"
              label="输入单价（每百万 Token）"
              hint="用于成本估算，0-100000。"
              value={draft.inputCostPerMillion}
              error={monitorErrors.inputCostPerMillion}
              disabled={busy}
              onChange={(value) =>
                updateField("inputCostPerMillion", value)
              }
            />
            <NumberField
              id="settings-output-cost"
              label="输出单价（每百万 Token）"
              hint="用于成本估算，0-100000。"
              value={draft.outputCostPerMillion}
              error={monitorErrors.outputCostPerMillion}
              disabled={busy}
              onChange={(value) =>
                updateField("outputCostPerMillion", value)
              }
            />
            <NumberField
              id="settings-retention"
              label="指标保留天数"
              hint="LLM 调用指标的保留天数，1-3650。"
              value={draft.retentionDays}
              error={monitorErrors.retentionDays}
              disabled={busy}
              onChange={(value) => updateField("retentionDays", value)}
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={() => void handleSaveMonitor()} disabled={busy}>
            {savingMonitor && <Loader2Icon className="animate-spin" />}
            保存监控与成本
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
