"use client"

import * as React from "react"
import { CopyIcon, DownloadIcon, LightbulbIcon, QuoteIcon } from "lucide-react"

import type {
  AnalysisFinding,
  AnalysisReport,
  FindingCategory,
  FindingSeverity,
} from "@/lib/gepa/analysis-store"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Separator } from "@/registry/new-york-v4/ui/separator"

import { formatDateTime, formatDuration, formatNumber } from "../monitor/format"

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  high: "高",
  medium: "中",
  low: "低",
}

const SEVERITY_CLASSES: Record<FindingSeverity, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
}

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  efficiency: "执行效率",
  context: "上下文",
  skill: "技能",
  hook: "钩子",
  config: "配置",
  cost: "成本",
}

function scoreLabel(score: number | null): string {
  return score === null ? "未评分" : `${score.toFixed(1)} / 10`
}

function scoreClass(score: number | null): string {
  if (score === null) return "bg-muted text-muted-foreground border-border"
  if (score >= 8)
    return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
  if (score >= 6) return "bg-amber-500/10 text-amber-600 border-amber-500/30"
  return "bg-destructive/10 text-destructive border-destructive/30"
}

export function reportToMarkdown(report: AnalysisReport): string {
  const lines: string[] = []
  lines.push(`# Claude 会话分析报告`)
  lines.push("")
  lines.push(`- 会话：${report.sessionTitle}`)
  lines.push(
    `- 项目：${report.projectCwd ?? report.project}（${report.project}）`
  )
  lines.push(`- 会话 ID：${report.sessionId}`)
  lines.push(`- 分析时间：${formatDateTime(report.at)}`)
  lines.push(
    `- 模型：${report.model || "未知"}（${report.providerName || "未知供应商"}）`
  )
  if (report.score !== null)
    lines.push(`- 综合评分：${scoreLabel(report.score)}`)
  lines.push("")
  lines.push("## 总体评价")
  lines.push("")
  lines.push(report.summary || "（无）")
  lines.push("")
  lines.push(`## 发现（${report.findings.length} 条）`)
  lines.push("")
  const order: FindingSeverity[] = ["high", "medium", "low"]
  const findings = [...report.findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)
  )
  for (const [index, finding] of findings.entries()) {
    lines.push(
      `### ${index + 1}. [${SEVERITY_LABELS[finding.severity]}] ${finding.title}`
    )
    lines.push("")
    lines.push(`- 类别：${CATEGORY_LABELS[finding.category]}`)
    if (finding.evidence) {
      lines.push(`- 证据：${finding.evidence}`)
    }
    lines.push(`- 建议：${finding.suggestion}`)
    lines.push("")
  }
  if (report.nextSteps.length > 0) {
    lines.push("## 后续动作")
    lines.push("")
    for (const [index, step] of report.nextSteps.entries()) {
      lines.push(`${index + 1}. ${step}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

function useMarkdownActions(report: AnalysisReport) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 忽略剪贴板权限错误
    }
  }
  const download = () => {
    const blob = new Blob([reportToMarkdown(report)], {
      type: "text/markdown;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `claude-analysis-${report.sessionId.slice(0, 8)}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return { copied, copy, download }
}

export function ReportView({ report }: { report: AnalysisReport }) {
  const { copied, copy, download } = useMarkdownActions(report)
  const order: FindingSeverity[] = ["high", "medium", "low"]
  const findings = [...report.findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate">{report.sessionTitle}</CardTitle>
            <CardDescription className="truncate">
              {report.projectCwd ?? report.project} · 分析于{" "}
              {formatDateTime(report.at)}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant="outline"
              className={`text-xs ${scoreClass(report.score)}`}
            >
              评分 {scoreLabel(report.score)}
            </Badge>
            <Button variant="outline" size="sm" onClick={copy}>
              <CopyIcon />
              {copied ? "已复制" : "复制 Markdown"}
            </Button>
            <Button variant="outline" size="sm" onClick={download}>
              <DownloadIcon />
              下载
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed">{report.summary}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>模型：{report.model || "未知"}</span>
          <span>供应商：{report.providerName || "未知"}</span>
          <span>耗时：{formatDuration(report.durationMs)}</span>
          <span>
            Token：输入 {formatNumber(report.inputTokens)} / 输出{" "}
            {formatNumber(report.outputTokens)}
          </span>
          <span>
            摘要长度：{formatNumber(report.digestChars)} 字符
            {report.configsChars > 0
              ? ` + 配置 ${formatNumber(report.configsChars)} 字符`
              : ""}
          </span>
        </div>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-medium">
            优化发现（{findings.length} 条）
          </h3>
          {findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有发现具体问题。</p>
          ) : (
            <div className="space-y-3">
              {findings.map((finding, index) => (
                <FindingCard
                  key={`${finding.title}-${index}`}
                  finding={finding}
                  index={index}
                />
              ))}
            </div>
          )}
        </section>

        {report.nextSteps.length > 0 && (
          <>
            <Separator />
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <LightbulbIcon className="size-4 text-amber-500" />
                后续动作
              </h3>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {report.nextSteps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function FindingCard({
  finding,
  index,
}: {
  finding: AnalysisFinding
  index: number
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">#{index + 1}</span>
        <span className="text-sm font-medium">{finding.title}</span>
        <Badge
          variant="outline"
          className={`text-[11px] ${SEVERITY_CLASSES[finding.severity]}`}
        >
          {SEVERITY_LABELS[finding.severity]}
        </Badge>
        <Badge variant="secondary" className="text-[11px]">
          {CATEGORY_LABELS[finding.category]}
        </Badge>
      </div>
      {finding.evidence && (
        <div className="flex gap-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          <QuoteIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{finding.evidence}</span>
        </div>
      )}
      <p className="text-sm leading-relaxed">{finding.suggestion}</p>
    </div>
  )
}
