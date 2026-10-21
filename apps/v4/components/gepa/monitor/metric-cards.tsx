import {
  ActivityIcon,
  BadgeCheckIcon,
  CoinsIcon,
  HashIcon,
  ListTodoIcon,
  SparklesIcon,
} from "lucide-react"

import type { MonitorSnapshot } from "@/lib/gepa/monitor"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"

import { formatCost, formatNumber, formatPercent } from "./format"

interface MetricCardsProps {
  snapshot: MonitorSnapshot
}

export function MetricCards({ snapshot }: MetricCardsProps) {
  const { metrics, totals } = snapshot
  const successRate =
    metrics.totalCalls > 0 ? metrics.successfulCalls / metrics.totalCalls : null

  const items = [
    {
      label: "LLM 调用总数",
      value: formatNumber(metrics.totalCalls),
      hint: `失败 ${formatNumber(metrics.failedCalls)} 次`,
      icon: ActivityIcon,
    },
    {
      label: "调用成功率",
      value: successRate === null ? "—" : formatPercent(successRate),
      hint:
        successRate === null
          ? "暂无调用记录"
          : `成功 ${formatNumber(metrics.successfulCalls)} 次`,
      icon: BadgeCheckIcon,
    },
    {
      label: "Token 用量",
      value: formatNumber(metrics.inputTokens + metrics.outputTokens),
      hint: `输入 ${formatNumber(metrics.inputTokens)} · 输出 ${formatNumber(metrics.outputTokens)}`,
      icon: HashIcon,
    },
    {
      label: "预估成本",
      value: formatCost(metrics.estimatedCost),
      hint: "按设置中的单价估算",
      icon: CoinsIcon,
    },
    {
      label: "运行中任务",
      value: formatNumber(totals.running),
      hint: `共 ${formatNumber(totals.tasks)} 个任务 · 暂停 ${formatNumber(totals.paused)} 个`,
      icon: ListTodoIcon,
    },
    {
      label: "累计迭代",
      value: formatNumber(totals.totalIterations),
      hint: `接受候选 ${formatNumber(totals.acceptedCandidates)} 个`,
      icon: SparklesIcon,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ icon: Icon, ...item }) => (
        <Card key={item.label} className="gap-3 py-5">
          <CardHeader className="px-5">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Icon className="size-3.5" />
              {item.label}
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {item.value}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 text-xs text-muted-foreground">
            {item.hint}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
