"use client"

import { ActivityIcon } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { MonitorSnapshot } from "@/lib/gepa/monitor"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/registry/new-york-v4/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/registry/new-york-v4/ui/empty"

import { formatCompactNumber, formatNumber } from "./format"

const chartConfig = {
  calls: {
    label: "调用量",
    color: "var(--chart-2)",
  },
  tokens: {
    label: "Token",
    color: "var(--chart-4)",
  },
  cache: {
    label: "缓存 Token",
    color: "var(--chart-5)",
  },
  // 图例按 dataKey 查找配置，补一个同义键保证缓存系列图例文案可见。
  cacheTokens: {
    label: "缓存 Token",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig

interface UsageTrendChartProps {
  snapshot: MonitorSnapshot
}

export function UsageTrendChart({ snapshot }: UsageTrendChartProps) {
  const data = snapshot.metrics.byDay.map((day) => ({
    date: day.date,
    calls: day.calls,
    tokens: day.inputTokens + day.outputTokens,
    cacheTokens: day.cacheTokens,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>调用趋势</CardTitle>
        <CardDescription>
          按天统计的调用量（左轴）与输入、输出与缓存 Token（右轴）。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Empty className="py-10 md:py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ActivityIcon />
              </EmptyMedia>
              <EmptyTitle>暂无调用数据</EmptyTitle>
              <EmptyDescription>
                运行任务或测试 LLM 连接后，这里会显示每日调用量与 Token 趋势。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={16}
                tickFormatter={(value) => String(value).slice(5)}
              />
              <YAxis
                yAxisId="calls"
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(value) => formatCompactNumber(Number(value))}
              />
              <YAxis
                yAxisId="tokens"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(value) => formatCompactNumber(Number(value))}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="text-muted-foreground">
                          {String(name)}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatNumber(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                yAxisId="calls"
                type="monotone"
                dataKey="calls"
                name="调用量"
                stroke="var(--color-calls)"
                fill="var(--color-calls)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="tokens"
                name="Token"
                stroke="var(--color-tokens)"
                fill="var(--color-tokens)"
                fillOpacity={0.1}
                strokeWidth={2}
              />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="cacheTokens"
                name="缓存 Token"
                stroke="var(--color-cache)"
                fill="var(--color-cache)"
                fillOpacity={0.06}
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
