"use client"

import * as React from "react"
import { cn } from "cn"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FolderIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  SaveIcon,
  TerminalIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/gepa/client"
import type { SandboxResult } from "@/lib/gepa/sandbox"
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
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

import {
  errorText,
  formatBytes,
  formatDateTime,
  formatDuration,
} from "./format"
import type { WorkspaceContentResponse, WorkspaceFilesResponse } from "./types"

const MAX_OUTPUT_CHARS = 20_000

function OutputBlock({
  title,
  content,
  tone,
}: {
  title: string
  content: string
  tone?: "error"
}) {
  if (!content) return null
  const clipped = content.length > MAX_OUTPUT_CHARS
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium">{title}</span>
        <span>
          {content.length} 字符
          {clipped ? `，仅显示前 ${MAX_OUTPUT_CHARS} 字符` : ""}
        </span>
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap",
          tone === "error" &&
            "border-destructive/30 bg-destructive/5 text-destructive"
        )}
      >
        {clipped ? content.slice(0, MAX_OUTPUT_CHARS) : content}
      </pre>
    </div>
  )
}

function SandboxResultPanel({ result }: { result: SandboxResult }) {
  return (
    <div
      className={cn(
        "space-y-4 rounded-lg border p-4",
        result.allowed
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-destructive/40 bg-destructive/5"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {result.allowed ? (
          <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertCircleIcon className="size-4 text-destructive" />
        )}
        <span className="font-medium">
          {result.allowed ? "策略允许执行" : "策略已拒绝"}
        </span>
        {result.allowed && (
          <Badge variant="outline">
            {result.exitCode === null
              ? "无退出码"
              : `退出码 ${result.exitCode}`}
          </Badge>
        )}
        {result.truncated && <Badge variant="outline">输出已截断</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDuration(result.durationMs)}
        </span>
      </div>

      <p className="text-sm break-words">{result.reason}</p>

      <div className="text-xs break-all text-muted-foreground">
        工作目录：
        <span className="font-mono text-foreground">{result.cwd || "—"}</span>
      </div>

      <OutputBlock title="stdout" content={result.stdout} />
      <OutputBlock title="stderr" content={result.stderr} tone="error" />
      {result.allowed && !result.stdout && !result.stderr && (
        <p className="text-xs text-muted-foreground">（无输出）</p>
      )}
    </div>
  )
}

export function WorkspaceTab({ taskId }: { taskId: string }) {
  const [files, setFiles] = React.useState<WorkspaceFilesResponse["files"]>([])
  const [summary, setSummary] = React.useState<
    WorkspaceFilesResponse["summary"] | null
  >(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [content, setContent] = React.useState("")
  const [savedContent, setSavedContent] = React.useState("")
  const [fileLoading, setFileLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const [command, setCommand] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<SandboxResult | null>(null)

  const loadFiles = React.useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const data = await apiGet<WorkspaceFilesResponse>(
          `/api/gepa/tasks/${taskId}/workspace`
        )
        setFiles(data.files)
        setSummary(data.summary)
        setError(null)
      } catch (loadError) {
        if (!silent) setError(errorText(loadError, "加载工作空间失败"))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [taskId]
  )

  React.useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  async function openFile(path: string) {
    setFileLoading(true)
    try {
      const data = await apiGet<WorkspaceContentResponse>(
        `/api/gepa/tasks/${taskId}/workspace?path=${encodeURIComponent(path)}`
      )
      setSelectedPath(data.path)
      setContent(data.content)
      setSavedContent(data.content)
    } catch (openError) {
      toast.error(errorText(openError, "读取文件失败"))
    } finally {
      setFileLoading(false)
    }
  }

  async function handleSave() {
    if (!selectedPath) return
    setSaving(true)
    try {
      await apiPost<{ path: string }>(`/api/gepa/tasks/${taskId}/workspace`, {
        path: selectedPath,
        content,
      })
      setSavedContent(content)
      toast.success(`已保存 ${selectedPath}`)
      void loadFiles(true)
    } catch (saveError) {
      toast.error(errorText(saveError, "保存文件失败"))
    } finally {
      setSaving(false)
    }
  }

  async function handleRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = command.trim()
    if (!trimmed) {
      toast.error("请输入要执行的命令")
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const data = await apiPost<SandboxResult>(
        `/api/gepa/tasks/${taskId}/workspace/exec`,
        { command: trimmed }
      )
      setResult(data)
      if (data.allowed) {
        toast.success("命令执行完成")
      } else {
        toast.warning("命令被约束拒绝")
      }
      void loadFiles(true)
    } catch (runError) {
      toast.error(errorText(runError, "执行命令失败"))
    } finally {
      setRunning(false)
    }
  }

  const dirty = selectedPath !== null && content !== savedContent

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FolderIcon className="size-4" />
            工作空间
          </h2>
          <p className="text-sm text-muted-foreground">
            {summary
              ? `${summary.files} 个文件 · ${formatBytes(summary.totalBytes)} · 更新于 ${formatDateTime(summary.updatedAt)}`
              : "任务独立的数据目录"}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void loadFiles()}
          disabled={loading}
        >
          {loading ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          刷新
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base">文件</CardTitle>
            <CardDescription>点击文本文件查看或编辑。</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-5 w-full" />
                ))}
              </div>
            ) : files.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                工作空间为空
              </p>
            ) : (
              <ScrollArea className="max-h-96">
                <ul className="space-y-0.5 pr-3">
                  {files.map((file) => {
                    const depth = file.path.split("/").length - 1
                    const isActive = file.path === selectedPath
                    if (file.isDirectory) {
                      return (
                        <li
                          key={file.path}
                          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground"
                          style={{ paddingLeft: `${depth * 12 + 6}px` }}
                        >
                          <FolderIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{file.path}</span>
                        </li>
                      )
                    }
                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          onClick={() => void openFile(file.path)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted",
                            isActive && "bg-muted font-medium"
                          )}
                          style={{ paddingLeft: `${depth * 12 + 6}px` }}
                        >
                          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{file.path}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                            {formatBytes(file.size)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <FileTextIcon className="size-4" />
                  <span className="truncate font-mono text-sm">
                    {selectedPath ?? "未选择文件"}
                  </span>
                  {dirty && <Badge variant="secondary">未保存</Badge>}
                </CardTitle>
                <CardDescription>
                  保存写入会经过全局工具约束校验，被拒绝时会显示具体原因。
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setContent(savedContent)}
                  disabled={!dirty || saving}
                >
                  <Undo2Icon />
                  撤销
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving || fileLoading}
                >
                  {saving ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <SaveIcon />
                  )}
                  保存
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {fileLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : selectedPath ? (
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={18}
                className="max-h-[32rem] font-mono text-xs"
                spellCheck={false}
              />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                从左侧文件列表选择一个文本文件
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalIcon className="size-4" />
            命令终端
          </CardTitle>
          <CardDescription>
            命令在任务工作空间内执行，受 /gepa/constraints 的 Bash 约束限制。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleRun} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="workspace-command">命令</Label>
              <Textarea
                id="workspace-command"
                rows={2}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="例如：ls -la 或 node --version"
                className="font-mono text-sm"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={running}>
                {running ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <PlayIcon />
                )}
                运行
              </Button>
            </div>
          </form>

          {result && <SandboxResultPanel result={result} />}
        </CardContent>
      </Card>
    </div>
  )
}
