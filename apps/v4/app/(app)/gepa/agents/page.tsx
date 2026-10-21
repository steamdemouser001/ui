import { AgentSettings } from "@/components/gepa/agents/agent-settings"

export default function AgentSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Agent 配置</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          配置参与 GEPA 迭代的 Agent 的提示词、模型与生成参数。执行器负责产出结果，
          评估器给出分数与反馈，反思器据此改进模块提示词。提示词中的{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {"{{变量}}"}
          </code>{" "}
          会在运行时替换为对应内容。
        </p>
      </header>
      <AgentSettings />
    </div>
  )
}
