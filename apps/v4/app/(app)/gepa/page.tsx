import Link from "next/link"
import {
  ActivityIcon,
  BotIcon,
  ListTodoIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"

const ENTRIES = [
  {
    href: "/gepa/llm",
    title: "LLM 配置",
    description: "管理 OpenAI 兼容与 Anthropic 供应商、模型列表和连接测试。",
    icon: ServerIcon,
    ready: true,
  },
  {
    href: "/gepa/agents",
    title: "Agents",
    description: "配置总控、执行、评估、反思与摘要 Agent 的提示词和模型。",
    icon: BotIcon,
    ready: false,
  },
  {
    href: "/gepa/tasks",
    title: "任务",
    description: "创建相互隔离的任务工作空间，管理技能模块与数据集。",
    icon: ListTodoIcon,
    ready: false,
  },
  {
    href: "/gepa/monitor",
    title: "监控",
    description: "查看调用量、Token 消耗、迭代轮次与任务进度。",
    icon: ActivityIcon,
    ready: false,
  },
  {
    href: "/gepa/constraints",
    title: "约束",
    description: "配置全局 tool 与 bash 约束，限制运行时的危险操作。",
    icon: ShieldCheckIcon,
    ready: false,
  },
  {
    href: "/gepa/settings",
    title: "设置",
    description: "调整迭代预算、帕累托集大小、成本单价与数据保留策略。",
    icon: Settings2Icon,
    ready: false,
  },
]

export default function GepaOverviewPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">GEPA 控制台</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          基于反思性提示变异与帕累托选择的技能迭代控制台。先配置 LLM
          供应商，再创建任务并启动优化运行。
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {ENTRIES.map(({ icon: Icon, ...entry }) => (
          <Link key={entry.href} href={entry.href} className="group">
            <Card className="h-full gap-4 transition-colors group-hover:border-foreground/20">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-5" />
                  </div>
                  {entry.ready ? (
                    <Badge variant="secondary">可用</Badge>
                  ) : (
                    <Badge variant="outline">即将推出</Badge>
                  )}
                </div>
                <CardTitle className="pt-2">{entry.title}</CardTitle>
                <CardDescription>{entry.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
