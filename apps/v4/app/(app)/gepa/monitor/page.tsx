import { MonitorDashboard } from "@/components/gepa/monitor/monitor-dashboard"

export default function MonitorPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">运行监控</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          查看 LLM 调用量、Token 消耗、预估成本、各 Agent
          调用分布，以及任务的迭代进度与最近调用记录。
        </p>
      </header>
      <MonitorDashboard />
    </div>
  )
}
