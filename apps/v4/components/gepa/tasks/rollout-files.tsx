"use client"

import * as React from "react"
import { cn } from "cn"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react"

import { apiGet } from "@/lib/gepa/client"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"

import { errorText, formatBytes } from "./format"
import type {
  RolloutContentResponse,
  RolloutFilesResponse,
} from "./types"

function rolloutUrl(
  taskId: string,
  runId: string,
  candidateId: string,
  exampleId: string,
  path?: string
): string {
  const params = new URLSearchParams({ runId, candidateId, exampleId })
  if (path) params.set("path", path)
  return `/api/gepa/tasks/${taskId}/rollout?${params.toString()}`
}

/**
 * rollout 产物文件浏览器（只读）。
 * 折叠区首次展开时列出隔离目录内的文件，点击文件读取文本内容。
 */
export function RolloutFiles({
  taskId,
  runId,
  candidateId,
  exampleId,
  dir,
}: {
  taskId: string
  runId: string
  candidateId: string
  exampleId: string
  /** 服务端记录的隔离目录路径，仅用于展示。 */
  dir?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [entries, setEntries] = React.useState<
    RolloutFilesResponse["entries"] | null
  >(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [content, setContent] = React.useState<string | null>(null)
  const [fileLoading, setFileLoading] = React.useState(false)
  const [fileError, setFileError] = React.useState<string | null>(null)

  const loadList = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<RolloutFilesResponse>(
        rolloutUrl(taskId, runId, candidateId, exampleId)
      )
      setEntries(data.entries)
    } catch (listError) {
      setEntries(null)
      setError(errorText(listError, "加载产物文件失败"))
    } finally {
      setLoading(false)
    }
  }, [taskId, runId, candidateId, exampleId])

  // 首次展开时拉取文件列表；失败后不自动重试，等待手动刷新。
  React.useEffect(() => {
    if (open && !loading && entries === null && error === null) {
      void loadList()
    }
  }, [open, loading, entries, error, loadList])

  async function openFile(path: string) {
    if (fileLoading) return
    setSelectedPath(path)
    setContent(null)
    setFileError(null)
    setFileLoading(true)
    try {
      const data = await apiGet<RolloutContentResponse>(
        rolloutUrl(taskId, runId, candidateId, exampleId, path)
      )
      setContent(data.content)
    } catch (openError) {
      setFileError(errorText(openError, "读取文件失败"))
    } finally {
      setFileLoading(false)
    }
  }

  return (
    <div className="rounded-md border bg-background/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        title={dir}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        )}
        产物文件
        {entries !== null && (
          <Badge variant="outline" className="text-[10px] tabular-nums">
            {entries.length} 项
          </Badge>
        )}
        {dir && (
          <span className="ml-auto min-w-0 truncate font-mono text-[10px] text-muted-foreground/70">
            {dir}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t p-2">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              正在加载产物文件…
            </p>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <p className="text-xs text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadList()}
              >
                <RefreshCwIcon />
                重试
              </Button>
            </div>
          ) : entries === null ? null : entries.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              该 rollout 目录为空
            </p>
          ) : (
            <>
              <ScrollArea className="max-h-56">
                <ul className="space-y-0.5 pr-3">
                  {entries.map((entry) => {
                    const depth = entry.path.split("/").length - 1
                    if (entry.isDirectory) {
                      return (
                        <li
                          key={entry.path}
                          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground"
                          style={{ paddingLeft: `${depth * 12 + 6}px` }}
                        >
                          <FolderIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{entry.path}</span>
                        </li>
                      )
                    }
                    return (
                      <li key={entry.path}>
                        <button
                          type="button"
                          onClick={() => void openFile(entry.path)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted",
                            entry.path === selectedPath && "bg-muted font-medium"
                          )}
                          style={{ paddingLeft: `${depth * 12 + 6}px` }}
                        >
                          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{entry.path}</span>
                          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {formatBytes(entry.size)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>

              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileTextIcon className="size-3.5 shrink-0" />
                  <span className="truncate font-mono">
                    {selectedPath ?? "未选择文件"}
                  </span>
                </p>
                {fileLoading ? (
                  <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    正在读取文件…
                  </p>
                ) : fileError ? (
                  <p className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                    {fileError}
                  </p>
                ) : content !== null ? (
                  <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs break-words whitespace-pre-wrap">
                    {content}
                  </pre>
                ) : (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    点击上方文件查看内容
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
