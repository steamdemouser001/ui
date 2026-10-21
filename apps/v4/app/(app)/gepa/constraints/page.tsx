import { ConstraintsSettings } from "@/components/gepa/constraints/constraints-settings"

export default function ConstraintsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">全局约束</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          这些约束会作用于 Agent
          的工具调用与工作空间命令。危险操作会在服务端执行前被拒绝，测试终端使用已保存的约束。
        </p>
      </header>
      <ConstraintsSettings />
    </div>
  )
}
