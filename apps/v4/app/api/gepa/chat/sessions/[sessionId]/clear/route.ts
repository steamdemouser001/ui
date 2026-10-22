import { clearChatSession, readChatSession } from "@/lib/gepa/chat-sessions"
import { errorMessage, fail, ok } from "@/lib/gepa/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ sessionId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  try {
    const existing = await readChatSession(sessionId)
    if (!existing) return fail("会话不存在", 404)
    const session = await clearChatSession(sessionId)
    return ok({ session })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
