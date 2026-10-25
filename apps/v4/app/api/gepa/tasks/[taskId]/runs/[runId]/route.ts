import { fail, ok } from "@/lib/gepa/http"
import { getActiveRun } from "@/lib/gepa/run-manager"
import { readRun, readTask } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ taskId: string; runId: string }> }

/** 读取一次运行的完整状态（候选、迭代、轨迹、日志）；活动运行附带实时进度。 */
export async function GET(_request: Request, context: RouteContext) {
  const { taskId, runId } = await context.params
  const task = await readTask(taskId).catch(() => null)
  if (!task) return fail("任务不存在", 404)

  const active = getActiveRun(taskId)
  if (active && active.id === runId) {
    return ok({ run: active })
  }

  const run = await readRun(taskId, runId).catch(() => null)
  if (!run) return fail("运行不存在", 404)
  return ok({ run })
}
