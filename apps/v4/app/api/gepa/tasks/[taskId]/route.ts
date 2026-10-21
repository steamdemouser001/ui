import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { readTask } from "@/lib/gepa/storage"
import {
  deleteTask,
  getTaskDetail,
  updateTask,
  type UpdateTaskInput,
} from "@/lib/gepa/task-service"
import type {
  DatasetExample,
  IterationDefaults,
  SkillModule,
} from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type RouteContext = { params: Promise<{ taskId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params
    const detail = await getTaskDetail(taskId)
    if (!detail) return fail("任务不存在", 404)
    return ok(detail)
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const patch: UpdateTaskInput = {}
  if (body.name !== undefined) {
    if (typeof body.name !== "string") return fail("name 必须是字符串")
    patch.name = body.name
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return fail("description 必须是字符串")
    }
    patch.description = body.description
  }
  if (body.modules !== undefined) {
    if (!Array.isArray(body.modules)) return fail("modules 必须是数组")
    patch.modules = body.modules as SkillModule[]
  }
  if (body.dataset !== undefined) {
    if (!Array.isArray(body.dataset)) return fail("dataset 必须是数组")
    patch.dataset = body.dataset as DatasetExample[]
  }
  if (body.iteration !== undefined) {
    if (!isRecord(body.iteration)) return fail("iteration 必须是 JSON 对象")
    patch.iteration = body.iteration as unknown as Partial<IterationDefaults>
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") return fail("notes 必须是字符串")
    patch.notes = body.notes
  }

  try {
    const existing = await readTask(taskId)
    if (!existing) return fail("任务不存在", 404)
    const task = await updateTask(taskId, patch)
    return ok({ task })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params
    const existing = await readTask(taskId)
    if (!existing) return fail("任务不存在", 404)
    await deleteTask(taskId)
    return ok({ id: taskId })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
