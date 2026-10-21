import { chatWithController, clearGlobalChat } from "@/lib/gepa/controller"
import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { readGlobalMessages } from "@/lib/gepa/storage"
import { listTaskSummaries } from "@/lib/gepa/task-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function GET() {
  try {
    const [messages, tasks] = await Promise.all([
      readGlobalMessages(100),
      listTaskSummaries(),
    ])
    return ok({ messages, tasks })
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
    const reply = await chatWithController(body.message)
    return ok(reply)
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
