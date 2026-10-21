import { MAX_COMMAND_LENGTH } from "@/lib/gepa/constraints"
import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { readTask } from "@/lib/gepa/storage"
import { runWorkspaceCommand } from "@/lib/gepa/workspace"

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
    body = await request.json()
  } catch {
    return fail("请求体必须是合法的 JSON")
  }
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (typeof body.command !== "string") {
    return fail("command 必须是字符串")
  }
  const command = body.command
  if (!command.trim()) {
    return fail("命令不能为空")
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return fail(
      `命令过长（${command.length} 字符，上限 ${MAX_COMMAND_LENGTH} 字符）`
    )
  }

  try {
    const task = await readTask(taskId)
    if (!task) return fail("任务不存在", 404)
    const result = await runWorkspaceCommand(taskId, command)
    // 被策略拒绝属于正常结果，仍返回 200，由 allowed/reason 表达。
    return ok(result)
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
