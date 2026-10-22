import {
  ensureDefaultChatSession,
  readChatSessionMessages,
} from "@/lib/gepa/chat-sessions"
import { chatWithController, clearGlobalChat } from "@/lib/gepa/controller"
import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { listTaskSummaries } from "@/lib/gepa/task-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 兼容旧接口：读写默认会话。新界面请使用 /api/gepa/chat/sessions。 */
export async function GET() {
  try {
    const session = await ensureDefaultChatSession()
    const [messages, tasks] = await Promise.all([
      readChatSessionMessages(session.id, 100),
      listTaskSummaries(),
    ])
    return ok({ messages, tasks, session })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail("请求体必须是合法的 JSON")
  }
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return fail("message 不能为空")
  }

  try {
    const session = await ensureDefaultChatSession()
    const reply = await chatWithController(body.message)
    return ok({ ...reply, session })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function DELETE() {
  try {
    await clearGlobalChat()
    return ok({ cleared: true })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
