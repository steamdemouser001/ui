"use client"

import * as React from "react"
import {
  DatabaseIcon,
  FileUpIcon,
  Loader2Icon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiPatch } from "@/lib/gepa/client"
import type { DatasetExample, TaskRecord } from "@/lib/gepa/types"
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

import {
  appendParsedExamples,
  MAX_DATASET_EXAMPLES,
  nextExampleId,
  parseDatasetText,
} from "./dataset-parse"
import { errorText } from "./format"

interface DatasetTabProps {
  taskId: string
  task: TaskRecord
  onRefresh: () => void | Promise<void>
}

export function DatasetTab({ taskId, task, onRefresh }: DatasetTabProps) {
  const [examples, setExamples] = React.useState<DatasetExample[]>(() =>
    task.dataset.map((example) => ({ ...example }))
  )
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [importText, setImportText] = React.useState("")
  const [importing, setImporting] = React.useState(false)

  React.useEffect(() => {
    if (dirty) return
    setExamples(task.dataset.map((example) => ({ ...example })))
  }, [task.dataset, dirty])

  function updateExample(index: number, patch: Partial<DatasetExample>) {
    setExamples((current) =>
      current.map((example, exampleIndex) =>
        exampleIndex === index ? { ...example, ...patch } : example
      )
    )
    setDirty(true)
  }

  function addExample() {
    if (examples.length >= MAX_DATASET_EXAMPLES) {
      toast.error(`数据集最多 ${MAX_DATASET_EXAMPLES} 条示例`)
      return
    }
    setExamples((current) => [
      ...current,
      { id: nextExampleId(current), input: "" },
    ])
    setDirty(true)
  }

  function removeExample(index: number) {
    setExamples((current) =>
      current.filter((_, exampleIndex) => exampleIndex !== index)
    )
    setDirty(true)
  }

  function handleImport() {
    if (!importText.trim()) {
      toast.error("请先粘贴要导入的数据集文本")
      return
    }
    setImporting(true)
    try {
      const parsed = parseDatasetText(importText)
      if (parsed.length === 0) {
        toast.error("没有解析到任何示例")
        return
      }
      if (examples.length + parsed.length > MAX_DATASET_EXAMPLES) {
        toast.error(
          `导入后将超过 ${MAX_DATASET_EXAMPLES} 条上限（当前 ${examples.length} 条，新增 ${parsed.length} 条）`
        )
        return
      }
      setExamples((current) => appendParsedExamples(current, parsed))
      setImportText("")
      setDirty(true)
      toast.success(`已导入 ${parsed.length} 条示例，保存后生效`)
    } catch (error) {
      toast.error(errorText(error, "解析数据集失败"))
    } finally {
      setImporting(false)
    }
  }

  async function handleSave() {
    const cleaned = examples.map((example, index) => ({
      ...example,
      input: example.input.trim(),
      expected: example.expected?.trim() || undefined,
    }))
    const emptyIndex = cleaned.findIndex((example) => !example.input)
    if (emptyIndex !== -1) {
      toast.error(`第 ${emptyIndex + 1} 条示例的输入不能为空`)
      return
    }

    setSaving(true)
    try {
      await apiPatch<{ task: TaskRecord }>(`/api/gepa/tasks/${taskId}`, {
        dataset: cleaned,
      })
      setDirty(false)
      toast.success(`数据集已保存（${cleaned.length} 条示例）`)
      await onRefresh()
    } catch (error) {
      toast.error(errorText(error, "保存数据集失败"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <DatabaseIcon className="size-4" />
            数据集
            {dirty && <Badge variant="secondary">未保存</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground">
            共 {examples.length} 条示例（上限 {MAX_DATASET_EXAMPLES}{" "}
            条）。期望输出用于评估器打分，可留空。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addExample} disabled={saving}>
            <PlusIcon />
            添加示例
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
            {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            保存
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUpIcon className="size-4" />
            批量导入
          </CardTitle>
          <CardDescription>
            支持 JSON 数组、JSONL（每行一个 JSON
            对象）或纯文本（每行一条示例）。导入内容会追加到现有列表。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={4}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={
              '例如：\n{"input":"把这句话改写得更正式：..."}\n{"input":"..."}'
            }
            className="font-mono text-sm"
          />
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={handleImport}
              disabled={importing || saving}
            >
              {importing ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <FileUpIcon />
              )}
              解析并追加
            </Button>
          </div>
        </CardContent>
      </Card>

      {examples.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <DatabaseIcon className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">数据集为空</p>
              <p className="text-sm text-muted-foreground">
                没有数据集时任务保持「草稿」状态，无法启动运行。请添加或导入示例。
              </p>
            </div>
            <Button variant="outline" onClick={addExample}>
              <PlusIcon />
              添加第一条示例
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {examples.map((example, index) => (
            <Card key={`${example.id}-${index}`} className="gap-4">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    示例 {index + 1}
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {example.id}
                    </Badge>
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeExample(index)}
                    disabled={saving}
                    aria-label="删除示例"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`example-input-${index}`}>输入</Label>
                  <Textarea
                    id={`example-input-${index}`}
                    rows={2}
                    value={example.input}
                    onChange={(event) =>
                      updateExample(index, { input: event.target.value })
                    }
                    className="font-mono text-sm"
                    placeholder="任务输入"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`example-expected-${index}`}>
                    期望输出（可选）
                  </Label>
                  <Input
                    id={`example-expected-${index}`}
                    value={example.expected ?? ""}
                    onChange={(event) =>
                      updateExample(index, { expected: event.target.value })
                    }
                    className="font-mono text-sm"
                    placeholder="用于评估器对比的参考输出"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
