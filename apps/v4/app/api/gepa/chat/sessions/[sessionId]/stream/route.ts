import { readChatSession } from "@/lib/gepa/chat-sessions"
import { chatWithControllerStream } from "@/lib/gepa/controller"
import { fail, readJsonBody } from "@/lib/gepa/http"
import { sseResponse } from "@/lib/gepa/sse"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ sessionId: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params

  const body = await readJsonBody(request).catch(() => null)
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return fail("message 不能为空")
  }
  const message = body.message.trim()

  const session = await readChatSession(sessionId).catch(() => null)
  if (!session) return fail("会话不存在", 404)

  return sseResponse(async (emit, signal) => {
    const reply = await chatWithControllerStream(
      sessionId,
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
