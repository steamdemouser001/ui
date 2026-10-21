"use client"

import {
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react"

import type { AgentConfig, AgentId, LlmProvider } from "@/lib/gepa/types"
import { ProviderModelSelect } from "@/components/gepa/provider-model-select"
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
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Switch } from "@/registry/new-york-v4/ui/switch"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

import { AGENT_VARIABLES } from "./agent-variables"

export interface AgentFormState {
  name: string
  description: string
  enabled: boolean
  providerId: string | null
  model: string
  temperature: string
  maxTokens: string
  prompt: string
}

const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  orchestrator: MessageSquareIcon,
  executor: PlayIcon,
  evaluator: CheckCircle2Icon,
  reflector: SparklesIcon,
  summarizer: FileTextIcon,
}

export function agentToForm(agent: AgentConfig): AgentFormState {
  return {
    name: agent.name,
    description: agent.description,
    enabled: agent.enabled,
    providerId: agent.providerId,
    model: agent.model,
    temperature: String(agent.temperature),
    maxTokens: String(agent.maxTokens),
    prompt: agent.prompt,
  }
}

export function isFormDirty(form: AgentFormState, agent: AgentConfig): boolean {
  const base = agentToForm(agent)
  return (Object.keys(base) as (keyof AgentFormState)[]).some(
    (key) => base[key] !== form[key]
  )
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.UTC(2000, 0, 1)) {
    return "尚未修改"
  }
  return date.toLocaleString("zh-CN", { hour12: false })
}

export function AgentCard({
  agent,
  form,
  providers,
  saving,
  resetting,
  onChange,
  onSave,
  onReset,
}: {
  agent: AgentConfig
  form: AgentFormState
  providers: LlmProvider[]
  saving: boolean
  resetting: boolean
  onChange: (patch: Partial<AgentFormState>) => void
  onSave: () => void
  onReset: () => void
}) {
  const Icon = AGENT_ICONS[agent.id] ?? SparklesIcon
  const dirty = isFormDirty(form, agent)
  const variables = AGENT_VARIABLES[agent.id] ?? []
  const busy = saving || resetting

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {agent.name}
                <Badge variant={form.enabled ? "secondary" : "outline"}>
                  {form.enabled ? "已启用" : "已停用"}
                </Badge>
                {dirty && <Badge variant="outline">未保存</Badge>}
              </CardTitle>
              <CardDescription>{agent.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`agent-${agent.id}-enabled`}
              className="text-sm text-muted-foreground"
            >
              启用
            </Label>
            <Switch
              id={`agent-${agent.id}-enabled`}
              checked={form.enabled}
              disabled={busy}
              onCheckedChange={(checked) => onChange({ enabled: checked })}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>供应商与模型</Label>
            <ProviderModelSelect
              value={{ providerId: form.providerId, model: form.model }}
              providers={providers}
              disabled={busy}
              onChange={(value) =>
                onChange({
                  providerId: value.providerId,
                  model: value.model,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              选择「使用默认供应商」时跟随 LLM 配置中的默认供应商。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`agent-${agent.id}-temperature`}>
                Temperature
              </Label>
              <Input
                id={`agent-${agent.id}-temperature`}
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                disabled={busy}
                onChange={(event) =>
                  onChange({ temperature: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">范围 0 - 2</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`agent-${agent.id}-max-tokens`}>最大 Token</Label>
              <Input
                id={`agent-${agent.id}-max-tokens`}
                type="number"
                min={256}
                max={32768}
                step={1}
                value={form.maxTokens}
                disabled={busy}
                onChange={(event) =>
                  onChange({ maxTokens: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">256 - 32768</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={`agent-${agent.id}-prompt`}>系统提示词</Label>
            <span className="text-xs text-muted-foreground">
              {form.prompt.length} 字符
            </span>
          </div>
          <Textarea
            id={`agent-${agent.id}-prompt`}
            rows={14}
            value={form.prompt}
            disabled={busy}
            spellCheck={false}
            className="min-h-64 font-mono text-xs leading-relaxed"
            onChange={(event) => onChange({ prompt: event.target.value })}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">可用变量：</span>
            {variables.length === 0 ? (
              <span className="text-xs text-muted-foreground">无</span>
            ) : (
              variables.map((variable) => (
                <Badge
                  key={variable}
                  variant="outline"
                  className="font-mono text-[10px]"
                >
                  {`{{${variable}}}`}
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          更新于 {formatUpdatedAt(agent.updatedAt)}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onReset}>
            {resetting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <RotateCcwIcon />
            )}
            恢复默认
          </Button>
          <Button size="sm" disabled={busy || !dirty} onClick={onSave}>
            {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            保存
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
