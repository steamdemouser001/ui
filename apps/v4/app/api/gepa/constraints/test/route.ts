import { MAX_COMMAND_LENGTH } from "@/lib/gepa/constraints"
import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"
import { runSandboxedCommand } from "@/lib/gepa/sandbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return fail(errorMessage(error))
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

  let taskId: string | undefined
  if (body.taskId !== undefined && body.taskId !== null && body.taskId !== "") {
    if (typeof body.taskId !== "string") {
      return fail("taskId 必须是字符串")
    }
    const trimmed = body.taskId.trim()
    if (trimmed && !TASK_ID_PATTERN.test(trimmed)) {
      return fail("taskId 不合法：只允许小写字母、数字和连字符")
    }
    taskId = trimmed || undefined
  }

  try {
    const result = await runSandboxedCommand({ command, taskId })
    return ok(result)
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
