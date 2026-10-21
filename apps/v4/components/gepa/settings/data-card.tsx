"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, DatabaseIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"

interface DataCardProps {
  dataRoot: string | null
  error: string | null
  onRetry: () => void
}

export function DataCard({ dataRoot, error, onRetry }: DataCardProps) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    if (!dataRoot) return
    try {
      await navigator.clipboard.writeText(dataRoot)
      setCopied(true)
      toast.success("数据目录已复制")
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("复制失败，请手动选择路径")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>数据与运行</CardTitle>
        <CardDescription>
          GEPA 的配置、任务工作空间、运行记录与调用指标都保存在本地文件中。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">数据目录</p>
          {dataRoot ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
              <code
                className="min-w-0 flex-1 truncate font-mono text-xs"
                title={dataRoot}
              >
                {dataRoot}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleCopy()}
                aria-label="复制数据目录"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {error ?? "正在读取数据目录…"}
              </p>
              {error && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  重试
                </Button>
              )}
            </div>
          )}
        </div>

        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            默认目录为应用工作目录下的{" "}
            <code className="font-mono text-xs">.gepa-data</code>，可通过环境变量{" "}
            <code className="font-mono text-xs">GEPA_DATA_DIR</code> 指定其他位置。
          </li>
          <li>
            配置、任务工作空间、运行记录与 LLM 调用指标均以 JSON / JSONL
            文件存储，无需数据库。
          </li>
          <li>
            部署时请将数据目录挂载到持久化卷，并保持单实例写入或使用共享文件系统，
            避免重启丢失数据以及并发写冲突。
          </li>
          <li>
            备份时直接复制该目录即可；目录中可能包含 API Key
            等敏感信息，请勿提交到版本库。
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}
