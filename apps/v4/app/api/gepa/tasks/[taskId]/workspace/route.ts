import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { readTask } from "@/lib/gepa/storage"
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  WorkspacePathError,
  WorkspacePolicyError,
  workspaceSummary,
  writeWorkspaceFile,
} from "@/lib/gepa/workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ taskId: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params
  const requested = new URL(request.url).searchParams.get("path")

  try {
    const task = await readTask(taskId)
    if (!task) return fail("任务不存在", 404)

    if (requested !== null && requested !== "") {
      const content = await readWorkspaceFile(taskId, requested)
      return ok({ path: requested, content })
    }

    const [files, summary] = await Promise.all([
      listWorkspaceFiles(taskId),
      workspaceSummary(taskId),
    ])
    return ok({ files, summary })
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return fail(error.message, 400)
    }
    return fail(errorMessage(error), 400)
  }
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
  if (typeof body.path !== "string" || !body.path.trim()) {
    return fail("path 不能为空")
  }
  if (typeof body.content !== "string") {
    return fail("content 必须是字符串")
  }

  try {
    const task = await readTask(taskId)
    if (!task) return fail("任务不存在", 404)
    await writeWorkspaceFile(taskId, body.path, body.content)
    return ok({ path: body.path })
  } catch (error) {
    if (error instanceof WorkspacePolicyError) {
      return fail(error.reason, 403)
    }
    if (error instanceof WorkspacePathError) {
      return fail(error.message, 400)
    }
    return fail(errorMessage(error), 400)
  }
}
