"use client"

import * as React from "react"
import { Loader2Icon, PlayIcon } from "lucide-react"

import type { TaskRecord } from "@/lib/gepa/types"
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

/** start 动作的可选参数；undefined 表示使用任务默认值。 */
export interface StartOptions {
  budget?: number
  minibatchSize?: number
  maxIterations?: number
}

/** 空串 = 用默认；非法输入返回 false。 */
function parseField(raw: string): number | undefined | false {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : false
}

export function StartOptionsDialog({
  open,
  onOpenChange,
  task,
  busy,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: TaskRecord
  busy: boolean
  onStart: (options: StartOptions) => void
}) {
  const [budget, setBudget] = React.useState("")
  const [minibatchSize, setMinibatchSize] = React.useState("")
  const [maxIterations, setMaxIterations] = React.useState("")

  // 每次打开时重置为空，占位符展示任务默认值；留空即用默认。
  React.useEffect(() => {
    if (open) {
      setBudget("")
      setMinibatchSize("")
      setMaxIterations("")
    }
  }, [open])

  const budgetValue = parseField(budget)
  const minibatchValue = parseField(minibatchSize)
  const maxIterationsValue = parseField(maxIterations)
  const invalid =
    budgetValue === false ||
    minibatchValue === false ||
    maxIterationsValue === false

  function handleStart() {
    if (invalid || busy) return
    onStart({
      budget: budgetValue ?? undefined,
      minibatchSize: minibatchValue ?? undefined,
      maxIterations: maxIterationsValue ?? undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>开始运行</DialogTitle>
          <DialogDescription>
            可在启动前覆盖本次运行的参数，留空使用任务默认值。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="gepa-start-budget">预算</Label>
            <Input
              id="gepa-start-budget"
              type="number"
              min={1}
              value={budget}
              placeholder={String(task.iteration.budget)}
              onChange={(event) => setBudget(event.target.value)}
              aria-invalid={budgetValue === false}
            />
            <p className="text-xs text-muted-foreground">
              默认 {task.iteration.budget}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gepa-start-minibatch">minibatch 大小</Label>
            <Input
              id="gepa-start-minibatch"
              type="number"
              min={1}
              value={minibatchSize}
              placeholder={String(task.iteration.minibatchSize)}
              onChange={(event) => setMinibatchSize(event.target.value)}
              aria-invalid={minibatchValue === false}
            />
            <p className="text-xs text-muted-foreground">
              默认 {task.iteration.minibatchSize}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gepa-start-max-iterations">最大迭代轮数</Label>
            <Input
              id="gepa-start-max-iterations"
              type="number"
              min={1}
              value={maxIterations}
              placeholder={String(task.iteration.maxIterations)}
              onChange={(event) => setMaxIterations(event.target.value)}
              aria-invalid={maxIterationsValue === false}
            />
            <p className="text-xs text-muted-foreground">
              默认 {task.iteration.maxIterations}
            </p>
          </div>
        </div>
        {invalid && (
          <p className="text-xs text-destructive">参数必须是正整数。</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </Button>
          <Button onClick={handleStart} disabled={busy || invalid}>
            {busy ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <PlayIcon />
            )}
            启动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
