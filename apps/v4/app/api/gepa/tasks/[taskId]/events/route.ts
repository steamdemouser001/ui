import { fail } from "@/lib/gepa/http"
import { getActiveRun } from "@/lib/gepa/run-manager"
import { subscribeRunEvents } from "@/lib/gepa/run-events"
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

    const sendSnapshot = async (): Promise<"ok" | "missing"> => {
      const detail = await getTaskDetail(taskId)
      if (!detail) return "missing"
      // 快照附带活动运行的迭代内实时进度（磁盘状态只在轮次边界更新）。
      const active = getActiveRun(taskId)
      if (active && detail.run && detail.run.id === active.id) {
        detail.run = { ...detail.run, progress: active.progress }
      }
      const serialized = JSON.stringify(detail)
      if (serialized !== lastSerialized) {
        lastSerialized = serialized
        emit("snapshot", detail)
      }
      return "ok"
    }

    // 订阅进程内事件总线：rollout 开始、工具调用、审批请求等即时转发，
    // 让长迭代（如 Claude Code rollout）不再等到轮次结束才可见。
    const unsubscribe = subscribeRunEvents((event) => {
      if (event.taskId !== taskId || signal.aborted) return
      emit("run-event", event)
    })

    try {
      if ((await sendSnapshot()) === "missing") {
        emit("error", { message: "任务不存在" })
        return
      }
      while (!signal.aborted) {
        const running =
          getActiveRun(taskId) !== null ||
          lastSerialized.includes('"status":"running"')
        await delay(running ? RUNNING_INTERVAL_MS : IDLE_INTERVAL_MS, signal)
        if (signal.aborted) return
        if ((await sendSnapshot()) === "missing") {
          emit("error", { message: "任务不存在" })
          return
        }
      }
    } finally {
      unsubscribe()
    }
  }, request.signal)
}
