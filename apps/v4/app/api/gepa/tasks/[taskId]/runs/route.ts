import { fail, ok } from "@/lib/gepa/http"
import { readTask } from "@/lib/gepa/storage"
import { listRunSummaries } from "@/lib/gepa/task-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ taskId: string }> }

/** 任务全部运行摘要（按开始时间倒序），供运行历史选择器使用。 */
export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params
  const task = await readTask(taskId).catch(() => null)
  if (!task) return fail("任务不存在", 404)
  try {
    const runs = await listRunSummaries(taskId)
    return ok({ runs })
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 500)
  }
}
