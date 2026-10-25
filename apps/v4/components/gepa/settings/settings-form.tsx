"use client"

import * as React from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { apiGet } from "@/lib/gepa/client"
import type {
  GlobalSettings,
  HarnessConfig,
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
  HarnessDraft,
  IterationDraft,
  MonitorDraft,
  SettingsAction,
  SettingsDraft,
} from "./types"
import { errorText, omitKey } from "./utils"
import {
  parseHarnessDraft,
  parseIterationDraft,
  parseMonitorDraft,
} from "./validation"

interface HarnessStatus {
  available: boolean
  version: string
  loggedIn: boolean
  authMethod?: string
  apiProvider?: string
  error?: string
}

interface HarnessStatusResponse {
  config: HarnessConfig
  status: HarnessStatus
}

interface SettingsFormProps {
  settings: GlobalSettings
  savingAction: SettingsAction | null
  onSaveIteration: (value: IterationDefaults) => Promise<GlobalSettings | null>
  onSaveMonitor: (value: MonitorConfig) => Promise<GlobalSettings | null>
  onSaveHarness: (value: HarnessConfig) => Promise<GlobalSettings | null>
}

function iterationToDraft(iteration: IterationDefaults): IterationDraft {
  return {
    budget: String(iteration.budget),
    minibatchSize: String(iteration.minibatchSize),
    paretoSize: String(iteration.paretoSize),
    maxIterations: String(iteration.maxIterations),
    moduleSelection: iteration.moduleSelection,
    mergeEnabled: iteration.mergeEnabled,
    humanApproval: iteration.humanApproval === true,
  }
}

function monitorToDraft(monitor: MonitorConfig): MonitorDraft {
  return {
    inputCostPerMillion: String(monitor.inputCostPerMillion),
    outputCostPerMillion: String(monitor.outputCostPerMillion),
    cacheCostPerMillion: String(monitor.cacheCostPerMillion),
    retentionDays: String(monitor.retentionDays),
  }
}

function harnessToDraft(harness: HarnessConfig): HarnessDraft {
  return {
    kind: harness.kind,
    claudePath: harness.claudePath,
    model: harness.model,
    allowedTools: harness.allowedTools.join(","),
    maxUsdPerRollout: String(harness.maxUsdPerRollout),
    maxUsdPerRun: String(harness.maxUsdPerRun),
    timeoutMs: String(harness.timeoutMs),
    maxConcurrent: String(harness.maxConcurrent),
  }
}

function toDraft(settings: GlobalSettings): SettingsDraft {
  return {
    ...iterationToDraft(settings.iteration),
    ...monitorToDraft(settings.monitor),
    ...harnessToDraft(settings.harness),
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
  onSaveHarness,
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
  const [harnessErrors, setHarnessErrors] = React.useState<
    Record<string, string>
  >({})
  const [checkingHarness, setCheckingHarness] = React.useState(false)
  const [harnessStatus, setHarnessStatus] =
    React.useState<HarnessStatus | null>(null)
  const [harnessCheckError, setHarnessCheckError] = React.useState<
    string | null
  >(null)

  const busy = savingAction !== null
  const savingIteration = savingAction === "iteration"
  const savingMonitor = savingAction === "monitor"
  const savingHarness = savingAction === "harness"

  function updateField<K extends keyof SettingsDraft>(
    key: K,
    value: SettingsDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
    setIterationErrors((current) => omitKey(current, key))
    setMonitorErrors((current) => omitKey(current, key))
    setHarnessErrors((current) => omitKey(current, key))
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

  async function handleSaveHarness() {
    const result = parseHarnessDraft(draft)
    if (!result.ok) {
      setHarnessErrors(result.errors)
      toast.error(result.message)
      return
    }
    setHarnessErrors({})
    const updated = await onSaveHarness(result.value)
    if (updated) {
      setDraft((current) => ({
        ...current,
        ...harnessToDraft(updated.harness),
      }))
    }
  }

  async function handleCheckHarness() {
    setCheckingHarness(true)
    setHarnessCheckError(null)
    try {
      const data = await apiGet<HarnessStatusResponse>(
        "/api/gepa/harness/status"
      )
      setHarnessStatus(data.status)
    } catch (error) {
      const message = errorText(error, "检查 Claude Code 失败")
      setHarnessStatus(null)
      setHarnessCheckError(message)
      toast.error(message)
    } finally {
      setCheckingHarness(false)
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
            <div className="space-y-2">
              <Label htmlFor="settings-human-approval">人工审批</Label>
              <div className="flex h-9 items-center justify-between gap-3 rounded-md border px-3">
                <span className="text-sm text-muted-foreground">
                  {draft.humanApproval ? "已开启" : "已关闭"}
                </span>
                <Switch
                  id="settings-human-approval"
                  checked={draft.humanApproval}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    updateField("humanApproval", checked)
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                开启后，接受的变异候选需人工批准后才进入候选池并继续。
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
          <CardTitle>执行 Harness</CardTitle>
          <CardDescription>
            选择 rollout 的执行方式；claude-code 模式通过 Claude Code
            会话执行，可配置成本与并发限制。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settings-harness-kind">执行器类型</Label>
              <Select
                value={draft.kind}
                disabled={busy}
                onValueChange={(value) =>
                  updateField("kind", value as SettingsDraft["kind"])
                }
              >
                <SelectTrigger
                  id="settings-harness-kind"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="llm">llm（单次 LLM 补全）</SelectItem>
                  <SelectItem value="claude-code">
                    claude-code（Claude Code 会话）
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                llm 使用单次 LLM 补全执行 rollout；claude-code
                通过 Claude Code 会话执行。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-harness-claude-path">
                Claude Code 路径
              </Label>
              <Input
                id="settings-harness-claude-path"
                value={draft.claudePath}
                placeholder="claude"
                disabled={busy}
                onChange={(event) =>
                  updateField("claudePath", event.target.value)
                }
              />
              <p className="text-xs text-muted-foreground">
                默认 claude；也可填写可执行文件的绝对路径。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-harness-model">模型</Label>
              <Input
                id="settings-harness-model"
                value={draft.model}
                placeholder="留空使用默认模型"
                disabled={busy}
                onChange={(event) => updateField("model", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                留空表示使用 Claude Code
                默认模型；可填 sonnet、opus 或完整模型名。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-harness-tools">允许工具</Label>
              <Input
                id="settings-harness-tools"
                value={draft.allowedTools}
                placeholder="Read,Edit,Write,Bash"
                disabled={busy}
                onChange={(event) =>
                  updateField("allowedTools", event.target.value)
                }
              />
              <p className="text-xs text-muted-foreground">
                逗号分隔，保存时会自动去重；默认 Read,Edit,Write,Bash。
              </p>
            </div>
            <NumberField
              id="settings-harness-max-usd-rollout"
              label="单次 rollout 成本上限（USD）"
              hint="单次 rollout 允许消耗的美元上限，0 表示不限制。"
              value={draft.maxUsdPerRollout}
              error={harnessErrors.maxUsdPerRollout}
              disabled={busy}
              onChange={(value) => updateField("maxUsdPerRollout", value)}
            />
            <NumberField
              id="settings-harness-max-usd-run"
              label="单次运行成本上限（USD）"
              hint="单次运行允许消耗的美元上限，0 表示不限制。"
              value={draft.maxUsdPerRun}
              error={harnessErrors.maxUsdPerRun}
              disabled={busy}
              onChange={(value) => updateField("maxUsdPerRun", value)}
            />
            <NumberField
              id="settings-harness-timeout"
              label="执行超时时间（毫秒）"
              hint="单次执行的超时时间，10000-3600000。"
              value={draft.timeoutMs}
              error={harnessErrors.timeoutMs}
              disabled={busy}
              onChange={(value) => updateField("timeoutMs", value)}
            />
            <NumberField
              id="settings-harness-max-concurrent"
              label="最大并发数"
              hint="同时执行的 rollout 数量，1-16。"
              value={draft.maxConcurrent}
              error={harnessErrors.maxConcurrent}
              disabled={busy}
              onChange={(value) => updateField("maxConcurrent", value)}
            />
          </div>
          {harnessStatus || harnessCheckError ? (
            <div className="space-y-1 rounded-md border px-3 py-2 text-sm">
              {harnessCheckError ? (
                <p className="text-destructive">
                  检查失败：{harnessCheckError}
                </p>
              ) : harnessStatus ? (
                <>
                  <p>
                    Claude Code：
                    {harnessStatus.available ? "可用" : "不可用"}
                  </p>
                  {harnessStatus.version ? (
                    <p>版本：{harnessStatus.version}</p>
                  ) : null}
                  <p>
                    登录状态：{harnessStatus.loggedIn ? "已登录" : "未登录"}
                  </p>
                  {harnessStatus.authMethod ? (
                    <p>认证方式：{harnessStatus.authMethod}</p>
                  ) : null}
                  {harnessStatus.apiProvider ? (
                    <p>API 供应商：{harnessStatus.apiProvider}</p>
                  ) : null}
                  {harnessStatus.error ? (
                    <p className="text-destructive">
                      错误：{harnessStatus.error}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            检查 Claude Code 使用已保存的 Harness 配置，修改后请先保存。
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => void handleCheckHarness()}
            disabled={busy || checkingHarness}
          >
            {checkingHarness && <Loader2Icon className="animate-spin" />}
            检查 Claude Code
          </Button>
          <Button onClick={() => void handleSaveHarness()} disabled={busy}>
            {savingHarness && <Loader2Icon className="animate-spin" />}
            保存 Harness 设置
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              id="settings-input-cost"
              label="输入单价（每百万 Token）"
              hint="用于成本估算，0-100000。"
              value={draft.inputCostPerMillion}
              error={monitorErrors.inputCostPerMillion}
              disabled={busy}
              onChange={(value) => updateField("inputCostPerMillion", value)}
            />
            <NumberField
              id="settings-output-cost"
              label="输出单价（每百万 Token）"
              hint="用于成本估算，0-100000。"
              value={draft.outputCostPerMillion}
              error={monitorErrors.outputCostPerMillion}
              disabled={busy}
              onChange={(value) => updateField("outputCostPerMillion", value)}
            />
            <NumberField
              id="settings-cache-cost"
              label="缓存单价（每百万 Token）"
              hint="缓存命中 Token 的单价，0-100000。"
              value={draft.cacheCostPerMillion}
              error={monitorErrors.cacheCostPerMillion}
              disabled={busy}
              onChange={(value) => updateField("cacheCostPerMillion", value)}
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
