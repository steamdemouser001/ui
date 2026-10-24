"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ClipboardListIcon,
  CoinsIcon,
  FileSearchIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  TerminalSquareIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react"

import type { AnalysisReport } from "@/lib/gepa/analysis-store"
import type {
  AnalysisIncludeOptions,
  ClaudeProjectInfo,
  SessionScan,
} from "@/lib/gepa/claude-inspect"
import { apiDelete, apiGet, apiPost } from "@/lib/gepa/client"
import { cn } from "@/lib/utils"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/registry/new-york-v4/ui/alert"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Label } from "@/registry/new-york-v4/ui/label"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { Switch } from "@/registry/new-york-v4/ui/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/registry/new-york-v4/ui/tabs"

import { formatCost, formatDateTime, formatNumber } from "../monitor/format"
import { ReportView } from "./report-view"
import { SessionPreview, SessionPreviewBadge } from "./session-preview"

const ALL_PROJECTS = "__all__"

const INCLUDE_ITEMS: {
  key: keyof AnalysisIncludeOptions
  label: string
  hint: string
}[] = [
  { key: "skills", label: "技能", hint: "用户与项目的 SKILL.md" },
  { key: "hooks", label: "钩子", hint: "settings.json 中的 hooks 配置" },
  { key: "memory", label: "记忆", hint: "CLAUDE.md / AGENTS.md" },
  { key: "mcp", label: "MCP", hint: "已配置的 MCP 服务器" },
  { key: "commands", label: "自定义命令", hint: "commands/*.md" },
  { key: "plugins", label: "插件", hint: "已启用的插件列表" },
]

interface DigestPreview {
  digestText: string
  configsText: string
  scan: SessionScan
}

interface SessionsResponse {
  projects: ClaudeProjectInfo[]
  project: string | null
  sessions: SessionScan[]
  total: number
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function SessionList({
  sessions,
  selectedId,
  reportCounts,
  onSelect,
  disabled,
}: {
  sessions: SessionScan[]
  selectedId: string | null
  reportCounts: Record<string, number>
  onSelect: (sessionId: string) => void
  disabled: boolean
}) {
  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        该项目没有会话记录
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      {sessions.map((session) => {
        const selected = session.sessionId === selectedId
        const reportCount = reportCounts[session.sessionId] ?? 0
        return (
          <button
            key={session.sessionId}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(session.sessionId)}
            className={cn(
              "w-full rounded-lg border p-2.5 text-left transition-colors",
              "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
              selected && "border-primary/50 bg-accent"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-sm leading-snug font-medium">
                {session.title}
              </span>
              {reportCount > 0 ? (
                <SessionPreviewBadge count={reportCount} />
              ) : session.costUsd !== null && session.costUsd > 0 ? (
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] text-muted-foreground"
                >
                  ${session.costUsd.toFixed(2)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>{formatDateTime(session.updatedAt)}</span>
              <span className="inline-flex items-center gap-0.5">
                <MessageSquareIcon className="size-3" />
                {session.userMessages}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <WrenchIcon className="size-3" />
                {session.toolCalls}
                {session.toolErrors > 0 && (
                  <span className="text-destructive">
                    （错误 {session.toolErrors}）
                  </span>
                )}
              </span>
              {session.hookErrors > 0 && (
                <span className="text-destructive">
                  钩子错误 {session.hookErrors}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function OptionsCard({
  include,
  onToggle,
  hasProjects,
  loading,
  previewing,
  analyzing,
  canRun,
  onPreview,
  onRun,
}: {
  include: AnalysisIncludeOptions
  onToggle: (key: keyof AnalysisIncludeOptions, value: boolean) => void
  hasProjects: boolean
  loading: boolean
  previewing: boolean
  analyzing: boolean
  canRun: boolean
  onPreview: () => void
  onRun: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">分析范围</CardTitle>
        <CardDescription>
          除会话记录外，可选读入本地 Claude
          配置一起分析；采集项越多，上下文越大。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {INCLUDE_ITEMS.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
            >
              <div className="min-w-0">
                <Label className="text-sm">{item.label}</Label>
                <p className="truncate text-[11px] text-muted-foreground">
                  {item.hint}
                </p>
              </div>
              <Switch
                checked={include[item.key]}
                onCheckedChange={(value) => onToggle(item.key, value)}
                disabled={loading || previewing || analyzing}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onPreview}
            disabled={!canRun || previewing || analyzing}
          >
            {previewing ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <ClipboardListIcon />
            )}
            预览摘要
          </Button>
          <Button onClick={onRun} disabled={!canRun || previewing || analyzing}>
            {analyzing ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <ScanSearchIcon />
            )}
            {analyzing ? "分析中，可能需要 1-2 分钟…" : "开始分析"}
          </Button>
        </div>
        {!canRun && (
          <p className="text-xs text-muted-foreground">
            {hasProjects
              ? "请先在左侧选择一个会话。"
              : "未检测到 Claude Code 会话目录，请确认本机已安装并使用过 Claude Code。"}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DigestPreviewCard({ preview }: { preview: DigestPreview }) {
  const [showConfigs, setShowConfigs] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">摘要预览</CardTitle>
        <CardDescription>
          以下内容将作为{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
            {"{{digest}}"}
          </code>{" "}
          与{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
            {"{{configs}}"}
          </code>{" "}
          变量发送给会话分析师。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              会话摘要（{formatNumber(preview.digestText.length)} 字符）
            </span>
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {preview.digestText}
          </pre>
        </div>
        <Separator />
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => setShowConfigs((value) => !value)}
          >
            {showConfigs
              ? "收起配置内容"
              : `展开配置内容（${formatNumber(preview.configsText.length)} 字符）`}
          </Button>
          {showConfigs && (
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {preview.configsText || "（未采集到配置）"}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function HistoryList({
  reports,
  selectedId,
  onSelect,
  onDelete,
}: {
  reports: AnalysisReport[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (reports.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        还没有历史报告，去「分析」标签页生成一份吧
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      {reports.map((report) => (
        <div
          key={report.id}
          className={cn(
            "group flex items-start gap-2 rounded-lg border p-2.5 transition-colors",
            "hover:bg-accent",
            report.id === selectedId && "border-primary/50 bg-accent"
          )}
        >
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onSelect(report.id)}
          >
            <span className="line-clamp-1 text-sm font-medium">
              {report.sessionTitle}
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {formatDateTime(report.at)} · {report.findings.length} 条发现
              {report.score !== null && ` · 评分 ${report.score.toFixed(1)}`}
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => onDelete(report.id)}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}

/** 当前选中会话的历史分析报告切换条（时间 + 评分 + 发现数）。 */
function SessionReportPills({
  reports,
  activeId,
  onSelect,
}: {
  reports: AnalysisReport[]
  activeId: string | null
  onSelect: (report: AnalysisReport) => void
}) {
  if (reports.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        该会话的 {reports.length} 份历史分析
      </p>
      <div className="flex flex-wrap gap-1.5">
        {reports.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              "hover:bg-accent",
              item.id === activeId
                ? "border-primary/50 bg-accent font-medium"
                : "text-muted-foreground"
            )}
          >
            {formatDateTime(item.at).slice(5)}
            {item.score !== null && ` · ${item.score.toFixed(1)}分`}
            {` · ${item.findings.length}条`}
          </button>
        ))}
      </div>
    </div>
  )
}

export function AnalyzeDashboard() {
  const [tab, setTab] = React.useState("analyze")
  const [rightTab, setRightTab] = React.useState<"preview" | "report">(
    "preview"
  )
  const [projects, setProjects] = React.useState<ClaudeProjectInfo[]>([])
  const [projectsError, setProjectsError] = React.useState<string | null>(null)
  const [selectedProject, setSelectedProject] =
    React.useState<string>(ALL_PROJECTS)
  const [sessions, setSessions] = React.useState<SessionScan[]>([])
  const [sessionsLoading, setSessionsLoading] = React.useState(false)
  const [selectedSession, setSelectedSession] =
    React.useState<SessionScan | null>(null)
  const [include, setInclude] = React.useState<AnalysisIncludeOptions>({
    skills: true,
    hooks: true,
    commands: false,
    memory: true,
    mcp: true,
    plugins: false,
  })
  const [preview, setPreview] = React.useState<DigestPreview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [analyzing, setAnalyzing] = React.useState(false)
  const [runError, setRunError] = React.useState<string | null>(null)
  const [activeReport, setActiveReport] = React.useState<AnalysisReport | null>(
    null
  )
  const [reports, setReports] = React.useState<AnalysisReport[]>([])
  const [historyReport, setHistoryReport] =
    React.useState<AnalysisReport | null>(null)
  const [reportsLoading, setReportsLoading] = React.useState(false)

  const loadSessions = React.useCallback(async (slug: string) => {
    setSessionsLoading(true)
    setSelectedSession(null)
    setPreview(null)
    setProjectsError(null)
    try {
      const query =
        slug === ALL_PROJECTS ? "" : `?project=${encodeURIComponent(slug)}`
      const data = await apiGet<SessionsResponse>(
        `/api/gepa/analyze/sessions${query}`
      )
      setProjects(data.projects ?? [])
      setSessions(data.sessions ?? [])
    } catch (error) {
      setSessions([])
      setProjectsError(errorText(error, "加载会话列表失败"))
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  const loadReports = React.useCallback(async () => {
    setReportsLoading(true)
    try {
      const data = await apiGet<{ reports: AnalysisReport[] }>(
        "/api/gepa/analyze/reports?limit=100"
      )
      setReports(data.reports)
    } catch {
      // 历史列表加载失败不阻塞页面
    } finally {
      setReportsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadReports()
  }, [loadReports])

  React.useEffect(() => {
    void loadSessions(selectedProject)
  }, [selectedProject, loadSessions])

  const requestBase = selectedSession
    ? { project: selectedSession.project, sessionId: selectedSession.sessionId }
    : null

  // 按会话聚合历史报告（reports 已按时间倒序），用于「已分析」标记与切换。
  const reportsBySession = React.useMemo(() => {
    const map: Record<string, AnalysisReport[]> = {}
    for (const item of reports) {
      const list = map[item.sessionId]
      if (list) {
        list.push(item)
      } else {
        map[item.sessionId] = [item]
      }
    }
    return map
  }, [reports])
  const sessionReports = selectedSession
    ? (reportsBySession[selectedSession.sessionId] ?? [])
    : []
  const reportCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [sessionId, list] of Object.entries(reportsBySession)) {
      counts[sessionId] = list.length
    }
    return counts
  }, [reportsBySession])

  const handleSelectSession = (sessionId: string) => {
    const session =
      sessions.find((item) => item.sessionId === sessionId) ?? null
    setSelectedSession(session)
    setPreview(null)
    setRunError(null)
    setActiveReport(
      session ? (reportsBySession[session.sessionId]?.[0] ?? null) : null
    )
    setRightTab("preview")
  }

  const handlePreview = async () => {
    if (!requestBase) return
    setPreviewing(true)
    setRunError(null)
    try {
      const data = await apiPost<DigestPreview>("/api/gepa/analyze/digest", {
        ...requestBase,
        include,
      })
      setPreview(data)
    } catch (error) {
      setRunError(errorText(error, "构建摘要失败"))
    } finally {
      setPreviewing(false)
    }
  }

  const handleRun = async () => {
    if (!requestBase) return
    setAnalyzing(true)
    setRunError(null)
    setPreview(null)
    try {
      const data = await apiPost<{ report: AnalysisReport }>(
        "/api/gepa/analyze/run",
        { ...requestBase, include }
      )
      setActiveReport(data.report)
      setRightTab("report")
      void loadReports()
    } catch (error) {
      setRunError(errorText(error, "分析失败"))
    } finally {
      setAnalyzing(false)
    }
  }

  const handleDeleteReport = async (id: string) => {
    try {
      await apiDelete(`/api/gepa/analyze/reports/${id}`)
      setReports((items) => items.filter((item) => item.id !== id))
      if (historyReport?.id === id) setHistoryReport(null)
      if (activeReport?.id === id) {
        setActiveReport(
          selectedSession
            ? (reportsBySession[selectedSession.sessionId]?.find(
                (item) => item.id !== id
              ) ?? null)
            : null
        )
      }
    } catch {
      // 删除失败保持原状
    }
  }

  const handleOpenHistory = async (id: string) => {
    const existing = reports.find((item) => item.id === id)
    if (existing) {
      setHistoryReport(existing)
      return
    }
    try {
      const data = await apiGet<{ report: AnalysisReport }>(
        `/api/gepa/analyze/reports/${id}`
      )
      setHistoryReport(data.report)
    } catch {
      // 忽略
    }
  }

  const projectExists = projects.length > 0
  const selectedProjectInfo =
    selectedProject === ALL_PROJECTS
      ? null
      : (projects.find((item) => item.slug === selectedProject) ?? null)

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="analyze">会话分析</TabsTrigger>
        <TabsTrigger value="history">
          历史报告{reports.length > 0 ? ` (${reports.length})` : ""}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="analyze" className="space-y-4">
        {projectsError && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>无法读取 Claude Code 数据</AlertTitle>
            <AlertDescription>{projectsError}</AlertDescription>
          </Alert>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">会话</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => void loadSessions(selectedProject)}
                  disabled={sessionsLoading}
                >
                  <RefreshCwIcon
                    className={cn(
                      "size-3.5",
                      sessionsLoading && "animate-spin"
                    )}
                  />
                </Button>
              </div>
              <Select
                value={selectedProject}
                onValueChange={setSelectedProject}
                disabled={!projectExists || sessionsLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={projectExists ? "选择项目" : "没有可用项目"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROJECTS}>全部项目（最近）</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.slug} value={project.slug}>
                      {project.cwd ?? project.slug}（{project.sessionCount}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProjectInfo?.lastActiveAt && (
                <p className="text-[11px] text-muted-foreground">
                  最近活动：{formatDateTime(selectedProjectInfo.lastActiveAt)}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[560px] pr-3">
                {sessionsLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    正在扫描会话…
                  </p>
                ) : (
                  <SessionList
                    sessions={sessions}
                    selectedId={selectedSession?.sessionId ?? null}
                    reportCounts={reportCounts}
                    onSelect={handleSelectSession}
                    disabled={sessionsLoading}
                  />
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <OptionsCard
              include={include}
              onToggle={(key, value) =>
                setInclude((current) => ({ ...current, [key]: value }))
              }
              hasProjects={projectExists}
              loading={sessionsLoading}
              previewing={previewing}
              analyzing={analyzing}
              canRun={Boolean(requestBase)}
              onPreview={() => void handlePreview()}
              onRun={() => void handleRun()}
            />

            {runError && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{runError}</AlertDescription>
              </Alert>
            )}

            {preview && <DigestPreviewCard preview={preview} />}

            <Tabs
              value={rightTab}
              onValueChange={(value) =>
                setRightTab(value as "preview" | "report")
              }
              className="space-y-3"
            >
              <TabsList>
                <TabsTrigger value="preview">
                  <TerminalSquareIcon />
                  会话预览
                </TabsTrigger>
                <TabsTrigger value="report">
                  <FileSearchIcon />
                  分析报告
                  {sessionReports.length > 0
                    ? ` (${sessionReports.length})`
                    : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="preview" className="space-y-3">
                {selectedSession ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {selectedSession.title} ·{" "}
                      {formatDateTime(selectedSession.updatedAt)} ·{" "}
                      {selectedSession.userMessages} 条用户消息 /{" "}
                      {selectedSession.toolCalls} 次工具调用
                    </p>
                    <SessionPreview
                      project={selectedSession.project}
                      sessionId={selectedSession.sessionId}
                    />
                  </>
                ) : (
                  <Card>
                    <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                      <TerminalSquareIcon className="size-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        选择左侧任意会话，此处按 Claude Code
                        终端风格回放对话与工具调用过程。
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="report" className="space-y-3">
                <SessionReportPills
                  reports={sessionReports}
                  activeId={activeReport?.id ?? null}
                  onSelect={(item) => setActiveReport(item)}
                />
                {analyzing ? (
                  <Card>
                    <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        正在分析会话，通常需要 1-2 分钟…
                      </p>
                    </CardContent>
                  </Card>
                ) : activeReport ? (
                  <ReportView report={activeReport} />
                ) : (
                  <Card>
                    <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                      <FileSearchIcon className="size-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        {selectedSession
                          ? "该会话还没有分析报告，点击上方「开始分析」生成；AI 将读取会话记录与可选配置，输出优化建议。"
                          : "选择一个会话并点击「开始分析」，AI 将读取会话记录与可选配置，输出优化建议报告。"}
                      </p>
                      {selectedSession && (
                        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CoinsIcon className="size-3" />
                          该会话约{" "}
                          {formatNumber(
                            selectedSession.inputTokens +
                              selectedSession.outputTokens
                          )}{" "}
                          tokens，成本{" "}
                          {formatCost(selectedSession.costUsd ?? 0)}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="history" className="space-y-4">
        <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">历史报告</CardTitle>
              <CardDescription>最近 100 份分析报告</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[560px] pr-3">
                {reportsLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    加载中…
                  </p>
                ) : (
                  <HistoryList
                    reports={reports}
                    selectedId={historyReport?.id ?? null}
                    onSelect={(id) => void handleOpenHistory(id)}
                    onDelete={(id) => void handleDeleteReport(id)}
                  />
                )}
              </ScrollArea>
            </CardContent>
          </Card>
          <div>
            {historyReport ? (
              <ReportView report={historyReport} />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <FileSearchIcon className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    从左侧选择一份历史报告查看详情。
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}
