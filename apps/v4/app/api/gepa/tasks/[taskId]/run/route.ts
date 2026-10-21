import { errorMessage, fail, ok } from "@/lib/gepa/http"
import {
  pauseRun,
  resumeRun,
  startRun,
  stepRun,
  stopRun,
} from "@/lib/gepa/run-manager"
import { readTask } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS = ["start", "pause", "resume", "stop", "step"] as const
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

function optionalNumber(
  value: unknown,
  label: string
): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}必须是数字`)
  }
  return value
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail("请求体必须是合法的 JSON")
  }
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (!isRunAction(body.action)) {
    return fail("action 必须是 start、pause、resume、stop 或 step")
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
    return ok({ run: await stepRun(taskId) })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
