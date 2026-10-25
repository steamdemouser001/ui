import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"
import {
  approveCandidate,
  pauseRun,
  promoteCandidate,
  rejectCandidate,
  resumeRun,
  setLiveBudget,
  startRun,
  stepRun,
  stopRun,
} from "@/lib/gepa/run-manager"
import { readTask } from "@/lib/gepa/storage"
import { sanitizeIteration } from "@/lib/gepa/task-service"
import { writeTask } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS = [
  "start",
  "pause",
  "resume",
  "stop",
  "step",
  "approve",
  "reject",
  "promote",
  "setBudget",
] as const
type RunAction = (typeof ACTIONS)[number]

type RouteContext = { params: Promise<{ taskId: string }> }

function isRunAction(value: unknown): value is RunAction {
  return (
    typeof value === "string" && (ACTIONS as readonly string[]).includes(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}必须是数字`)
  }
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}不能为空`)
  }
  return value.trim()
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params

  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return fail(errorMessage(error))
  }
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (!isRunAction(body.action)) {
    return fail(
      "action 必须是 start、pause、resume、stop、step、approve、reject、promote 或 setBudget"
    )
  }

  try {
    const task = await readTask(taskId)
    if (!task) return fail("任务不存在", 404)

    if (body.action === "start") {
      if (task.modules.length === 0) {
        return fail("任务没有技能模块，请先在「技能」页添加模块")
      }
      if (task.dataset.length === 0) {
        return fail("任务没有数据集，请先在「数据集」页添加示例")
      }
      const run = await startRun(taskId, {
        budget: optionalNumber(body.budget, "budget"),
        minibatchSize: optionalNumber(body.minibatchSize, "minibatchSize"),
        maxIterations: optionalNumber(body.maxIterations, "maxIterations"),
      })
      return ok({ run })
    }

    if (body.action === "pause") {
      return ok({ run: await pauseRun(taskId) })
    }
    if (body.action === "resume") {
      return ok({ run: await resumeRun(taskId) })
    }
    if (body.action === "stop") {
      return ok({ run: await stopRun(taskId) })
    }
    if (body.action === "step") {
      return ok({ run: await stepRun(taskId) })
    }
    if (body.action === "approve") {
      return ok({ run: await approveCandidate(taskId) })
    }
    if (body.action === "reject") {
      return ok({ run: await rejectCandidate(taskId) })
    }
    if (body.action === "promote") {
      const candidateId = requireString(body.candidateId, "candidateId")
      const runId =
        typeof body.runId === "string" && body.runId.trim()
          ? body.runId.trim()
          : undefined
      return ok({ run: await promoteCandidate(taskId, candidateId, runId) })
    }

    // setBudget：任务默认值 + 活动运行实时生效。
    const budget = optionalNumber(body.budget, "budget")
    if (budget === undefined) {
      return fail("setBudget 缺少 budget 参数")
    }
    const iteration = sanitizeIteration(task.iteration, { budget })
    task.iteration = iteration
    task.updatedAt = new Date().toISOString()
    await writeTask(task)
    try {
      const run = await setLiveBudget(taskId, iteration.budget)
      return ok({ run })
    } catch {
      // 没有活动运行时只更新任务默认值
      return ok({ run: null, taskUpdated: true })
    }
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
