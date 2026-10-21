import { BotIcon } from "lucide-react"

import type { MonitorSnapshot } from "@/lib/gepa/monitor"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/registry/new-york-v4/ui/empty"
import { Progress } from "@/registry/new-york-v4/ui/progress"

import { agentLabel, formatNumber, formatPercent } from "./format"

const KNOWN_AGENT_IDS = [
  "orchestrator",
  "controller",
  "executor",
  "evaluator",
  "reflector",
  "summarizer",
  "llm-test",
]

interface AgentDistributionProps {
  snapshot: MonitorSnapshot
}

export function AgentDistribution({ snapshot }: AgentDistributionProps) {
  const byAgent = snapshot.metrics.byAgent
  const entries = [
    ...KNOWN_AGENT_IDS.map((id) => ({ id, count: byAgent[id] ?? 0 })),
    ...Object.entries(byAgent)
      .filter(([id]) => !KNOWN_AGENT_IDS.includes(id))
      .map(([id, count]) => ({ id, count })),
  ].filter((entry) => entry.count > 0)
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent 调用分布</CardTitle>
        <CardDescription>
          按 Agent 统计的 LLM 调用次数，包含连接测试产生的调用。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <Empty className="py-8 md:py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>暂无 Agent 调用记录</EmptyTitle>
              <EmptyDescription>
                启动任务或测试供应商连接后，这里会按 Agent 展示调用分布。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {entries.map((entry) => {
              const percent = total > 0 ? (entry.count / total) * 100 : 0
              return (
                <div key={entry.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{agentLabel(entry.id)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatNumber(entry.count)} 次 ·{" "}
                      {formatPercent(entry.count / total)}
                    </span>
                  </div>
                  <Progress value={percent} className="h-1.5" />
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
