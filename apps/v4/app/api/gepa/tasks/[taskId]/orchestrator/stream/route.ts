import { fail } from "@/lib/gepa/http"
import { chatWithOrchestratorStream } from "@/lib/gepa/orchestrator"
import { sseResponse } from "@/lib/gepa/sse"
import { readTask } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ taskId: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params

  const body = await request.json().catch(() => null)
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return fail("message 不能为空")
  }
  const message = body.message.trim()

  const task = await readTask(taskId).catch(() => null)
  if (!task) return fail("任务不存在", 404)

  return sseResponse(async (emit, signal) => {
    const reply = await chatWithOrchestratorStream(
      taskId,
      message,
      {
        onReasoning: (delta) => emit("reasoning", { delta }),
        onReplyDelta: (delta) => emit("delta", { delta }),
        onStatus: (status) => emit("status", { status }),
        onAction: (action) => emit("action", { action }),
      },
      signal
    )
    emit("done", reply)
  }, request.signal)
}
