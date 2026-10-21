"use client"

import * as React from "react"
import { Loader2Icon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/gepa/client"
import type { GlobalSettings, TaskRecord } from "@/lib/gepa/types"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

import { errorText } from "./format"

interface TaskFormState {
  name: string
  description: string
  prompt: string
  datasetText: string
  budget: string
  minibatchSize: string
  maxIterations: string
}

const EMPTY_FORM: TaskFormState = {
  name: "",
  description: "",
  prompt: "",
  datasetText: "",
  budget: "60",
  minibatchSize: "3",
  maxIterations: "20",
}

function parseIntInRange(
  value: string,
  min: number,
  max: number,
  label: string
): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数`)
  }
  return parsed
}

interface TaskCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (task: TaskRecord) => void
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: TaskCreateDialogProps) {
  const [form, setForm] = React.useState<TaskFormState>(EMPTY_FORM)
  const [saving, setSaving] = React.useState(false)

  // 打开时用全局迭代默认值填充，避免与服务端默认配置不一致。
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const settings = await apiGet<GlobalSettings>("/api/gepa/settings")
        if (cancelled) return
        setForm((current) => ({
          ...current,
          budget: String(settings.iteration.budget),
          minibatchSize: String(settings.iteration.minibatchSize),
          maxIterations: String(settings.iteration.maxIterations),
        }))
      } catch {
        // 读取失败时保留内置默认值
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  function update(patch: Partial<TaskFormState>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) {
      toast.error("请填写任务名称")
      return
    }

    let budget: number
    let minibatchSize: number
    let maxIterations: number
    try {
      budget = parseIntInRange(form.budget, 1, 10000, "预算")
      minibatchSize = parseIntInRange(form.minibatchSize, 1, 50, "minibatch 大小")
      maxIterations = parseIntInRange(
        form.maxIterations,
        1,
        200,
        "最大迭代轮数"
      )
    } catch (error) {
      toast.error(errorText(error, "迭代参数不合法"))
      return
    }

    setSaving(true)
    try {
      const data = await apiPost<{ task: TaskRecord }>("/api/gepa/tasks", {
        name,
        description: form.description.trim(),
        prompt: form.prompt,
        datasetText: form.datasetText,
        iteration: { budget, minibatchSize, maxIterations },
      })
      toast.success(`任务「${data.task.name}」已创建`)
      setForm(EMPTY_FORM)
      onCreated(data.task)
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error, "创建任务失败"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>新建任务</DialogTitle>
            <DialogDescription>
              每个任务拥有独立的技能模块、数据集与工作空间。创建后可继续编辑并启动
              GEPA 迭代。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="task-name">任务名称</Label>
            <Input
              id="task-name"
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="例如：客服邮件改写"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">描述</Label>
            <Textarea
              id="task-description"
              rows={2}
              value={form.description}
              onChange={(event) => update({ description: event.target.value })}
              placeholder="简要说明任务目标与评估标准（可选）"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-prompt">初始提示词</Label>
            <Textarea
              id="task-prompt"
              rows={5}
              value={form.prompt}
              onChange={(event) => update({ prompt: event.target.value })}
              placeholder="主技能模块的初始提示词，留空则使用默认提示词"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              将作为「主技能」模块的提示词，GEPA 会在此基础上迭代改进。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-dataset">数据集</Label>
            <Textarea
              id="task-dataset"
              rows={6}
              value={form.datasetText}
              onChange={(event) => update({ datasetText: event.target.value })}
              placeholder={
                '支持 JSON 数组：[{"input":"...","expected":"..."}]\n或 JSONL：每行一个 {"input":"..."}\n或纯文本：每行一条示例'
              }
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              最多 500 条。可稍后在任务详情页继续编辑或批量导入。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="task-budget">预算</Label>
              <Input
                id="task-budget"
                type="number"
                min={1}
                max={10000}
                value={form.budget}
                onChange={(event) => update({ budget: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-minibatch">Minibatch</Label>
              <Input
                id="task-minibatch"
                type="number"
                min={1}
                max={50}
                value={form.minibatchSize}
                onChange={(event) =>
                  update({ minibatchSize: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-max-iterations">最大迭代轮数</Label>
              <Input
                id="task-max-iterations"
                type="number"
                min={1}
                max={200}
                value={form.maxIterations}
                onChange={(event) =>
                  update({ maxIterations: event.target.value })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              创建任务
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
