"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  ServerIcon,
  StarIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/gepa/client"
import type { LlmProvider, LlmProviderKind } from "@/lib/gepa/types"
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
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import { Switch } from "@/registry/new-york-v4/ui/switch"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

interface ProviderListResponse {
  providers: LlmProvider[]
  defaultProviderId: string | null
}

interface TestResponse {
  providerId: string
  providerName: string
  model: string
  text: string
  durationMs: number
  inputTokens: number
  outputTokens: number
}

interface ProviderFormState {
  name: string
  kind: LlmProviderKind
  baseUrl: string
  apiKey: string
  modelsText: string
  defaultModel: string
  enabled: boolean
}

interface TestResult {
  ok: boolean
  text: string
  durationMs?: number
}

const EMPTY_FORM: ProviderFormState = {
  name: "",
  kind: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  modelsText: "",
  defaultModel: "",
  enabled: true,
}

function parseModelsText(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ]
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function LlmSettings() {
  const [providers, setProviders] = React.useState<LlmProvider[]>([])
  const [defaultProviderId, setDefaultProviderId] = React.useState<
    string | null
  >(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<ProviderFormState>(EMPTY_FORM)
  const [saving, setSaving] = React.useState(false)

  const [testingId, setTestingId] = React.useState<string | null>(null)
  const [defaultingId, setDefaultingId] = React.useState<string | null>(null)
  const [testResults, setTestResults] = React.useState<
    Record<string, TestResult>
  >({})
  const [deleteTarget, setDeleteTarget] = React.useState<LlmProvider | null>(
    null
  )
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<ProviderListResponse>("/api/gepa/llm/providers")
      setProviders(data.providers)
      setDefaultProviderId(data.defaultProviderId)
    } catch (loadError) {
      setError(errorText(loadError, "加载供应商失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const formModels = parseModelsText(form.modelsText)
  const selectedDefaultModel = formModels.includes(form.defaultModel)
    ? form.defaultModel
    : (formModels[0] ?? "")

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(provider: LlmProvider) {
    setEditingId(provider.id)
    setForm({
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      apiKey: "",
      modelsText: provider.models.join("\n"),
      defaultModel: provider.defaultModel,
      enabled: provider.enabled,
    })
    setDialogOpen(true)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    const baseUrl = form.baseUrl.trim()
    const models = parseModelsText(form.modelsText)
    if (!name) {
      toast.error("请填写供应商名称")
      return
    }
    if (!baseUrl) {
      toast.error("请填写 Base URL")
      return
    }
    if (models.length === 0) {
      toast.error("请至少填写一个模型")
      return
    }
    const defaultModel = models.includes(form.defaultModel.trim())
      ? form.defaultModel.trim()
      : models[0]

    setSaving(true)
    try {
      if (editingId) {
        await apiPatch<LlmProvider>(`/api/gepa/llm/providers/${editingId}`, {
          name,
          kind: form.kind,
          baseUrl,
          apiKey: form.apiKey.trim(),
          models,
          defaultModel,
          enabled: form.enabled,
        })
        toast.success("供应商已更新")
      } else {
        await apiPost<LlmProvider>("/api/gepa/llm/providers", {
          name,
          kind: form.kind,
          baseUrl,
          apiKey: form.apiKey.trim(),
          models,
          defaultModel,
          enabled: form.enabled,
        })
        toast.success("供应商已添加")
      }
      setDialogOpen(false)
      await load()
    } catch (saveError) {
      toast.error(errorText(saveError, "保存供应商失败"))
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(provider: LlmProvider) {
    setTestingId(provider.id)
    try {
      const result = await apiPost<TestResponse>("/api/gepa/llm/test", {
        providerId: provider.id,
      })
      setTestResults((current) => ({
        ...current,
        [provider.id]: {
          ok: true,
          text: result.text || "（模型返回为空）",
          durationMs: result.durationMs,
        },
      }))
      toast.success(`连接成功，耗时 ${result.durationMs}ms`)
    } catch (testError) {
      const message = errorText(testError, "连接测试失败")
      setTestResults((current) => ({
        ...current,
        [provider.id]: { ok: false, text: message },
      }))
      toast.error(message)
    } finally {
      setTestingId(null)
    }
  }

  async function handleSetDefault(provider: LlmProvider) {
    setDefaultingId(provider.id)
    try {
      await apiPatch<LlmProvider>(`/api/gepa/llm/providers/${provider.id}`, {
        isDefault: true,
      })
      setDefaultProviderId(provider.id)
      toast.success(`已将「${provider.name}」设为默认供应商`)
    } catch (defaultError) {
      toast.error(errorText(defaultError, "设置默认供应商失败"))
    } finally {
      setDefaultingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete<{ id: string }>(
        `/api/gepa/llm/providers/${deleteTarget.id}`
      )
      toast.success(`已删除「${deleteTarget.name}」`)
      setTestResults((current) => {
        const next = { ...current }
        delete next[deleteTarget.id]
        return next
      })
      setDeleteTarget(null)
      await load()
    } catch (deleteError) {
      toast.error(errorText(deleteError, "删除供应商失败"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">供应商</h2>
          <p className="text-sm text-muted-foreground">
            共 {providers.length} 个供应商
            {!loading && providers.length > 0 && !defaultProviderId
              ? "，尚未设置默认供应商"
              : ""}
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon />
          添加供应商
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((index) => (
            <Card key={index} className="gap-4">
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
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
      ) : providers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ServerIcon className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">还没有 LLM 供应商</p>
              <p className="text-sm text-muted-foreground">
                添加第一个供应商后，Agent 才能调用模型。
              </p>
            </div>
            <Button onClick={openCreate}>
              <PlusIcon />
              添加供应商
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((provider) => {
            const result = testResults[provider.id]
            const isDefault = provider.id === defaultProviderId
            return (
              <Card key={provider.id} className="gap-4">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {provider.name}
                        {isDefault && <Badge>默认</Badge>}
                      </CardTitle>
                      <CardDescription className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {provider.kind === "anthropic"
                            ? "Anthropic"
                            : "OpenAI 兼容"}
                        </Badge>
                        <Badge variant={provider.enabled ? "secondary" : "outline"}>
                          {provider.enabled ? "已启用" : "已停用"}
                        </Badge>
                      </CardDescription>
                    </div>
                    <ServerIcon className="size-5 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Base URL</span>
                    <span
                      className="truncate font-mono text-xs"
                      title={provider.baseUrl}
                    >
                      {provider.baseUrl}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">默认模型</span>
                    <span className="truncate font-mono text-xs">
                      {provider.defaultModel || "未设置"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">模型数量</span>
                    <span>{provider.models.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">API Key</span>
                    <span className="truncate font-mono text-xs">
                      {provider.apiKey || "未配置"}
                    </span>
                  </div>
                  {result && (
                    <div
                      className={cn(
                        "rounded-md border px-3 py-2 text-xs",
                        result.ok
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                          : "border-destructive/30 bg-destructive/5 text-destructive"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        {result.ok ? (
                          <CheckCircle2Icon className="size-3.5" />
                        ) : (
                          <AlertCircleIcon className="size-3.5" />
                        )}
                        {result.ok
                          ? `连接成功${result.durationMs !== undefined ? `（${result.durationMs}ms）` : ""}`
                          : "连接失败"}
                      </div>
                      <p className="mt-1 break-words whitespace-pre-wrap">
                        {result.text}
                      </p>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTest(provider)}
                    disabled={testingId === provider.id}
                  >
                    {testingId === provider.id ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <ZapIcon />
                    )}
                    测试连接
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSetDefault(provider)}
                    disabled={isDefault || defaultingId === provider.id}
                  >
                    {defaultingId === provider.id ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <StarIcon />
                    )}
                    {isDefault ? "默认供应商" : "设为默认"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(provider)}
                  >
                    <PencilIcon />
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(provider)}
                  >
                    <Trash2Icon />
                    删除
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setSaving(false)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "编辑供应商" : "添加供应商"}
              </DialogTitle>
              <DialogDescription>
                支持 OpenAI 兼容接口与 Anthropic Messages API。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider-name">名称</Label>
                <Input
                  id="provider-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：OpenAI"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-kind">类型</Label>
                <Select
                  value={form.kind}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      kind: value as LlmProviderKind,
                    }))
                  }
                >
                  <SelectTrigger id="provider-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-compatible">
                      OpenAI 兼容
                    </SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-base-url">Base URL</Label>
              <Input
                id="provider-base-url"
                value={form.baseUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder={
                  form.kind === "anthropic"
                    ? "https://api.anthropic.com"
                    : "https://api.openai.com/v1"
                }
              />
              <p className="text-xs text-muted-foreground">
                OpenAI 兼容接口需包含版本段，例如 https://api.openai.com/v1。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-api-key">API Key</Label>
              <Input
                id="provider-api-key"
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder={editingId ? "留空表示不修改" : "sk-..."}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-models">模型列表</Label>
              <Textarea
                id="provider-models"
                rows={3}
                value={form.modelsText}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    modelsText: event.target.value,
                  }))
                }
                placeholder={"gpt-4.1-mini\ngpt-4.1"}
              />
              <p className="text-xs text-muted-foreground">
                使用逗号或换行分隔。
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider-default-model">默认模型</Label>
                <Select
                  value={selectedDefaultModel}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      defaultModel: value,
                    }))
                  }
                >
                  <SelectTrigger
                    id="provider-default-model"
                    className="w-full"
                  >
                    <SelectValue placeholder="请先填写模型列表" />
                  </SelectTrigger>
                  <SelectContent>
                    {formModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-enabled">启用</Label>
                <div className="flex h-9 items-center gap-3">
                  <Switch
                    id="provider-enabled"
                    checked={form.enabled}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({
                        ...current,
                        enabled: checked,
                      }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {form.enabled ? "已启用" : "已停用"}
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2Icon className="animate-spin" />}
                {editingId ? "保存修改" : "添加供应商"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除供应商</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.name}」吗？使用该供应商的 Agent
              将回退到默认供应商，此操作不可撤销。
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
