import {
  deleteChatSession,
  readChatSession,
  readChatSessionMessages,
  renameChatSession,
} from "@/lib/gepa/chat-sessions"
import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"
import { listTaskSummaries } from "@/lib/gepa/task-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MESSAGE_LIMIT = 500

type RouteContext = { params: Promise<{ sessionId: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  try {
    const session = await readChatSession(sessionId)
    if (!session) return fail("会话不存在", 404)
    const [messages, tasks] = await Promise.all([
      readChatSessionMessages(sessionId, MESSAGE_LIMIT),
      listTaskSummaries(),
    ])
    return ok({ session, messages, tasks })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  const body = await readJsonBody(request).catch(() => null)
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return fail("title 不能为空")
  }

  try {
    const session = await renameChatSession(sessionId, body.title)
    return ok({ session })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  try {
    const session = await readChatSession(sessionId)
    if (!session) return fail("会话不存在", 404)
    await deleteChatSession(sessionId)
    return ok({ deleted: true, id: sessionId })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
