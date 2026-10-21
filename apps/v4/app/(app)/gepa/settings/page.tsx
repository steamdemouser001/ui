import { GepaSettings } from "@/components/gepa/settings/gepa-settings"

export default function GepaSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          调整新建任务的默认迭代参数、成本估算单价与指标保留策略，并导出或导入控制台配置。
          tool 与 bash 的详细规则请在「约束」页面配置。
        </p>
      </header>
      <GepaSettings />
    </div>
  )
}
