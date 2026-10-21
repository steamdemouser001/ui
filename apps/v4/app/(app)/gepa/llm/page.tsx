import { LlmSettings } from "@/components/gepa/llm-settings"

export default function LlmSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">LLM 配置</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          配置 OpenAI 兼容或 Anthropic 供应商。API Key
          仅保存在服务端，页面只展示掩码。Agent
          未单独指定供应商时将使用默认供应商。
        </p>
      </header>
      <LlmSettings />
    </div>
  )
}
