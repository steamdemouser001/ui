"use client"

import * as React from "react"
import { cn } from "cn"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PlayIcon,
  TerminalIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/gepa/client"
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
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

const MAX_DISPLAY_CHARS = 20_000

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

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
  const clipped = content.length > MAX_DISPLAY_CHARS
  const text = clipped ? content.slice(0, MAX_DISPLAY_CHARS) : content
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium">{title}</span>
        <span>
          {content.length} 字符
          {clipped ? `，仅显示前 ${MAX_DISPLAY_CHARS} 字符` : ""}
        </span>
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap",
          tone === "error" &&
            "border-destructive/30 bg-destructive/5 text-destructive"
        )}
      >
        {text}
      </pre>
    </div>
  )
}

function ResultPanel({ result }: { result: SandboxResult }) {
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
        <Badge variant={result.allowed ? "secondary" : "destructive"}>
          {result.allowed ? "allowed" : "denied"}
        </Badge>
        {result.allowed && (
          <Badge variant="outline">
            {result.exitCode === null
              ? "无退出码"
              : `退出码 ${result.exitCode}`}
          </Badge>
        )}
        {result.truncated && <Badge variant="outline">输出已截断</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {result.durationMs}ms
        </span>
      </div>

      <p className="text-sm break-words">{result.reason}</p>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="break-all">
          工作目录：
          <span className="font-mono text-foreground">{result.cwd || "—"}</span>
        </div>
        <div className="break-all">
          退出码：
          <span className="font-mono text-foreground">
            {result.exitCode ?? "—"}
          </span>
        </div>
      </div>

      <OutputBlock title="stdout" content={result.stdout} />
      <OutputBlock title="stderr" content={result.stderr} tone="error" />
      {result.allowed && !result.stdout && !result.stderr && (
        <p className="text-xs text-muted-foreground">（无输出）</p>
      )}
    </div>
  )
}

export function SandboxTerminal({ dataRoot }: { dataRoot: string }) {
  const [command, setCommand] = React.useState("")
  const [taskId, setTaskId] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<SandboxResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function handleRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = command.trim()
    if (!trimmed) {
      toast.error("请输入要测试的命令")
      return
    }
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const data = await apiPost<SandboxResult>("/api/gepa/constraints/test", {
        command: trimmed,
        taskId: taskId.trim() || undefined,
      })
      setResult(data)
      if (data.allowed) {
        toast.success("命令已通过策略校验并执行")
      } else {
        toast.warning("命令被约束拒绝")
      }
    } catch (runError) {
      const message = errorText(runError, "测试命令失败")
      setError(message)
      toast.error(message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalIcon className="size-4" />
          测试终端
        </CardTitle>
        <CardDescription className="space-y-1">
          <span className="block">
            命令在服务端沙箱中执行，使用已保存的约束。修改上方配置后请先保存再测试。
          </span>
          <span className="block break-all">
            沙箱数据目录：
            <code className="font-mono text-xs text-foreground">
              {dataRoot || "—"}
            </code>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleRun} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="sandbox-command">命令</Label>
            <Textarea
              id="sandbox-command"
              rows={2}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="例如：ls -la 或 node --version"
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="sandbox-task-id">任务 ID（可选）</Label>
              <Input
                id="sandbox-task-id"
                value={taskId}
                onChange={(event) => setTaskId(event.target.value)}
                placeholder="例如：demo-task；留空则使用全局沙箱目录"
                className="font-mono"
              />
            </div>
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

        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>测试失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && <ResultPanel result={result} />}
      </CardContent>
    </Card>
  )
}
