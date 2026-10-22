import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"
import { chatWithOrchestrator } from "@/lib/gepa/orchestrator"
import { readTask } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ taskId: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params

  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return fail(errorMessage(error))
  }
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return fail("message 不能为空")
  }

  try {
    const task = await readTask(taskId)
    if (!task) return fail("任务不存在", 404)
    const reply = await chatWithOrchestrator(taskId, body.message)
    return ok(reply)
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
