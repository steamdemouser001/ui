import Link from "next/link"
import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  ListTodoIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"

const QUICK_START = [
  {
    step: "1",
    href: "/gepa/llm",
    title: "配置 LLM",
    description: "添加供应商与模型，并设为默认供应商。",
  },
  {
    step: "2",
    href: "/gepa/agents",
    title: "调整 Agents",
    description: "检查执行、评估、反思等 Agent 的提示词与模型。",
  },
  {
    step: "3",
    href: "/gepa/tasks",
    title: "创建任务",
    description: "定义技能模块与数据集，每个任务拥有独立工作空间。",
  },
  {
    step: "4",
    href: "/gepa/monitor",
    title: "监控运行",
    description: "跟踪调用量、Token 成本、迭代轮次与任务进度。",
  },
]

const ENTRIES = [
  {
    href: "/gepa/llm",
    title: "LLM 配置",
    description: "管理 OpenAI 兼容与 Anthropic 供应商、模型列表和连接测试。",
    icon: ServerIcon,
  },
  {
    href: "/gepa/agents",
    title: "Agents",
    description: "配置总控、执行、评估、反思与摘要 Agent 的提示词和模型。",
    icon: BotIcon,
  },
  {
    href: "/gepa/tasks",
    title: "任务",
    description: "创建相互隔离的任务工作空间，管理技能模块与数据集。",
    icon: ListTodoIcon,
  },
  {
    href: "/gepa/monitor",
    title: "监控",
    description: "查看调用量、Token 消耗、迭代轮次与任务进度。",
    icon: ActivityIcon,
  },
  {
    href: "/gepa/constraints",
    title: "约束",
    description: "配置全局 tool 与 bash 约束，限制运行时的危险操作。",
    icon: ShieldCheckIcon,
  },
  {
    href: "/gepa/settings",
    title: "设置",
    description: "调整迭代预算、帕累托集大小、成本单价与数据保留策略。",
    icon: Settings2Icon,
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">快速开始</h2>
          <p className="text-sm text-muted-foreground">
            按顺序完成四步即可开始第一轮迭代
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_START.map((item) => (
            <Link key={item.href} href={item.href} className="group">
              <Card className="h-full gap-3 transition-colors group-hover:border-foreground/20">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {item.step}
                    </span>
                    <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <CardTitle className="pt-1 text-base">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">功能入口</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ENTRIES.map(({ icon: Icon, ...entry }) => (
            <Link key={entry.href} href={entry.href} className="group">
              <Card className="h-full gap-4 transition-colors group-hover:border-foreground/20">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                      <Icon className="size-5" />
                    </div>
                    <Badge variant="secondary">可用</Badge>
                  </div>
                  <CardTitle className="pt-2">{entry.title}</CardTitle>
                  <CardDescription>{entry.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-muted-foreground" />
            GEPA 如何工作
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            GEPA 由两部分组成：反思性提示变异（Reflective Prompt
            Mutation）与帕累托选择（Pareto Selection）。
          </p>
          <p>
            每一轮先在 minibatch
            上评估当前候选，收集执行轨迹与评估反馈，再由反思器改写技能模块的提示词；
            新候选只有在 minibatch
            上优于父代时才会被接受，帕累托前沿则用于后续的候选选择，
            在多个评估维度上维持多样性与稳定性。
          </p>
          <p>
            每个任务拥有独立的工作空间：技能模块、数据集、运行记录与总控对话互不干扰，
            可以并行准备多个任务，按需启动优化运行。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>最近任务与运行</CardTitle>
              <CardDescription>
                任务列表按更新时间排序，运行详情与调用指标可在监控页查看。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/gepa/tasks">查看任务</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/gepa/monitor">查看监控</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  )
}
