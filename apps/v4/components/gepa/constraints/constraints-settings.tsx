"use client"

import * as React from "react"
import { cn } from "cn"
import {
  AlertCircleIcon,
  Loader2Icon,
  RotateCcwIcon,
  SaveIcon,
  ShieldCheckIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/gepa/client"
import { createDefaultSettings } from "@/lib/gepa/defaults"
import type { GlobalConstraints } from "@/lib/gepa/types"
import {
  buildConstraints,
  LIMITS,
  toForm,
  TOOL_OPTIONS,
  type ConstraintsForm,
  type ToolOption,
} from "@/components/gepa/constraints/constraints-form"
import { SandboxTerminal } from "@/components/gepa/constraints/sandbox-terminal"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
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
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import { Switch } from "@/registry/new-york-v4/ui/switch"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

interface ConstraintsResponse {
  constraints: GlobalConstraints
  dataRoot: string
}

interface ConstraintsPatchResponse {
  constraints: GlobalConstraints
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ToolToggle({
  option,
  active,
  tone,
  onToggle,
}: {
  option: ToolOption
  active: boolean
  tone: "allow" | "deny"
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? tone === "deny"
            ? "border-destructive/50 bg-destructive/10 text-destructive"
            : "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      )}
    >
      <span>{option.label}</span>
      <code className="font-mono text-[10px] opacity-60">{option.value}</code>
    </button>
  )
}

export function ConstraintsSettings() {
  const [form, setForm] = React.useState<ConstraintsForm | null>(null)
  const [dataRoot, setDataRoot] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [resetOpen, setResetOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<ConstraintsResponse>("/api/gepa/constraints")
      setForm(toForm(data.constraints))
      setDataRoot(data.dataRoot)
    } catch (loadError) {
      setError(errorText(loadError, "加载约束失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function update(patch: Partial<ConstraintsForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current))
  }

  function toggleTool(list: "allowed" | "denied", tool: string) {
    setForm((current) => {
      if (!current) return current
      if (list === "allowed") {
        const active = current.allowedTools.includes(tool)
        return {
          ...current,
          allowedTools: active
            ? current.allowedTools.filter((item) => item !== tool)
            : [...current.allowedTools, tool],
          deniedTools: active
            ? current.deniedTools
            : current.deniedTools.filter((item) => item !== tool),
        }
      }
      const active = current.deniedTools.includes(tool)
      return {
        ...current,
        deniedTools: active
          ? current.deniedTools.filter((item) => item !== tool)
          : [...current.deniedTools, tool],
        allowedTools: active
          ? current.allowedTools
          : current.allowedTools.filter((item) => item !== tool),
      }
    })
  }

  async function handleSave() {
    if (!form) return
    let constraints: GlobalConstraints
    try {
      constraints = buildConstraints(form)
    } catch (buildError) {
      toast.error(errorText(buildError, "约束填写有误"))
      return
    }

    setSaving(true)
    try {
      const data = await apiPatch<ConstraintsPatchResponse>(
        "/api/gepa/constraints",
        constraints
      )
      setForm(toForm(data.constraints))
      toast.success("约束已保存")
    } catch (saveError) {
      toast.error(errorText(saveError, "保存约束失败"))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    try {
      const defaults = createDefaultSettings().constraints
      const data = await apiPatch<ConstraintsPatchResponse>(
        "/api/gepa/constraints",
        defaults
      )
      setForm(toForm(data.constraints))
      setResetOpen(false)
      toast.success("已恢复默认约束")
    } catch (resetError) {
      toast.error(errorText(resetError, "恢复默认约束失败"))
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>加载约束失败</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void load()}
          >
            重试
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!form) {
    return (
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>暂无约束配置</AlertTitle>
        <AlertDescription>未能读取约束配置，请刷新页面重试。</AlertDescription>
      </Alert>
    )
  }

  const knownTools = new Set(TOOL_OPTIONS.map((option) => option.value))
  const extraTools = [
    ...new Set([...form.allowedTools, ...form.deniedTools]),
  ].filter((tool) => !knownTools.has(tool))
  const toolOptions: ToolOption[] = [
    ...TOOL_OPTIONS,
    ...extraTools.map((value) => ({ value, label: value })),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">约束配置</h2>
          <p className="text-sm text-muted-foreground">
            保存后立即作用于新的工具调用与工作空间命令。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setResetOpen(true)}
            disabled={saving || resetting}
          >
            <RotateCcwIcon />
            恢复默认
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            保存约束
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <WrenchIcon className="size-4" />
                工具约束
              </CardTitle>
              <CardDescription>
                控制 Agent 可调用的工具、写操作审批与网络访问。
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="tools-enabled"
                checked={form.toolsEnabled}
                onCheckedChange={(checked) => update({ toolsEnabled: checked })}
              />
              <Label htmlFor="tools-enabled">
                {form.toolsEnabled ? "已启用" : "已禁用"}
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!form.toolsEnabled && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              工具约束已禁用：所有工具调用都会被拒绝。
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>允许工具</Label>
              <span className="text-xs text-muted-foreground">
                已选 {form.allowedTools.length} 个
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {toolOptions.map((option) => (
                <ToolToggle
                  key={option.value}
                  option={option}
                  tone="allow"
                  active={form.allowedTools.includes(option.value)}
                  onToggle={() => toggleTool("allowed", option.value)}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              工具必须同时满足「在允许列表中」且「不在禁止列表中」，禁止列表优先。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>禁止工具</Label>
              <span className="text-xs text-muted-foreground">
                已选 {form.deniedTools.length} 个
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {toolOptions.map((option) => (
                <ToolToggle
                  key={option.value}
                  option={option}
                  tone="deny"
                  active={form.deniedTools.includes(option.value)}
                  onToggle={() => toggleTool("denied", option.value)}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-calls">每轮最大调用数</Label>
              <Input
                id="max-calls"
                type="number"
                min={LIMITS.maxCalls.min}
                max={LIMITS.maxCalls.max}
                inputMode="numeric"
                value={form.maxCallsPerIteration}
                onChange={(event) =>
                  update({ maxCallsPerIteration: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                范围 {LIMITS.maxCalls.min}-{LIMITS.maxCalls.max}
                ，由调用方按轮次计数。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="approval-write">写操作审批</Label>
              <div className="flex h-9 items-center gap-3">
                <Switch
                  id="approval-write"
                  checked={form.requireApprovalForWrite}
                  onCheckedChange={(checked) =>
                    update({ requireApprovalForWrite: checked })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {form.requireApprovalForWrite
                    ? "write_file / delete 需要人工批准"
                    : "写操作直接执行"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="allow-network">网络访问</Label>
              <div className="flex h-9 items-center gap-3">
                <Switch
                  id="allow-network"
                  checked={form.allowNetwork}
                  onCheckedChange={(checked) =>
                    update({ allowNetwork: checked })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {form.allowNetwork
                    ? "允许 http_fetch / network"
                    : "拒绝 http_fetch / network"}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="allowed-hosts">Host 白名单</Label>
            <Textarea
              id="allowed-hosts"
              rows={3}
              className="font-mono"
              value={form.allowedHostsText}
              onChange={(event) =>
                update({ allowedHostsText: event.target.value })
              }
              placeholder={"api.example.com\n*.example.com"}
            />
            <p className="text-xs text-muted-foreground">
              每行一个主机，支持 *.example.com
              通配；留空表示不限制主机。仅在允许网络时生效。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <SquareTerminalIcon className="size-4" />
                Bash 约束
              </CardTitle>
              <CardDescription>
                限制工作空间命令的白名单、shell 操作符、超时与输出上限。
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="bash-enabled"
                checked={form.bashEnabled}
                onCheckedChange={(checked) => update({ bashEnabled: checked })}
              />
              <Label htmlFor="bash-enabled">
                {form.bashEnabled ? "已启用" : "已禁用"}
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!form.bashEnabled && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Bash 约束已禁用：所有命令都会被拒绝。
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="allowed-commands">允许命令</Label>
              <Textarea
                id="allowed-commands"
                rows={7}
                className="font-mono"
                value={form.allowedCommandsText}
                onChange={(event) =>
                  update({ allowedCommandsText: event.target.value })
                }
                placeholder={"ls\ncat\ngrep"}
              />
              <p className="text-xs text-muted-foreground">
                每行一个命令名；带路径的可执行文件按文件名匹配。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="denied-commands">禁止命令</Label>
              <Textarea
                id="denied-commands"
                rows={7}
                className="font-mono"
                value={form.deniedCommandsText}
                onChange={(event) =>
                  update({ deniedCommandsText: event.target.value })
                }
                placeholder={"rm\nsudo\ncurl"}
              />
              <p className="text-xs text-muted-foreground">
                每行一个命令或前缀（如 git push），禁止优先于允许。
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="allow-operators">Shell 操作符</Label>
              <div className="flex min-h-9 items-center gap-3">
                <Switch
                  id="allow-operators"
                  checked={form.allowShellOperators}
                  onCheckedChange={(checked) =>
                    update({ allowShellOperators: checked })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {form.allowShellOperators
                    ? "允许 ; && || | > 等操作符"
                    : "仅允许单条命令"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                开启后通过系统 shell 执行，存在命令注入风险，请谨慎使用。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="working-dir-only">工作目录限制</Label>
              <div className="flex min-h-9 items-center gap-3">
                <Switch
                  id="working-dir-only"
                  checked={form.workingDirOnly}
                  onCheckedChange={(checked) =>
                    update({ workingDirOnly: checked })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {form.workingDirOnly
                    ? "拒绝绝对路径、.. 与 ~"
                    : "允许访问工作目录外路径"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeout-ms">超时（毫秒）</Label>
              <Input
                id="timeout-ms"
                type="number"
                min={LIMITS.timeoutMs.min}
                max={LIMITS.timeoutMs.max}
                step={1000}
                inputMode="numeric"
                value={form.timeoutMs}
                onChange={(event) => update({ timeoutMs: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                范围 {LIMITS.timeoutMs.min}-{LIMITS.timeoutMs.max}
                ，超时后强制终止。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-output">输出上限（字节）</Label>
              <Input
                id="max-output"
                type="number"
                min={LIMITS.maxOutputBytes.min}
                max={LIMITS.maxOutputBytes.max}
                step={1024}
                inputMode="numeric"
                value={form.maxOutputBytes}
                onChange={(event) =>
                  update({ maxOutputBytes: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                范围 {LIMITS.maxOutputBytes.min}-{LIMITS.maxOutputBytes.max}
                ，超出部分会被截断。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <SandboxTerminal dataRoot={dataRoot} />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复默认约束</AlertDialogTitle>
            <AlertDialogDescription>
              将把所有工具与 Bash 约束恢复为内置默认值（危险命令默认禁止）。
              当前自定义配置会被覆盖，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={resetting}
              onClick={(event) => {
                event.preventDefault()
                void handleReset()
              }}
            >
              {resetting && <Loader2Icon className="animate-spin" />}
              恢复默认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
