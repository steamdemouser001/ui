import { AnalyzeDashboard } from "@/components/gepa/analyze/analyze-dashboard"

export default function AnalyzePage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">会话分析</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          读取本地 Claude Code 会话记录，并可选读入技能、钩子、记忆等配置，由 AI
          分析执行过程中的低效环节与配置问题，输出可执行的优化建议。
        </p>
      </header>
      <AnalyzeDashboard />
    </div>
  )
}
