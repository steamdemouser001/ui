import { Fragment } from "react"
import { AlertCircleIcon, HistoryIcon } from "lucide-react"

import type { LlmCallLog } from "@/lib/gepa/types"
import { Badge } from "@/registry/new-york-v4/ui/badge"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/registry/new-york-v4/ui/table"

import {
  agentLabel,
  formatDuration,
  formatNumber,
  formatShortDateTime,
} from "./format"

interface RecentCallsProps {
  calls: LlmCallLog[]
}

export function RecentCalls({ calls }: RecentCallsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>最近调用</CardTitle>
        <CardDescription>
          最近的 LLM 调用记录（最多 20 条），按时间倒序。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <Empty className="py-8 md:py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>暂无调用记录</EmptyTitle>
              <EmptyDescription>
                运行任务或测试 LLM 连接后，这里会显示最近的调用流水。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>Token（入 / 出）</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call, index) => (
                <Fragment key={`${call.id}-${index}`}>
                  <TableRow>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatShortDateTime(call.at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {agentLabel(call.agentId)}
                    </TableCell>
                    <TableCell className="min-w-40">
                      <div className="font-mono text-xs">
                        {call.model || "—"}
                      </div>
                      {call.providerName && (
                        <div className="text-xs text-muted-foreground">
                          {call.providerName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatNumber(call.inputTokens)} /{" "}
                      {formatNumber(call.outputTokens)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDuration(call.durationMs)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          call.success
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-destructive/30 bg-destructive/10 text-destructive"
                        }
                      >
                        {call.success ? "成功" : "失败"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {!call.success && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="pt-0">
                        <div className="flex items-start gap-1.5 text-xs text-destructive">
                          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                          <span className="line-clamp-2 break-all">
                            {call.error || "调用失败（未记录错误信息）"}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
