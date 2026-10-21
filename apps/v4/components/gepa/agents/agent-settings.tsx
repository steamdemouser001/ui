"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BotIcon,
  Loader2Icon,
  RotateCcwIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  AgentCard,
  agentToForm,
  type AgentFormState,
} from "@/components/gepa/agents/agent-card"
import { apiGet, apiPatch, apiPost } from "@/lib/gepa/client"
import type { AgentConfig, AgentId, LlmProvider } from "@/lib/gepa/types"
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Card, CardContent } from "@/registry/new-york-v4/ui/card"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"

interface AgentsResponse {
  agents: AgentConfig[]
  providers: LlmProvider[]
  defaultProviderId: string | null
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function AgentSettings() {
  const [agents, setAgents] = React.useState<AgentConfig[]>([])
  const [providers, setProviders] = React.useState<LlmProvider[]>([])
  const [forms, setForms] = React.useState<
    Partial<Record<AgentId, AgentFormState>>
  >({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [savingId, setSavingId] = React.useState<AgentId | null>(null)
  const [resettingId, setResettingId] = React.useState<AgentId | null>(null)
  const [resetTarget, setResetTarget] = React.useState<AgentConfig | null>(
    null
  )

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<AgentsResponse>("/api/gepa/agents")
      setAgents(data.agents)
      setProviders(data.providers)
      setForms(
        Object.fromEntries(
          data.agents.map((agent) => [agent.id, agentToForm(agent)])
        )
      )
    } catch (loadError) {
      setError(errorText(loadError, "加载 Agent 配置失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const updateForm = React.useCallback(
    (id: AgentId, patch: Partial<AgentFormState>) => {
      setForms((current) => {
        const existing = current[id]
        if (!existing) return current
        return { ...current, [id]: { ...existing, ...patch } }
      })
    },
    []
  )

  async function handleSave(agent: AgentConfig) {
    const form = forms[agent.id]
    if (!form) return

    const name = form.name.trim()
    if (!name) {
      toast.error("Agent 名称不能为空")
      return
    }
    if (!form.prompt.trim()) {
      toast.error("提示词不能为空")
      return
    }
    const temperature = Number(form.temperature)
    if (
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2
    ) {
      toast.error("Temperature 必须在 0 到 2 之间")
      return
    }
    const maxTokens = Number(form.maxTokens)
    if (
      !Number.isInteger(maxTokens) ||
      maxTokens < 256 ||
      maxTokens > 32768
    ) {
      toast.error("最大 Token 必须是 256 到 32768 之间的整数")
      return
    }

    setSavingId(agent.id)
    try {
      const updated = await apiPatch<AgentConfig>(
        `/api/gepa/agents/${agent.id}`,
        {
          name,
          description: form.description.trim(),
          enabled: form.enabled,
          providerId: form.providerId,
          model: form.model,
          temperature,
          maxTokens,
          prompt: form.prompt,
        }
      )
      setAgents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      )
      setForms((current) => ({
        ...current,
        [updated.id]: agentToForm(updated),
      }))
      toast.success(`「${updated.name}」配置已保存`)
    } catch (saveError) {
      toast.error(errorText(saveError, "保存 Agent 配置失败"))
    } finally {
      setSavingId(null)
    }
  }

  async function handleReset() {
    if (!resetTarget) return
    const target = resetTarget
    setResettingId(target.id)
    try {
      const updated = await apiPost<AgentConfig>(
        `/api/gepa/agents/${target.id}/reset`
      )
      setAgents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      )
      setForms((current) => ({
        ...current,
        [updated.id]: agentToForm(updated),
      }))
      toast.success(`「${updated.name}」已恢复默认配置`)
      setResetTarget(null)
    } catch (resetError) {
      toast.error(errorText(resetError, "恢复默认配置失败"))
    } finally {
      setResettingId(null)
    }
  }

  const enabledCount = agents.filter((agent) => agent.enabled).length
  const showProviderGuide = !loading && !error && providers.length === 0

  return (
    <div className="space-y-4">
      {showProviderGuide && (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>尚未配置 LLM 供应商</AlertTitle>
          <AlertDescription>
            <p>Agent 需要供应商才能调用模型，请先添加并启用一个供应商。</p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href="/gepa/llm">
                前往 LLM 配置
                <ArrowRightIcon />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agent 列表</h2>
          <p className="text-sm text-muted-foreground">
            共 {agents.length} 个 Agent
            {agents.length > 0 ? `，${enabledCount} 个已启用` : ""}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <Card key={index} className="gap-4">
              <CardContent className="space-y-3 py-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-72" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-40 w-full" />
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
      ) : agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <BotIcon className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">暂无 Agent 配置</p>
              <p className="text-sm text-muted-foreground">
                服务端未返回任何 Agent，请检查数据目录或重新加载。
              </p>
            </div>
            <Button variant="outline" onClick={() => void load()}>
              重新加载
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {agents.map((agent) => {
            const form = forms[agent.id]
            if (!form) return null
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                form={form}
                providers={providers}
                saving={savingId === agent.id}
                resetting={resettingId === agent.id}
                onChange={(patch) => updateForm(agent.id, patch)}
                onSave={() => void handleSave(agent)}
                onReset={() => setResetTarget(agent)}
              />
            )
          })}
        </div>
      )}

      <AlertDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复默认配置</AlertDialogTitle>
            <AlertDialogDescription>
              确定要将「{resetTarget?.name}」的提示词、模型与生成参数恢复为默认值吗？未保存的修改将丢失，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingId !== null}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={resettingId !== null}
              onClick={(event) => {
                event.preventDefault()
                void handleReset()
              }}
            >
              {resettingId !== null ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RotateCcwIcon />
              )}
              恢复默认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
