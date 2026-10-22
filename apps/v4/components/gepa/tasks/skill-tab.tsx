"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  LayersIcon,
  Loader2Icon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiPatch } from "@/lib/gepa/client"
import type { SkillModule, TaskRecord } from "@/lib/gepa/types"
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

import { errorText } from "./format"

const MAX_MODULES = 20

interface SkillTabProps {
  taskId: string
  task: TaskRecord
  onRefresh: () => void | Promise<void>
}

function nextModuleId(modules: SkillModule[]): string {
  const used = new Set(modules.map((module) => module.id))
  const maxNumber = modules.reduce((max, module) => {
    const match = /^module-(\d+)$/.exec(module.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  let number = maxNumber + 1
  while (used.has(`module-${number}`)) {
    number += 1
  }
  return `module-${number}`
}

export function SkillTab({ taskId, task, onRefresh }: SkillTabProps) {
  const [modules, setModules] = React.useState<SkillModule[]>(() =>
    task.modules.map((module) => ({ ...module }))
  )
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const [testCommand, setTestCommand] = React.useState(
    () => task.testCommand ?? ""
  )
  const [commandDirty, setCommandDirty] = React.useState(false)
  const [commandSaving, setCommandSaving] = React.useState(false)

  React.useEffect(() => {
    if (dirty) return
    setModules(task.modules.map((module) => ({ ...module })))
  }, [task.modules, dirty])

  React.useEffect(() => {
    if (commandDirty) return
    setTestCommand(task.testCommand ?? "")
  }, [task.testCommand, commandDirty])

  function updateModule(index: number, patch: Partial<SkillModule>) {
    setModules((current) =>
      current.map((module, moduleIndex) =>
        moduleIndex === index ? { ...module, ...patch } : module
      )
    )
    setDirty(true)
  }

  function addModule() {
    if (modules.length >= MAX_MODULES) {
      toast.error(`技能模块最多 ${MAX_MODULES} 个`)
      return
    }
    const id = nextModuleId(modules)
    setModules((current) => [
      ...current,
      {
        id,
        name: `模块 ${current.length + 1}`,
        description: "",
        prompt: "",
      },
    ])
    setDirty(true)
  }

  function removeModule(index: number) {
    if (modules.length <= 1) {
      toast.error("任务至少需要保留 1 个技能模块")
      return
    }
    setModules((current) =>
      current.filter((_, moduleIndex) => moduleIndex !== index)
    )
    setDirty(true)
  }

  function moveModule(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= modules.length) return
    setModules((current) => {
      const next = [...current]
      const temp = next[index]
      next[index] = next[target]
      next[target] = temp
      return next
    })
    setDirty(true)
  }

  async function handleSave() {
    const cleaned = modules.map((module, index) => ({
      ...module,
      name: module.name.trim() || `模块 ${index + 1}`,
      description: module.description.trim(),
      prompt: module.prompt.trim(),
    }))

    if (cleaned.length === 0) {
      toast.error("任务至少需要 1 个技能模块")
      return
    }
    const empty = cleaned.find((module) => !module.prompt)
    if (empty) {
      toast.error(`模块「${empty.name || empty.id}」的提示词不能为空`)
      return
    }

    setSaving(true)
    try {
      await apiPatch<{ task: TaskRecord }>(`/api/gepa/tasks/${taskId}`, {
        modules: cleaned,
      })
      setModules(cleaned)
      setDirty(false)
      toast.success("技能模块已保存")
      await onRefresh()
    } catch (error) {
      toast.error(errorText(error, "保存技能模块失败"))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveCommand() {
    setCommandSaving(true)
    try {
      await apiPatch<{ task: TaskRecord }>(`/api/gepa/tasks/${taskId}`, {
        testCommand,
      })
      setCommandDirty(false)
      toast.success("评估命令已保存")
      await onRefresh()
    } catch (error) {
      toast.error(errorText(error, "保存评估命令失败"))
    } finally {
      setCommandSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <LayersIcon className="size-4" />
            技能模块
            {dirty && <Badge variant="secondary">未保存</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground">
            共 {modules.length} 个模块。GEPA
            会按顺序执行模块，并逐轮改进其中一个模块的提示词。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addModule} disabled={saving}>
            <PlusIcon />
            添加模块
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
            {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            保存
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {modules.map((module, index) => (
          <Card key={`${module.id}-${index}`}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    模块 {index + 1}
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {module.id}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    模块按从上到下的顺序执行，上一个模块的输出会作为下一个模块的上下文。
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => moveModule(index, -1)}
                    disabled={index === 0 || saving}
                    aria-label="上移模块"
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => moveModule(index, 1)}
                    disabled={index === modules.length - 1 || saving}
                    aria-label="下移模块"
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeModule(index)}
                    disabled={modules.length <= 1 || saving}
                    aria-label="删除模块"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`module-name-${index}`}>名称</Label>
                  <Input
                    id={`module-name-${index}`}
                    value={module.name}
                    onChange={(event) =>
                      updateModule(index, { name: event.target.value })
                    }
                    placeholder="例如：主技能"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`module-description-${index}`}>描述</Label>
                  <Input
                    id={`module-description-${index}`}
                    value={module.description}
                    onChange={(event) =>
                      updateModule(index, { description: event.target.value })
                    }
                    placeholder="简要说明该模块的职责（可选）"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`module-prompt-${index}`}>提示词</Label>
                <Textarea
                  id={`module-prompt-${index}`}
                  rows={8}
                  value={module.prompt}
                  onChange={(event) =>
                    updateModule(index, { prompt: event.target.value })
                  }
                  className="font-mono text-sm"
                  placeholder="该模块的完整提示词"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            评估命令（可选）
            {commandDirty && <Badge variant="secondary">未保存</Badge>}
          </CardTitle>
          <CardDescription>
            命令会在每次 rollout
            的隔离工作目录中执行；退出码 0 记 1 分，非 0 记 0
            分；stdout/stderr 会作为反馈。留空则使用评估器 LLM 打分。示例：
            <code className="mx-1 font-mono">npm test</code>、
            <code className="mx-1 font-mono">node -e &quot;...&quot;</code>。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="test-command">评估命令</Label>
            <Textarea
              id="test-command"
              rows={3}
              value={testCommand}
              onChange={(event) => {
                setTestCommand(event.target.value)
                setCommandDirty(true)
              }}
              className="font-mono text-sm"
              placeholder="例如：npm test"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => void handleSaveCommand()}
              disabled={!commandDirty || commandSaving}
            >
              {commandSaving ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <SaveIcon />
              )}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        提示：运行中修改提示词不会影响当前运行已生成的候选，只会影响后续新建的运行。
      </p>
    </div>
  )
}
