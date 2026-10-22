import { fail } from "@/lib/gepa/http"
import { delay, sseResponse } from "@/lib/gepa/sse"
import { readTask } from "@/lib/gepa/storage"
import { getTaskDetail } from "@/lib/gepa/task-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RUNNING_INTERVAL_MS = 1000
const IDLE_INTERVAL_MS = 5000

type RouteContext = { params: Promise<{ taskId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params

  const task = await readTask(taskId).catch(() => null)
  if (!task) return fail("任务不存在", 404)

  return sseResponse(async (emit, signal) => {
    let lastSerialized = ""
    while (!signal.aborted) {
      const detail = await getTaskDetail(taskId)
      if (!detail) {
        emit("error", { message: "任务不存在" })
        return
      }
      const serialized = JSON.stringify(detail)
      if (serialized !== lastSerialized) {
        lastSerialized = serialized
        emit("snapshot", detail)
      }
      const running =
        detail.run?.status === "running" || detail.task.status === "running"
      await delay(running ? RUNNING_INTERVAL_MS : IDLE_INTERVAL_MS, signal)
    }
  }, request.signal)
}
