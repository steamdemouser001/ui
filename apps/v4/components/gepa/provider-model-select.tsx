"use client"

import * as React from "react"
import { cn } from "cn"

import { apiGet } from "@/lib/gepa/client"
import type { LlmProvider } from "@/lib/gepa/types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"

export interface ProviderModelValue {
  providerId: string | null
  model: string
}

interface ProviderListResponse {
  providers: LlmProvider[]
  defaultProviderId: string | null
}

const DEFAULT_PROVIDER_VALUE = "__default__"

export function ProviderModelSelect({
  value,
  onChange,
  providers: providersProp,
  disabled = false,
  allowInherit = true,
  className,
}: {
  value: ProviderModelValue
  onChange: (value: ProviderModelValue) => void
  providers?: LlmProvider[]
  disabled?: boolean
  allowInherit?: boolean
  className?: string
}) {
  const [fetchedProviders, setFetchedProviders] = React.useState<LlmProvider[]>(
    []
  )
  const [loading, setLoading] = React.useState(!providersProp)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (providersProp) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const data = await apiGet<ProviderListResponse>(
          "/api/gepa/llm/providers"
        )
        if (!cancelled) {
          setFetchedProviders(data.providers)
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "加载供应商失败"
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [providersProp])

  const providers = providersProp ?? fetchedProviders
  const selectedProvider = value.providerId
    ? (providers.find((provider) => provider.id === value.providerId) ?? null)
    : null
  const models = selectedProvider?.models ?? []
  const selectedModel = models.includes(value.model)
    ? value.model
    : (models[0] ?? value.model)

  function handleProviderChange(next: string) {
    if (next === DEFAULT_PROVIDER_VALUE) {
      onChange({ providerId: null, model: "" })
      return
    }
    const provider = providers.find((item) => item.id === next)
    const model = provider?.models.includes(value.model)
      ? value.model
      : provider?.defaultModel || provider?.models[0] || ""
    onChange({ providerId: next, model })
  }

  function handleModelChange(model: string) {
    onChange({ providerId: value.providerId, model })
  }

  if (loading) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        正在加载供应商…
      </p>
    )
  }
  if (error) {
    return <p className={cn("text-sm text-destructive", className)}>{error}</p>
  }
  if (providers.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        尚未配置 LLM 供应商，请先前往 LLM 配置页面添加。
      </p>
    )
  }

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      <Select
        value={value.providerId ?? DEFAULT_PROVIDER_VALUE}
        onValueChange={handleProviderChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="选择供应商" />
        </SelectTrigger>
        <SelectContent>
          {allowInherit && (
            <SelectItem value={DEFAULT_PROVIDER_VALUE}>
              使用默认供应商
            </SelectItem>
          )}
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={selectedModel}
        onValueChange={handleModelChange}
        disabled={disabled || !selectedProvider || models.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={selectedProvider ? "选择模型" : "先选择供应商"}
          />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
