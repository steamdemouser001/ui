import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { rolloutPath } from "@/lib/gepa/storage"
import {
  listRolloutFiles,
  readRolloutFile,
  WorkspacePathError,
} from "@/lib/gepa/workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ taskId: string }> }

function queryValue(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)
  if (value === null) return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * 只读浏览一次 rollout 的隔离工作副本（Claude Code 模式的产物目录）。
 * - 不带 path：列出目录内文件。
 * - 带 path：读取单个文本文件内容（≤512KB）。
 */
export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params
  const url = new URL(request.url)

  const runId = queryValue(url, "runId")
  const candidateId = queryValue(url, "candidateId")
  const exampleId = queryValue(url, "exampleId")
  if (!runId || !candidateId || !exampleId) {
    return fail("缺少 runId、candidateId 或 exampleId 参数", 400)
  }

  let dir: string
  try {
    dir = rolloutPath(taskId, runId, candidateId, exampleId)
  } catch (error) {
    return fail(errorMessage(error), 400)
  }

  const filePath = queryValue(url, "path")
  try {
    if (filePath) {
      const content = await readRolloutFile(dir, filePath)
      return ok({ path: filePath, content })
    }
    const entries = await listRolloutFiles(dir)
    return ok({ entries })
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return fail(error.message, 400)
    }
    const message = errorMessage(error)
    if (message.includes("ENOENT") || message.includes("不存在")) {
      return fail("该 rollout 目录不存在（可能尚未执行或已被清理）", 404)
    }
    return fail(message, 500)
  }
}
