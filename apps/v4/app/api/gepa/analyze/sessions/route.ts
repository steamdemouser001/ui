import {
  listClaudeProjects,
  listProjectSessions,
  listRecentSessions,
  type SessionListResult,
} from "@/lib/gepa/claude-inspect"
import { errorMessage, fail, ok } from "@/lib/gepa/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_SESSION_LIMIT = 40

function parseLimit(value: string | null): number {
  if (value === null || value.trim() === "") return DEFAULT_SESSION_LIMIT
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_LIMIT
  return Math.max(1, Math.min(200, Math.trunc(parsed)))
}

/**
 * 返回项目列表与最近会话扫描结果：不带 project 参数时跨项目取全局最近
 * limit 个会话；带 project 时只取该项目的会话。
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const project = url.searchParams.get("project")
  try {
    const [projects, sessions] = await Promise.all([
      listClaudeProjects(),
      project
        ? listProjectSessions(
            project,
            parseLimit(url.searchParams.get("limit"))
          )
        : listRecentSessions(parseLimit(url.searchParams.get("limit"))),
    ])
    const sessionResult: SessionListResult = sessions
    return ok({
      projects,
      project: sessionResult.project,
      sessions: sessionResult.sessions,
      total: sessionResult.total,
      scanErrors: sessionResult.scanErrors,
    })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
