import { createChatSession, listChatSessions } from "@/lib/gepa/chat-sessions"
import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { listTaskSummaries } from "@/lib/gepa/task-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function GET() {
  try {
    const [sessions, tasks] = await Promise.all([
      listChatSessions(),
      listTaskSummaries(),
    ])
    return ok({ sessions, tasks })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return fail("title 必须是字符串")
  }

  try {
    const session = await createChatSession(
      typeof body.title === "string" ? body.title : undefined
    )
    return ok({ session }, { status: 201 })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
